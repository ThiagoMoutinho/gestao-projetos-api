import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import type { ProjectRow } from "../../projects/dtos/projects.dto";
import type { EapMilestoneRow } from "../dtos/eap-milestones.dto";
import type { EapPhaseRow } from "../dtos/eap-phases.dto";
import {
  classifyFieldChange,
  isRescheduleEntry,
  toEapScheduleChangeDto,
  type EapScheduleFieldChange,
  type EapScheduleImpact,
  type RescheduleMilestoneInput,
  type RescheduleRangeInput,
  type SchedulePlan,
} from "../dtos/eap-schedule.dto";
import type { EapTaskRow } from "../dtos/eap-tasks.dto";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import { calculatedTaskStatus, civilDayKey, phaseDates } from "./eap-status";
import { syncPhaseStatus } from "./phase-rollup";
import {
  assertCanRescheduleEap,
  assertCanView,
  loadProjectAccess,
  milestoneNotFoundError,
  phaseNotFoundError,
  taskNotFoundError,
} from "./shared";

export type RescheduleTarget =
  | { entityType: "PROJECT" }
  | { entityType: "PHASE"; phaseId: string }
  | { entityType: "TASK"; phaseId: string; taskId: string }
  | { entityType: "MILESTONE"; phaseId: string; milestoneId: string };

type Subject =
  | { entityType: "PROJECT"; label: string; done: boolean; current: SchedulePlan; baseline: SchedulePlan }
  | { entityType: "PHASE"; label: string; done: boolean; current: SchedulePlan; baseline: SchedulePlan; phase: EapPhaseRow }
  | {
      entityType: "TASK";
      label: string;
      done: boolean;
      current: SchedulePlan;
      baseline: SchedulePlan;
      phase: EapPhaseRow;
      task: EapTaskRow;
    }
  | {
      entityType: "MILESTONE";
      label: string;
      done: boolean;
      current: SchedulePlan;
      baseline: SchedulePlan;
      phase: EapPhaseRow;
      milestone: EapMilestoneRow;
    };

const CRITICAL_MILESTONE_TYPES = new Set<EapMilestoneRow["type"]>(["HOMOLOGACAO", "APROVACAO"]);
const ESCALATING_IMPACTS = new Set<EapScheduleImpact["code"]>(["PROJECT_END_EXCEEDED", "CRITICAL_MILESTONE"]);

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Belem",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function sameDay(left: Date | null, right: Date | null) {
  if (!left || !right) {
    return left === right;
  }
  return civilDayKey(left) === civilDayKey(right);
}

function isAfter(value: Date | null, limit: Date | null) {
  return value !== null && limit !== null && civilDayKey(value) > civilDayKey(limit);
}

function isBefore(value: Date | null, limit: Date | null) {
  return value !== null && limit !== null && civilDayKey(value) < civilDayKey(limit);
}

function formatDay(value: string | null) {
  return value ? dateFormatter.format(new Date(value)) : "sem data";
}

function describeChange(change: EapScheduleFieldChange, single: boolean) {
  const label = single ? "data prevista" : change.field === "START" ? "início" : "término";
  return change.kind === "DEFINED"
    ? `${label} definido pela primeira vez: ${formatDay(change.next)}`
    : `${label} ${formatDay(change.previous)} → ${formatDay(change.next)}`;
}

function toIsoPlan(plan: SchedulePlan) {
  return { startAt: plan.startAt?.toISOString() ?? null, endAt: plan.endAt?.toISOString() ?? null };
}

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function nextPlan(target: RescheduleTarget, input: RescheduleRangeInput | RescheduleMilestoneInput): SchedulePlan {
  if (target.entityType === "MILESTONE") {
    return { startAt: null, endAt: new Date((input as RescheduleMilestoneInput).plannedAt) };
  }
  const range = input as RescheduleRangeInput;
  const plan = { startAt: new Date(range.plannedStartAt), endAt: new Date(range.plannedEndAt) };
  if (isBefore(plan.endAt, plan.startAt)) {
    throw new HttpError(
      400,
      "O novo término planejado não pode ser anterior ao novo início.",
      "SCHEDULE_DATES_INVALID",
    );
  }
  return plan;
}

async function loadSubject(repos: EapRepos, project: ProjectRow, target: RescheduleTarget): Promise<Subject> {
  if (target.entityType === "PROJECT") {
    return {
      entityType: "PROJECT",
      label: `do projeto "${project.name}"`,
      done: project.status === "CONCLUIDO",
      current: { startAt: project.plannedStartAt, endAt: project.plannedEndAt },
      baseline: { startAt: project.baselineStartAt, endAt: project.baselineEndAt },
    };
  }

  const phase = await repos.phases.lockForUpdate(target.phaseId, project.id);
  if (!phase) {
    throw phaseNotFoundError();
  }

  if (target.entityType === "PHASE") {
    return {
      entityType: "PHASE",
      label: `da fase "${phase.name}"`,
      done: phase.status === "CONCLUIDA",
      current: { startAt: phase.plannedStartAt, endAt: phase.plannedEndAt },
      baseline: { startAt: phase.baselineStartAt, endAt: phase.baselineEndAt },
      phase,
    };
  }

  if (target.entityType === "TASK") {
    const task = await repos.tasks.findByIdAndPhase(target.taskId, phase.id);
    if (!task) {
      throw taskNotFoundError();
    }
    const status = calculatedTaskStatus(task);
    return {
      entityType: "TASK",
      label: `da tarefa "${task.title}"`,
      done: status === "CONCLUIDA" || status === "CANCELADA",
      current: { startAt: task.plannedStartAt, endAt: task.plannedEndAt },
      baseline: { startAt: task.baselineStartAt, endAt: task.baselineEndAt },
      phase,
      task,
    };
  }

  const milestone = await repos.milestones.findByIdAndPhase(target.milestoneId, phase.id);
  if (!milestone) {
    throw milestoneNotFoundError();
  }
  return {
    entityType: "MILESTONE",
    label: `do marco "${milestone.title}"`,
    done: milestone.status === "APROVADO",
    current: { startAt: null, endAt: milestone.plannedAt },
    baseline: { startAt: null, endAt: milestone.baselineAt },
    phase,
    milestone,
  };
}

function outsideRange(start: Date | null, end: Date | null, range: SchedulePlan) {
  return isBefore(start ?? end, range.startAt) || isAfter(end ?? start, range.endAt);
}

/** Impactos são apenas sinalizados: nenhum outro elemento é alterado automaticamente. */
async function detectImpacts(
  repos: EapRepos,
  project: ProjectRow,
  subject: Subject,
  next: SchedulePlan,
): Promise<EapScheduleImpact[]> {
  const impacts: EapScheduleImpact[] = [];
  const projectPlan = { startAt: project.plannedStartAt, endAt: project.plannedEndAt };

  if (subject.entityType === "PROJECT") {
    const [phases, milestones] = await Promise.all([
      repos.phases.listByProject(project.id),
      repos.milestones.listByProject(project.id),
    ]);
    const phasesOutside = phases.filter(
      (phase) => phase.status !== "CONCLUIDA" && outsideRange(phase.plannedStartAt, phase.plannedEndAt, next),
    );
    if (phasesOutside.length > 0) {
      impacts.push({
        code: "ITEMS_OUTSIDE",
        message: `${plural(phasesOutside.length, "fase fica", "fases ficam")} fora do novo planejamento do projeto.`,
      });
    }
    const criticalAfter = milestones.filter(
      (milestone) =>
        CRITICAL_MILESTONE_TYPES.has(milestone.type) &&
        milestone.status !== "APROVADO" &&
        isAfter(milestone.plannedAt, next.endAt),
    );
    if (criticalAfter.length > 0) {
      impacts.push({
        code: "CRITICAL_MILESTONE",
        message: `${plural(criticalAfter.length, "marco crítico fica", "marcos críticos ficam")} após o novo término do projeto.`,
      });
    }
    return impacts;
  }

  if (subject.entityType === "PHASE") {
    if (isBefore(next.startAt, projectPlan.startAt)) {
      impacts.push({ code: "PROJECT_START_PRECEDED", message: "Inicia antes do início planejado do projeto." });
    }
    if (isAfter(next.endAt, projectPlan.endAt)) {
      impacts.push({ code: "PROJECT_END_EXCEEDED", message: "Ultrapassa o término planejado do projeto." });
    }
    const [tasks, milestones] = await Promise.all([
      repos.tasks.listByPhase(subject.phase.id),
      repos.milestones.listByPhase(subject.phase.id),
    ]);
    const tasksOutside = tasks.filter((task) => {
      const status = calculatedTaskStatus(task);
      return (
        status !== "CONCLUIDA" &&
        status !== "CANCELADA" &&
        outsideRange(task.plannedStartAt, task.plannedEndAt, next)
      );
    });
    const milestonesOutside = milestones.filter(
      (milestone) => milestone.status !== "APROVADO" && outsideRange(milestone.plannedAt, milestone.plannedAt, next),
    );
    const criticalOutside = milestonesOutside.filter((milestone) => CRITICAL_MILESTONE_TYPES.has(milestone.type));
    const regularOutside = tasksOutside.length + milestonesOutside.length - criticalOutside.length;
    if (regularOutside > 0) {
      impacts.push({
        code: "ITEMS_OUTSIDE",
        message: `${plural(regularOutside, "item da fase fica", "itens da fase ficam")} fora do novo planejamento.`,
      });
    }
    if (criticalOutside.length > 0) {
      impacts.push({
        code: "CRITICAL_MILESTONE",
        message: `${plural(criticalOutside.length, "marco crítico da fase fica", "marcos críticos da fase ficam")} fora do novo planejamento.`,
      });
    }
    return impacts;
  }

  const phase = subject.phase;
  if (isBefore(next.startAt, phase.plannedStartAt)) {
    impacts.push({ code: "PHASE_START_PRECEDED", message: "Inicia antes do início planejado da fase." });
  }
  if (isAfter(next.endAt, phase.plannedEndAt)) {
    impacts.push({ code: "PHASE_END_EXCEEDED", message: "Ultrapassa o término planejado da fase." });
  }
  if (isAfter(next.endAt, projectPlan.endAt)) {
    impacts.push({ code: "PROJECT_END_EXCEEDED", message: "Ultrapassa o término planejado do projeto." });
  }

  if (subject.entityType === "MILESTONE" && CRITICAL_MILESTONE_TYPES.has(subject.milestone.type)) {
    impacts.push({
      code: "CRITICAL_MILESTONE",
      message:
        subject.milestone.type === "HOMOLOGACAO"
          ? "Altera a data prevista de um marco de homologação."
          : "Altera a data prevista de um marco de aprovação.",
    });
  }

  if (subject.entityType === "TASK" && subject.task.correctiveMilestoneId) {
    const milestone = await repos.milestones.findByIdAndPhase(subject.task.correctiveMilestoneId, phase.id);
    if (milestone && milestone.status !== "APROVADO" && isAfter(next.endAt, milestone.plannedAt)) {
      impacts.push({
        code: "CRITICAL_MILESTONE",
        message: `Termina após a data prevista do marco "${milestone.title}", que depende desta correção.`,
      });
    }
  }

  return impacts;
}

async function applyPlan(
  repos: EapRepos,
  projectId: string,
  subject: Subject,
  plan: SchedulePlan,
  baseline: SchedulePlan,
  actorId: string,
  now: Date,
) {
  const audit = { updatedBy: actorId, updatedAt: now };
  switch (subject.entityType) {
    case "PROJECT":
      return repos.projects.update(projectId, {
        plannedStartAt: plan.startAt,
        plannedEndAt: plan.endAt,
        baselineStartAt: baseline.startAt,
        baselineEndAt: baseline.endAt,
        updatedAt: now,
      });
    case "PHASE":
      return repos.phases.update(subject.phase.id, projectId, {
        plannedStartAt: plan.startAt,
        plannedEndAt: plan.endAt,
        baselineStartAt: baseline.startAt,
        baselineEndAt: baseline.endAt,
        ...audit,
      });
    case "TASK":
      return repos.tasks.update(subject.task.id, subject.phase.id, {
        plannedStartAt: plan.startAt,
        plannedEndAt: plan.endAt,
        baselineStartAt: baseline.startAt,
        baselineEndAt: baseline.endAt,
        ...audit,
      });
    case "MILESTONE":
      return repos.milestones.update(subject.milestone.id, subject.phase.id, {
        plannedAt: plan.endAt,
        baselineAt: baseline.endAt,
        ...audit,
      });
  }
}

/**
 * Aplica uma mudança de planejamento e grava o histórico. A primeira definição de datas grava o
 * planejamento vigente e a linha de base sem contar como reprogramação; depois, a linha de base nunca
 * muda. Cada reprogramação recebe número sequencial por item e fica no histórico imutável da auditoria.
 */
async function changeSchedule(
  repos: EapRepos,
  project: ProjectRow,
  actor: AuthUser,
  target: RescheduleTarget,
  next: SchedulePlan,
  justification: string | null,
  cascadeFrom?: string,
) {
  const projectId = project.id;
  const single = target.entityType === "MILESTONE";
  const subject = await loadSubject(repos, project, target);
  const entityId =
    subject.entityType === "PROJECT"
      ? project.id
      : subject.entityType === "PHASE"
        ? subject.phase.id
        : subject.entityType === "TASK"
          ? subject.task.id
          : subject.milestone.id;

  if (subject.done) {
    throw new HttpError(
      409,
      cascadeFrom
        ? "A fase está concluída: o planejamento dela não pode ser estendido."
        : "Itens concluídos, cancelados ou homologados não podem ter o prazo reprogramado.",
      "SCHEDULE_ITEM_CLOSED",
    );
  }

  const { current } = subject;
  const startChanged = !single && !sameDay(current.startAt, next.startAt);
  const endChanged = !sameDay(current.endAt, next.endAt);
  if (!startChanged && !endChanged) {
    throw new HttpError(
      400,
      "As novas datas são iguais ao planejamento vigente.",
      "SCHEDULE_UNCHANGED",
    );
  }

  const previousIso = toIsoPlan(current);
  const nextIso = toIsoPlan(next);
  const changes: EapScheduleFieldChange[] = [
    ...(startChanged ? [classifyFieldChange("START", previousIso.startAt, nextIso.startAt)] : []),
    ...(endChanged ? [classifyFieldChange("END", previousIso.endAt, nextIso.endAt)] : []),
  ];
  const isReschedule = changes.some((change) => change.kind === "RESCHEDULED");
  if (isReschedule && (!justification || justification.length < 10)) {
    throw new HttpError(
      400,
      cascadeFrom
        ? "Estender o prazo da fase é uma reprogramação: informe justificativa com ao menos 10 caracteres."
        : "A reprogramação exige justificativa com ao menos 10 caracteres.",
      "SCHEDULE_JUSTIFICATION_REQUIRED",
    );
  }

  const impacts = await detectImpacts(repos, project, subject, next);
  const escalatedToPmo = isReschedule && impacts.some((impact) => ESCALATING_IMPACTS.has(impact.code));
  const previousEntries = isReschedule
    ? await repos.audit.listByAction({
        projectId,
        action: "SCHEDULE_CHANGE",
        entityType: subject.entityType,
        entityId,
      })
    : [];
  const sequence = isReschedule ? previousEntries.filter(isRescheduleEntry).length + 1 : null;

  const now = new Date();
  const wasOverdue = current.endAt !== null && civilDayKey(current.endAt) < civilDayKey(now);
  const baseline: SchedulePlan = {
    startAt: single ? null : (subject.baseline.startAt ?? current.startAt ?? next.startAt),
    endAt: subject.baseline.endAt ?? current.endAt ?? next.endAt,
  };

  const updated = await applyPlan(repos, projectId, subject, next, baseline, actor.id, now);
  if (!updated) {
    throw subject.entityType === "TASK"
      ? taskNotFoundError()
      : subject.entityType === "MILESTONE"
        ? milestoneNotFoundError()
        : phaseNotFoundError();
  }

  const described = changes.map((change) => describeChange(change, single)).join("; ");
  const reason = cascadeFrom ? ` para cobrir ${cascadeFrom}` : "";
  const summary = isReschedule
    ? `Prazo ${subject.label} reprogramado${reason} (reprogramação nº ${sequence}): ${described}.`
    : `Planejamento ${subject.label} definido${reason}: ${described}.`;

  const entry = await repos.audit.create({
    id: crypto.randomUUID(),
    projectId,
    entityType: subject.entityType,
    entityId,
    action: "SCHEDULE_CHANGE",
    summary,
    payload: {
      kind: isReschedule ? "RESCHEDULE" : "PLANNING_DEFINED",
      sequence,
      previous: previousIso,
      next: nextIso,
      changes,
      baseline: toIsoPlan(baseline),
      justification,
      impacts,
      escalatedToPmo,
      wasOverdue: isReschedule && wasOverdue,
      ...(cascadeFrom ? { cascadeFrom } : {}),
      ...(subject.entityType === "PROJECT" ? {} : { phaseId: subject.phase.id }),
    },
    actorId: actor.id,
  });

  if (subject.entityType === "TASK" || subject.entityType === "MILESTONE") {
    await syncPhaseStatus(repos, {
      projectId,
      phaseId: subject.phase.id,
      actorId: actor.id,
      cause: `Prazo ${subject.label} alterado.`,
    });
  }

  return toEapScheduleChangeDto({ ...entry, actorName: actor.name });
}

function earliestOf(left: Date | null, right: Date | null) {
  return left && right ? (left < right ? left : right) : (left ?? right);
}

function latestOf(left: Date | null, right: Date | null) {
  return left && right ? (left > right ? left : right) : (left ?? right);
}

/** Planejamento da fase estendido para cobrir o item; null quando o item já cabe nele. Nunca reduz o prazo. */
export function phaseCoverage(phase: Pick<EapPhaseRow, "plannedStartAt" | "plannedEndAt">, item: SchedulePlan): SchedulePlan | null {
  const itemStart = item.startAt ?? item.endAt;
  const itemEnd = item.endAt ?? item.startAt;
  if (!itemStart || !itemEnd) {
    return null;
  }
  const current = { startAt: phase.plannedStartAt, endAt: phase.plannedEndAt };
  if (!current.startAt && !current.endAt) {
    return { startAt: itemStart, endAt: itemEnd };
  }
  const startAt = isBefore(itemStart, current.startAt) ? itemStart : current.startAt;
  const endAt = isAfter(itemEnd, current.endAt) ? itemEnd : current.endAt;
  return sameDay(startAt, current.startAt) && sameDay(endAt, current.endAt) ? null : { startAt, endAt };
}

/**
 * Ajuste em cascata: estende o planejamento da fase para cobrir a tarefa ou o marco, como uma
 * reprogramação da fase com a mesma justificativa e registro próprio no histórico. Só ocorre quando
 * o usuário confirma; sem confirmação, o item fora da fase é apenas sinalizado como impacto.
 */
export async function extendPhaseToCover(
  repos: EapRepos,
  project: ProjectRow,
  actor: AuthUser,
  input: {
    phaseId: string;
    item: SchedulePlan;
    /** Item reprogramado: suas datas atuais são substituídas pelas novas no período consolidado. */
    replaces?: { entityType: "TASK" | "MILESTONE"; id: string };
    itemLabel: string;
    justification: string | null;
  },
) {
  const phase = await repos.phases.findByIdAndProject(input.phaseId, project.id);
  if (!phase) {
    throw phaseNotFoundError();
  }
  // Período consolidado de todos os itens da fase, já com as novas datas do item, em qualquer ordem.
  const [tasks, milestones] = await Promise.all([
    repos.tasks.listByPhase(phase.id),
    repos.milestones.listByPhase(phase.id),
  ]);
  const replaced = input.replaces;
  const consolidated = phaseDates(
    tasks.map((task) =>
      replaced?.entityType === "TASK" && task.id === replaced.id
        ? { ...task, plannedStartAt: input.item.startAt, plannedEndAt: input.item.endAt }
        : task,
    ),
    milestones.map((milestone) =>
      replaced?.entityType === "MILESTONE" && milestone.id === replaced.id
        ? { ...milestone, plannedAt: input.item.endAt }
        : milestone,
    ),
    false,
  );
  const extended = phaseCoverage(phase, {
    startAt: earliestOf(consolidated.plannedStartAt, input.item.startAt ?? input.item.endAt),
    endAt: latestOf(consolidated.plannedEndAt, input.item.endAt),
  });
  if (!extended) {
    return null;
  }
  return changeSchedule(
    repos,
    project,
    actor,
    { entityType: "PHASE", phaseId: phase.id },
    extended,
    input.justification,
    input.itemLabel,
  );
}

export function makeRescheduleUseCase(deps: { repos: EapRepos; runInTransaction: EapTransactionRunner }) {
  return async function reschedule(
    actor: AuthUser,
    projectId: string,
    target: RescheduleTarget,
    input: RescheduleRangeInput | RescheduleMilestoneInput,
  ) {
    const { project, context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    assertCanRescheduleEap(context);

    const next = nextPlan(target, input);
    const justification = input.justification?.trim() ? input.justification.trim() : null;

    return deps.runInTransaction(async (txRepos) => {
      // A fase é estendida antes, para os impactos do item já considerarem o novo planejamento dela.
      if (input.extendPhase && (target.entityType === "TASK" || target.entityType === "MILESTONE")) {
        const subject = await loadSubject(txRepos, project, target);
        await extendPhaseToCover(txRepos, project, actor, {
          phaseId: target.phaseId,
          item: next,
          replaces:
            target.entityType === "TASK"
              ? { entityType: "TASK", id: target.taskId }
              : { entityType: "MILESTONE", id: target.milestoneId },
          itemLabel: subject.label,
          justification,
        });
      }
      return changeSchedule(txRepos, project, actor, target, next, justification);
    });
  };
}

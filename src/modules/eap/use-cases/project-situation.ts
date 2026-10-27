import type { EapMilestoneDeliveryRow } from "../dtos/eap-milestone-deliveries.dto";
import type { EapMilestoneRow } from "../dtos/eap-milestones.dto";
import type { EapPhaseRow } from "../dtos/eap-phases.dto";
import type { EapTaskRow } from "../dtos/eap-tasks.dto";
import type { EapRepos } from "../repositories/contracts";
import { calculatedPhaseStatus, calculatedTaskStatus, civilDayKey } from "./eap-status";

export type ProjectSituationStatus =
  | "SUSPENSO"
  | "CONCLUIDO"
  | "CRITICO"
  | "EM_ATENCAO"
  | "EM_VALIDACAO"
  | "EM_EXECUCAO"
  | "NAO_INICIADO";

export type ProjectSituation = {
  status: ProjectSituationStatus;
  /** Maior atraso elegível, em dias corridos (0 sem atraso). */
  delayDays: number;
  delayedItems: number;
  /** Marcos entregues aguardando validação; aparece mesmo quando o atraso prevalece. */
  pendingValidation: number;
  /** Suspensão ou encerramento registrados por decisão no histórico do projeto. */
  formalDecision: { status: "SUSPENSO" | "CONCLUIDO"; decidedAt: string } | null;
  /** Encerramento registrado sem todos os requisitos (todas as fases concluídas). */
  closureRequirementsMissing: boolean;
  /**
   * Apto para encerramento: todas as fases concluídas pela regra da EAP (tarefas concluídas e marcos
   * aceitos), sem homologação pendente e sem encerramento formal. Não é uma situação: o projeto só
   * fica Concluído após a decisão formal. Projeto suspenso não é apto.
   */
  readyForClosure: boolean;
  /** Marcos entregues sem data de entrega conhecida: não entram no cálculo de atraso. */
  undatedDeliveries: number;
};

/** Limite de dias corridos: acima dele o atraso é crítico; de 1 até ele, atenção. */
export const CRITICAL_DELAY_DAYS = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

function dayDiff(laterKey: string, earlierKey: string) {
  return Math.round((Date.parse(`${laterKey}T00:00:00Z`) - Date.parse(`${earlierKey}T00:00:00Z`)) / DAY_MS);
}

/**
 * Situação automática do projeto, pela prioridade aprovada: Suspenso, Concluído, Crítico, Em atenção,
 * Em validação, Em execução e Não iniciado. Suspensão e encerramento só valem como decisão formal:
 * a situação gravada precisa ter sido registrada no histórico do projeto (alteração feita por uma
 * pessoa), e o encerramento ainda exige todas as fases concluídas. O atraso considera só pendências
 * atribuíveis à execução: tarefas abertas vencidas, marcos vencidos sem entrega (ou devolvidos) e
 * marcos entregues depois do prazo. Marco entregue no prazo e aguardando validação não é atraso.
 * Itens de fase suspensa ficam fora do atraso.
 */
export function projectSituation(input: {
  projectStatus: string;
  /** Alterações manuais da situação do projeto, registradas no histórico. */
  statusHistory: ReadonlyArray<{ to: string; createdAt: Date }>;
  phases: ReadonlyArray<EapPhaseRow>;
  tasks: ReadonlyArray<EapTaskRow>;
  milestones: ReadonlyArray<EapMilestoneRow>;
  deliveries: ReadonlyArray<Pick<EapMilestoneDeliveryRow, "milestoneId" | "submittedAt">>;
  now?: Date;
}): ProjectSituation {
  const today = civilDayKey(input.now ?? new Date());
  const latestChange = [...input.statusHistory].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
  const decided = latestChange?.to === input.projectStatus ? latestChange.to : null;
  const formalDecision: ProjectSituation["formalDecision"] =
    latestChange && (decided === "SUSPENSO" || decided === "CONCLUIDO")
      ? { status: decided, decidedAt: latestChange.createdAt.toISOString() }
      : null;

  const suspendedPhases = new Set(input.phases.filter((phase) => phase.status === "SUSPENSA").map((phase) => phase.id));
  let delayDays = 0;
  let delayedItems = 0;
  let pendingValidation = 0;
  let undatedDeliveries = 0;
  const registerDelay = (days: number) => {
    if (days > 0) {
      delayDays = Math.max(delayDays, days);
      delayedItems += 1;
    }
  };

  for (const task of input.tasks) {
    const status = calculatedTaskStatus(task);
    if (suspendedPhases.has(task.phaseId) || status === "CONCLUIDA" || status === "CANCELADA" || !task.plannedEndAt) {
      continue;
    }
    registerDelay(dayDiff(today, civilDayKey(task.plannedEndAt)));
  }

  for (const milestone of input.milestones) {
    if (milestone.status === "ENTREGUE") {
      pendingValidation += 1;
    }
    if (suspendedPhases.has(milestone.phaseId) || milestone.status === "APROVADO" || !milestone.plannedAt) {
      continue;
    }
    const planned = civilDayKey(milestone.plannedAt);
    if (milestone.status === "ENTREGUE") {
      const delivered = latestDelivery(milestone, input.deliveries);
      if (!delivered) {
        undatedDeliveries += 1;
        continue;
      }
      registerDelay(dayDiff(civilDayKey(delivered), planned));
      continue;
    }
    // Pendente, rejeitado ou com ajustes solicitados: a entrega (ou a correção) cabe à execução.
    registerDelay(dayDiff(today, planned));
  }

  const allPhasesConcluded =
    input.phases.length > 0 &&
    input.phases.every((phase) => {
      const phaseTasks = input.tasks.filter((task) => task.phaseId === phase.id);
      const phaseMilestones = input.milestones.filter((milestone) => milestone.phaseId === phase.id);
      return calculatedPhaseStatus(phase, phaseTasks, phaseMilestones) === "CONCLUIDA";
    });
  const closureRequirementsMissing = formalDecision?.status === "CONCLUIDO" && !allPhasesConcluded;

  const started =
    input.tasks.some((task) => task.actualStartAt !== null || task.progressPercent > 0) ||
    input.milestones.some((milestone) => milestone.status !== "PENDENTE") ||
    input.phases.some((phase) => phase.actualStartAt !== null);

  const status: ProjectSituationStatus =
    formalDecision?.status === "SUSPENSO"
      ? "SUSPENSO"
      : formalDecision?.status === "CONCLUIDO" && allPhasesConcluded
        ? "CONCLUIDO"
        : delayDays > CRITICAL_DELAY_DAYS
          ? "CRITICO"
          : delayDays >= 1
            ? "EM_ATENCAO"
            : pendingValidation > 0
              ? "EM_VALIDACAO"
              : started
                ? "EM_EXECUCAO"
                : "NAO_INICIADO";

  const readyForClosure = allPhasesConcluded && pendingValidation === 0 && status !== "SUSPENSO" && status !== "CONCLUIDO";

  return { status, delayDays, delayedItems, pendingValidation, formalDecision, closureRequirementsMissing, readyForClosure, undatedDeliveries };
}

/** Alterações de situação do projeto feitas por uma pessoa (as automáticas não contam como decisão formal). */
export function formalStatusHistory(entries: ReadonlyArray<{ payload: unknown; createdAt: Date }>) {
  return entries.flatMap((entry) => {
    const payload = entry.payload as { to?: unknown; automatic?: unknown } | null;
    return typeof payload?.to === "string" && payload.automatic !== true ? [{ to: payload.to, createdAt: entry.createdAt }] : [];
  });
}

/** Situação do projeto lida do repositório: mesma regra do monitoramento e do encerramento. */
export async function loadProjectSituation(repos: EapRepos, project: { id: string; status: string }, now = new Date()) {
  const [phases, tasks, milestones, deliveries, statusChanges] = await Promise.all([
    repos.phases.listByProject(project.id),
    repos.tasks.listByProject(project.id),
    repos.milestones.listByProject(project.id),
    repos.deliveries.listByProject(project.id),
    repos.audit.listByAction({ projectId: project.id, action: "STATUS_CHANGE", entityType: "PROJECT", entityId: project.id }),
  ]);
  return projectSituation({
    projectStatus: project.status,
    statusHistory: formalStatusHistory(statusChanges),
    phases,
    tasks,
    milestones,
    deliveries,
    now,
  });
}

/** Data da entrega em análise: a rodada mais recente; em marcos legados, a data efetiva gravada no envio. */
function latestDelivery(
  milestone: Pick<EapMilestoneRow, "id" | "actualAt">,
  deliveries: ReadonlyArray<Pick<EapMilestoneDeliveryRow, "milestoneId" | "submittedAt">>,
) {
  const submitted = deliveries
    .filter((delivery) => delivery.milestoneId === milestone.id && delivery.submittedAt)
    .map((delivery) => delivery.submittedAt as Date)
    .sort((left, right) => right.getTime() - left.getTime())[0];
  return submitted ?? milestone.actualAt ?? null;
}

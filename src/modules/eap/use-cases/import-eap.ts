import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import type { ProjectAccessContext } from "../../projects/projects.authorization";
import type {
  EapImportInput,
  EapImportIssue,
  EapImportPreviewItem,
  EapImportResultDto,
  EapImportRow,
} from "../dtos/eap-import.dto";
import type { EapMilestoneRow } from "../dtos/eap-milestones.dto";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import { civilDayKey, phaseDates } from "./eap-status";
import {
  assertCanCreateItems,
  assertCanView,
  assertValidAssignee,
  assertValidMilestonePresenter,
  assertValidMilestoneReviewer,
  loadProjectAccess,
} from "./shared";

type Person = { id: string; name: string };

type Plan = { startAt: Date | null; endAt: Date | null };

type ParsedPhase = {
  row: EapImportRow;
  index: number;
  responsible: Person;
  /** Planejamento informado na planilha: é o gravado na fase, nunca recalculado pelos itens. */
  plan: Plan;
  items: ParsedItem[];
};

type ParsedItem =
  | { kind: "TASK"; row: EapImportRow; order: number; assignee: Person | null; startAt: Date | null; endAt: Date | null }
  | {
      kind: "MILESTONE";
      row: EapImportRow;
      order: number;
      presenter: Person;
      reviewer: Person;
      type: EapMilestoneRow["type"];
      plannedAt: Date | null;
    };

const KINDS: Record<string, "PHASE" | "TASK" | "MILESTONE"> = { fase: "PHASE", tarefa: "TASK", marco: "MILESTONE" };
const MILESTONE_TYPES: Record<string, EapMilestoneRow["type"]> = {
  entrega: "ENTREGA",
  aprovacao: "APROVACAO",
  homologacao: "HOMOLOGACAO",
};

function plain(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function text(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Data civil da planilha (dd/mm/aaaa ou aaaa-mm-dd), gravada ao meio-dia de Belém como no restante da EAP. */
export function parseImportDate(value: string | null | undefined): Date | null | "invalid" {
  const raw = text(value);
  if (!raw) {
    return null;
  }
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw) ?? /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) {
    return "invalid";
  }
  const [year, month, day] = raw.includes("/")
    ? [Number(match[3]), Number(match[2]), Number(match[1])]
    : [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day, 15));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return "invalid";
  }
  return date;
}

async function validationMessage(check: () => Promise<void>) {
  try {
    await check();
    return null;
  } catch (error) {
    if (error instanceof HttpError) {
      return error.message;
    }
    throw error;
  }
}

const dayFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Belem", day: "2-digit", month: "2-digit", year: "numeric" });

/**
 * Importação inicial da EAP por planilha, permitida apenas em projeto sem fases, tarefas ou marcos
 * (sem importação incremental, substituição ou mesclagem). Valida tudo antes (códigos, hierarquia,
 * datas, responsáveis e papéis) e devolve os erros por linha; só com confirmação e sem erros grava
 * todos os itens numa única transação. Cada fase recebe o planejamento informado na planilha; o
 * período consolidado dos itens é calculado à parte e a divergência é apenas sinalizada.
 */
export function makeImportEapUseCase(deps: { repos: EapRepos; runInTransaction: EapTransactionRunner }) {
  return async function importEap(actor: AuthUser, projectId: string, input: EapImportInput): Promise<EapImportResultDto> {
    const { project, context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    assertCanCreateItems(context);
    await assertEmptyEap(deps.repos, projectId);

    const errors: EapImportIssue[] = [];
    const warnings: EapImportIssue[] = [];
    const fail = (line: number, field: string | null, message: string) => errors.push({ line, field, message });

    const [members, owner] = await Promise.all([
      deps.repos.members.listByProject(projectId),
      deps.repos.users.findById(project.ownerId),
    ]);
    // Pessoa pelo e-mail ou pelo nome; nome repetido entre participantes é ambíguo e exige o e-mail.
    const byEmail = new Map<string, Person>();
    const byName = new Map<string, Person | null>();
    const register = (id: string, name: string, email: string) => {
      byEmail.set(plain(email), { id, name });
      const known = byName.get(plain(name));
      byName.set(plain(name), known === undefined || known?.id === id ? { id, name } : null);
    };
    if (owner) {
      register(owner.id, owner.name, owner.email);
    }
    for (const { user } of members) {
      register(user.id, user.name, user.email);
    }
    const findPerson = (value: string | null | undefined) => byEmail.get(plain(value)) ?? byName.get(plain(value)) ?? null;

    // Datas planejadas de uma linha: inválidas, só uma das duas ou invertidas viram erro da linha.
    const readRange = (row: EapImportRow, required: boolean): Plan => {
      const start = parseImportDate(row.plannedStart);
      const end = parseImportDate(row.plannedEnd);
      if (start === "invalid") {
        fail(row.line, "Início planejado", "Data inválida; use dd/mm/aaaa.");
      }
      if (end === "invalid") {
        fail(row.line, "Término planejado", "Data inválida; use dd/mm/aaaa.");
      }
      if (start !== "invalid" && end !== "invalid") {
        if (required && (!start || !end)) {
          fail(row.line, start ? "Término planejado" : "Início planejado", "Informe o início e o término planejados da fase.");
        } else if ((start === null) !== (end === null)) {
          fail(row.line, "Término planejado", "Informe o início e o término planejados, ou deixe os dois em branco.");
        } else if (start && end && end < start) {
          fail(row.line, "Término planejado", "O término planejado não pode ser anterior ao início.");
        }
      }
      return { startAt: start instanceof Date ? start : null, endAt: end instanceof Date ? end : null };
    };

    // Estrutura: códigos únicos, fase "N" e itens "N.M" sob uma fase da própria planilha.
    const seenCodes = new Set<string>();
    const phases = new Map<string, ParsedPhase>();
    const pendingItems: Array<{ row: EapImportRow; kind: "TASK" | "MILESTONE"; phaseCode: string; order: number }> = [];

    for (const row of input.rows) {
      const kind = KINDS[plain(row.kind)];
      const code = row.code.trim();
      if (!kind) {
        fail(row.line, "Tipo", "Informe o tipo: Fase, Tarefa ou Marco.");
        continue;
      }
      if (!text(row.name)) {
        fail(row.line, "Nome", "Informe o nome do item.");
      }
      if (!/^\d+(\.\d+)?$/.test(code)) {
        fail(row.line, "Código EAP", "Use o código no formato 1 (fase) ou 1.1 (tarefa ou marco da fase 1).");
        continue;
      }
      if (seenCodes.has(code)) {
        fail(row.line, "Código EAP", `O código ${code} aparece mais de uma vez na planilha.`);
        continue;
      }
      seenCodes.add(code);
      const [phaseCode, itemOrder] = code.split(".");
      if (kind === "PHASE") {
        if (itemOrder !== undefined) {
          fail(row.line, "Código EAP", "Fase usa código de um nível (ex.: 1).");
          continue;
        }
        const responsible = findPerson(row.responsible);
        if (!text(row.responsible)) {
          fail(row.line, "Responsável", "Informe o responsável pela fase (e-mail ou nome do participante).");
        } else if (!responsible) {
          fail(row.line, "Responsável", `"${row.responsible}" não é participante do projeto.`);
        }
        if (text(row.reviewer) || text(row.milestoneType)) {
          fail(row.line, text(row.reviewer) ? "Gestor validador" : "Tipo do marco", "Preencha esta coluna somente nas linhas de marco.");
        }
        phases.set(phaseCode, {
          row,
          index: Number(phaseCode),
          responsible: responsible ?? { id: "", name: "" },
          plan: readRange(row, true),
          items: [],
        });
        continue;
      }
      if (itemOrder === undefined) {
        fail(row.line, "Código EAP", `${kind === "TASK" ? "Tarefa" : "Marco"} usa código de dois níveis (ex.: 1.1).`);
        continue;
      }
      if (text(row.completionCriteria)) {
        fail(row.line, "Critério de conclusão", "Preencha esta coluna somente nas linhas de fase.");
      }
      pendingItems.push({ row, kind, phaseCode, order: Number(itemOrder) });
    }

    for (const pending of pendingItems) {
      const { row } = pending;
      const phase = phases.get(pending.phaseCode);
      if (!phase) {
        fail(row.line, "Código EAP", `A fase ${pending.phaseCode} não está na planilha.`);
        continue;
      }

      if (pending.kind === "TASK") {
        const assignee = text(row.responsible) ? findPerson(row.responsible) : null;
        if (text(row.responsible) && !assignee) {
          fail(row.line, "Responsável", `"${row.responsible}" não é participante do projeto.`);
        }
        if (text(row.reviewer) || text(row.milestoneType)) {
          fail(row.line, text(row.reviewer) ? "Gestor validador" : "Tipo do marco", "Preencha esta coluna somente nas linhas de marco.");
        }
        const range = readRange(row, false);
        phase.items.push({ kind: "TASK", row, order: pending.order, assignee, startAt: range.startAt, endAt: range.endAt });
        continue;
      }

      const presenter = findPerson(row.responsible);
      const reviewer = findPerson(row.reviewer);
      const type = MILESTONE_TYPES[plain(row.milestoneType) || "entrega"];
      const date = parseImportDate(row.plannedEnd);
      if (!type) {
        fail(row.line, "Tipo do marco", "Use Entrega, Aprovação ou Homologação.");
      }
      if (text(row.plannedStart)) {
        fail(row.line, "Início planejado", "Marco tem data única: deixe o início em branco e informe a data no término planejado.");
      }
      if (date === "invalid") {
        fail(row.line, "Término planejado", "Data inválida; use dd/mm/aaaa.");
      } else if (date === null) {
        fail(row.line, "Término planejado", "Informe a data prevista do marco na coluna Término planejado.");
      }
      if (!text(row.responsible)) {
        fail(row.line, "Responsável", "Informe quem apresenta o marco (e-mail ou nome do participante).");
      } else if (!presenter) {
        fail(row.line, "Responsável", `"${row.responsible}" não é participante do projeto.`);
      }
      if (!text(row.reviewer)) {
        fail(row.line, "Gestor validador", "Informe o gestor que valida o marco.");
      } else if (!reviewer) {
        fail(row.line, "Gestor validador", `"${row.reviewer}" não é participante do projeto.`);
      }
      if (presenter && reviewer && presenter.id === reviewer.id) {
        fail(row.line, "Gestor validador", "Quem apresenta o marco não pode ser o gestor que vai validá-lo.");
      }
      phase.items.push({
        kind: "MILESTONE",
        row,
        order: pending.order,
        presenter: presenter ?? { id: "", name: "" },
        reviewer: reviewer ?? { id: "", name: "" },
        type: type ?? "ENTREGA",
        plannedAt: date instanceof Date ? date : null,
      });
    }

    // Papéis de responsável, apresentador e gestor validador: as mesmas regras da criação manual.
    await validatePeople(deps.repos, context, projectId, project.ownerId, [...phases.values()], fail);

    const ordered = [...phases.values()].sort((left, right) => left.index - right.index);
    for (const phase of ordered) {
      phase.items.sort((left, right) => left.order - right.order);
    }
    // Período consolidado: calculado à parte, com todos os itens da fase; divergência só é sinalizada.
    const consolidated = new Map(ordered.map((phase) => [phase, consolidatedPlan(phase)]));
    for (const phase of ordered) {
      const period = consolidated.get(phase);
      const { startAt, endAt } = phase.plan;
      if (!period || !startAt || !endAt) {
        continue;
      }
      const before = period.startAt && civilDayKey(period.startAt) < civilDayKey(startAt);
      const after = period.endAt && civilDayKey(period.endAt) > civilDayKey(endAt);
      if (before || after) {
        warnings.push({
          line: phase.row.line,
          field: "Término planejado",
          message: `Os itens da fase vão de ${formatDay(period.startAt)} a ${formatDay(period.endAt)}, fora do planejamento informado (${formatDay(startAt)} a ${formatDay(endAt)}). O planejamento da planilha é mantido e a divergência fica sinalizada na EAP.`,
        });
      }
    }

    const items = preview(ordered, consolidated);
    const summary = {
      phases: ordered.length,
      tasks: ordered.reduce((total, phase) => total + phase.items.filter((item) => item.kind === "TASK").length, 0),
      milestones: ordered.reduce((total, phase) => total + phase.items.filter((item) => item.kind === "MILESTONE").length, 0),
    };
    if (ordered.length === 0) {
      fail(input.rows[0]?.line ?? 1, "Tipo", "A planilha precisa ter ao menos uma fase.");
    }
    errors.sort((left, right) => left.line - right.line);
    const valid = errors.length === 0;

    if (!input.confirm || !valid) {
      return { valid, committed: false, errors, warnings, summary, items };
    }

    await deps.runInTransaction(async (txRepos) => {
      // Revalida dentro da transação: outra pessoa pode ter criado itens desde a pré-visualização.
      await assertEmptyEap(txRepos, projectId);
      const importId = crypto.randomUUID();
      const createdPhases: string[] = [];
      for (const [position, phase] of ordered.entries()) {
        const created = await txRepos.phases.create({
          id: crypto.randomUUID(),
          projectId,
          name: phase.row.name.trim(),
          description: text(phase.row.description),
          sortOrder: position,
          status: "NAO_INICIADA",
          responsibleId: phase.responsible.id,
          completionCriteria: text(phase.row.completionCriteria),
          plannedStartAt: phase.plan.startAt,
          plannedEndAt: phase.plan.endAt,
          baselineStartAt: phase.plan.startAt,
          baselineEndAt: phase.plan.endAt,
          createdBy: actor.id,
          updatedBy: actor.id,
        });
        createdPhases.push(created.id);
        await txRepos.audit.create({
          id: crypto.randomUUID(),
          projectId,
          entityType: "PHASE",
          entityId: created.id,
          action: "CREATE",
          summary: `Fase "${created.name}" criada por importação de EAP.`,
          payload: {
            importId,
            sortOrder: created.sortOrder,
            responsibleId: created.responsibleId,
            completionCriteria: created.completionCriteria,
            plannedStartAt: created.plannedStartAt?.toISOString() ?? null,
            plannedEndAt: created.plannedEndAt?.toISOString() ?? null,
          },
          actorId: actor.id,
        });

        for (const [order, item] of phase.items.entries()) {
          if (item.kind === "TASK") {
            const task = await txRepos.tasks.create({
              id: crypto.randomUUID(),
              phaseId: created.id,
              title: item.row.name.trim(),
              description: text(item.row.description),
              sortOrder: order,
              assigneeId: item.assignee?.id ?? null,
              status: "NAO_INICIADA",
              progressPercent: 0,
              weight: 1,
              plannedStartAt: item.startAt,
              plannedEndAt: item.endAt,
              baselineStartAt: item.startAt,
              baselineEndAt: item.endAt,
              correctiveMilestoneId: null,
              createdBy: actor.id,
              updatedBy: actor.id,
            });
            await txRepos.audit.create({
              id: crypto.randomUUID(),
              projectId,
              entityType: "TASK",
              entityId: task.id,
              action: "CREATE",
              summary: `Tarefa "${task.title}" criada por importação de EAP.`,
              payload: {
                importId,
                phaseId: created.id,
                assigneeId: task.assigneeId,
                status: task.status,
                plannedStartAt: task.plannedStartAt?.toISOString() ?? null,
                plannedEndAt: task.plannedEndAt?.toISOString() ?? null,
              },
              actorId: actor.id,
            });
            continue;
          }
          const milestone = await txRepos.milestones.create({
            id: crypto.randomUUID(),
            phaseId: created.id,
            title: item.row.name.trim(),
            description: text(item.row.description),
            sortOrder: order,
            type: item.type,
            status: "PENDENTE",
            plannedAt: item.plannedAt,
            baselineAt: item.plannedAt,
            reviewerId: item.reviewer.id,
            presenterId: item.presenter.id,
            createdBy: actor.id,
            updatedBy: actor.id,
          });
          await txRepos.audit.create({
            id: crypto.randomUUID(),
            projectId,
            entityType: "MILESTONE",
            entityId: milestone.id,
            action: "CREATE",
            summary: `Marco "${milestone.title}" criado por importação de EAP.`,
            payload: {
              importId,
              phaseId: created.id,
              type: milestone.type,
              plannedAt: milestone.plannedAt?.toISOString() ?? null,
              reviewerId: milestone.reviewerId,
              presenterId: milestone.presenterId,
            },
            actorId: actor.id,
          });
        }
      }

      await txRepos.audit.create({
        id: crypto.randomUUID(),
        projectId,
        entityType: "PROJECT",
        entityId: projectId,
        action: "CREATE",
        summary: `EAP importada${input.fileName ? ` de "${input.fileName}"` : ""}: ${summary.phases} fase(s), ${summary.tasks} tarefa(s) e ${summary.milestones} marco(s).`,
        payload: { kind: "EAP_IMPORT", importId, fileName: input.fileName ?? null, ...summary, phaseIds: createdPhases },
        actorId: actor.id,
      });
    });

    return { valid, committed: true, errors, warnings, summary, items };
  };
}

/** Importação apenas na carga inicial: o projeto não pode ter fases, tarefas nem marcos. */
async function assertEmptyEap(repos: EapRepos, projectId: string) {
  const [phases, tasks, milestones] = await Promise.all([
    repos.phases.listByProject(projectId),
    repos.tasks.listByProject(projectId),
    repos.milestones.listByProject(projectId),
  ]);
  if (phases.length > 0 || tasks.length > 0 || milestones.length > 0) {
    throw new HttpError(
      409,
      "A importação é permitida somente em projeto sem fases, tarefas ou marcos cadastrados.",
      "EAP_IMPORT_PROJECT_NOT_EMPTY",
    );
  }
}

async function validatePeople(
  repos: EapRepos,
  context: ProjectAccessContext,
  projectId: string,
  ownerId: string,
  phases: ParsedPhase[],
  fail: (line: number, field: string | null, message: string) => void,
) {
  const checked = new Map<string, string | null>();
  const once = async (key: string, check: () => Promise<void>) => {
    if (!checked.has(key)) {
      checked.set(key, await validationMessage(check));
    }
    return checked.get(key) ?? null;
  };

  for (const phase of phases) {
    if (phase.responsible.id) {
      const message = await once(`assignee:${phase.responsible.id}`, () =>
        assertValidAssignee(repos, projectId, ownerId, phase.responsible.id, "PHASE_RESPONSIBLE_NOT_MEMBER"),
      );
      if (message) fail(phase.row.line, "Responsável", message);
    }
    for (const item of phase.items) {
      if (item.kind === "TASK") {
        if (item.assignee) {
          const message = await once(`assignee:${item.assignee.id}`, () =>
            assertValidAssignee(repos, projectId, ownerId, item.assignee?.id),
          );
          if (message) fail(item.row.line, "Responsável", message);
        }
        continue;
      }
      if (item.reviewer.id) {
        const message = await once(`reviewer:${item.reviewer.id}`, () =>
          assertValidMilestoneReviewer(repos, context, projectId, item.reviewer.id),
        );
        if (message) fail(item.row.line, "Gestor validador", message);
      }
      if (item.presenter.id) {
        const message = await once(`presenter:${item.presenter.id}`, () =>
          assertValidMilestonePresenter(repos, context, projectId, item.presenter.id, null),
        );
        if (message) fail(item.row.line, "Responsável", message);
      }
    }
  }
}

/** Período consolidado dos itens da fase (mesma regra da EAP): menor início e maior término, em qualquer ordem. */
function consolidatedPlan(phase: ParsedPhase): Plan {
  const tasks = phase.items.flatMap((item) =>
    item.kind === "TASK"
      ? [{ status: "NAO_INICIADA" as const, plannedStartAt: item.startAt, plannedEndAt: item.endAt, actualStartAt: null, actualEndAt: null }]
      : [],
  );
  const milestones = phase.items.flatMap((item) =>
    item.kind === "MILESTONE" ? [{ status: "PENDENTE" as const, plannedAt: item.plannedAt, actualAt: null }] : [],
  );
  const dates = phaseDates(tasks, milestones, false);
  return { startAt: dates.plannedStartAt, endAt: dates.plannedEndAt };
}

function formatDay(value: Date | null) {
  return value ? dayFormatter.format(value) : "sem data";
}

function preview(phases: ParsedPhase[], consolidated: Map<ParsedPhase, Plan>): EapImportPreviewItem[] {
  const iso = (value: Date | null) => value?.toISOString() ?? null;
  return phases.flatMap((phase, position) => {
    const finalCode = String(position + 1);
    const period = consolidated.get(phase);
    return [
      {
        line: phase.row.line,
        code: phase.row.code.trim(),
        finalCode,
        kind: "PHASE" as const,
        name: phase.row.name.trim(),
        parentCode: null,
        responsibleName: phase.responsible.name || null,
        reviewerName: null,
        plannedStartAt: iso(phase.plan.startAt),
        plannedEndAt: iso(phase.plan.endAt),
        consolidatedStartAt: iso(period?.startAt ?? null),
        consolidatedEndAt: iso(period?.endAt ?? null),
      },
      ...phase.items.map((item, order) => ({
        line: item.row.line,
        code: item.row.code.trim(),
        finalCode: `${finalCode}.${order + 1}`,
        kind: item.kind,
        name: item.row.name.trim(),
        parentCode: phase.row.code.trim(),
        responsibleName: item.kind === "TASK" ? (item.assignee?.name ?? null) : item.presenter.name || null,
        reviewerName: item.kind === "MILESTONE" ? item.reviewer.name || null : null,
        plannedStartAt: item.kind === "TASK" ? iso(item.startAt) : null,
        plannedEndAt: item.kind === "TASK" ? iso(item.endAt) : iso(item.plannedAt),
        consolidatedStartAt: null,
        consolidatedEndAt: null,
      })),
    ];
  });
}

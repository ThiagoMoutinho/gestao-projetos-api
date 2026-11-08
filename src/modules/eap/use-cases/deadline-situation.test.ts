import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthUser } from "../../../lib/session";
import type { EapMilestoneRow } from "../dtos/eap-milestones.dto";
import type { EapPhaseRow } from "../dtos/eap-phases.dto";
import type { EapTaskRow } from "../dtos/eap-tasks.dto";
import { eapScheduleMonitoringSchema } from "../schemas/eap-schedule.schema";
import {
  createEapInMemoryStore,
  makeEapInMemoryRepos,
  makeEapInMemoryTransactionRunner,
  makeProject,
  makeUser,
} from "../test/in-memory";
import { makeCreatePhaseUseCase } from "./create-phase";
import { makeCreateTaskUseCase } from "./create-task";
import { DEADLINE_ATTENTION_WINDOW_DAYS, deadlineSituation } from "./deadline-situation";
import { eapDelays } from "./eap-delay";
import { makeGetScheduleMonitoringUseCase } from "./get-schedule-monitoring";
import { projectSituation } from "./project-situation";
import { makeRescheduleUseCase } from "./reschedule";

const day = (value: string) => new Date(`${value}T15:00:00.000Z`);
const now = day("2026-10-26");
const IN_WINDOW = day("2026-11-10");
const WINDOW_LAST_DAY = day("2026-11-25");
const AFTER_WINDOW = day("2026-11-26");
const PAST = day("2026-10-20");

function phase(overrides: Partial<EapPhaseRow> = {}): EapPhaseRow {
  return { id: "f1", status: "EM_ANDAMENTO", actualStartAt: null, actualEndAt: null, ...overrides } as EapPhaseRow;
}

function task(overrides: Partial<EapTaskRow> = {}): EapTaskRow {
  return {
    id: "t1",
    phaseId: "f1",
    status: "EM_ANDAMENTO",
    progressPercent: 30,
    plannedStartAt: day("2026-10-01"),
    plannedEndAt: IN_WINDOW,
    actualStartAt: day("2026-10-01"),
    actualEndAt: null,
    hasImpediment: false,
    correctiveMilestoneId: null,
    ...overrides,
  } as EapTaskRow;
}

function milestone(overrides: Partial<EapMilestoneRow> = {}): EapMilestoneRow {
  return { id: "m1", phaseId: "f1", status: "PENDENTE", plannedAt: IN_WINDOW, actualAt: null, ...overrides } as EapMilestoneRow;
}

type Input = {
  situationStatus?: Parameters<typeof deadlineSituation>[0]["situationStatus"];
  projectPlannedEndAt?: Date | null;
  phases?: EapPhaseRow[];
  tasks?: EapTaskRow[];
  milestones?: EapMilestoneRow[];
  deliveries?: { milestoneId: string; submittedAt: Date | null }[];
};

function evaluate(input: Input = {}) {
  const phases = input.phases ?? [phase()];
  const tasks = input.tasks ?? [task()];
  const milestones = input.milestones ?? [];
  return deadlineSituation({
    situationStatus: input.situationStatus ?? "EM_EXECUCAO",
    projectPlannedEndAt: input.projectPlannedEndAt ?? null,
    phases,
    tasks,
    milestones,
    delays: eapDelays({ phases, tasks, milestones, deliveries: input.deliveries ?? [], now }),
    now,
  });
}

const impeded = task({ hasImpediment: true });
const overdue = task({ id: "t2", plannedEndAt: PAST });

describe("Situação do prazo: prioridade dos estados", () => {
  it("Concluído prevalece sobre atraso e risco", () => {
    assert.equal(evaluate({ situationStatus: "CONCLUIDO", tasks: [overdue, impeded] }).status, "CONCLUIDO");
  });

  it("Atrasado prevalece sobre Em atenção", () => {
    const result = evaluate({ tasks: [overdue, impeded] });
    assert.deepEqual([result.status, result.overdueCommitments, result.attentionItems.length], ["ATRASADO", 1, 1]);
  });

  it("Em atenção prevalece sobre No prazo", () => {
    assert.equal(evaluate({ tasks: [task({ id: "t2" }), impeded] }).status, "EM_ATENCAO");
  });

  it("No prazo quando nenhuma condição foi identificada", () => {
    const result = evaluate();
    assert.deepEqual([result.status, result.overdueCommitments, result.attentionItems], ["NO_PRAZO", 0, []]);
  });

  it("projeto suspenso fica fora dos quatro estados", () => {
    assert.equal(evaluate({ situationStatus: "SUSPENSO", tasks: [overdue] }).status, null);
  });

  it("encerramento sem os requisitos não vira Concluído: segue a avaliação do prazo", () => {
    assert.equal(evaluate({ situationStatus: "CRITICO", tasks: [overdue] }).status, "ATRASADO");
  });
});

describe("Situação do prazo: Atrasado", () => {
  it("considera tarefa aberta e marco pendente vencidos", () => {
    assert.equal(evaluate({ tasks: [overdue] }).status, "ATRASADO");
    assert.equal(evaluate({ tasks: [], milestones: [milestone({ plannedAt: PAST })] }).status, "ATRASADO");
  });

  it("considera o prazo final do projeto vencido, mesmo sem itens em atraso", () => {
    const result = evaluate({ projectPlannedEndAt: PAST, tasks: [] });
    assert.deepEqual([result.status, result.overdueCommitments], ["ATRASADO", 1]);
  });

  it("vencer hoje ainda não é atraso", () => {
    assert.equal(evaluate({ tasks: [task({ plannedEndAt: now })], projectPlannedEndAt: now }).status, "NO_PRAZO");
  });

  it("usa a data vigente, não a linha de base", () => {
    const rescheduled = task({ baselineEndAt: PAST, plannedEndAt: AFTER_WINDOW });
    assert.equal(evaluate({ tasks: [rescheduled], projectPlannedEndAt: AFTER_WINDOW }).status, "NO_PRAZO");
  });

  it("não conta tarefa concluída, tarefa cancelada nem item de fase suspensa", () => {
    assert.equal(evaluate({ tasks: [task({ plannedEndAt: PAST, progressPercent: 100, status: "CONCLUIDA" })] }).status, "NO_PRAZO");
    assert.equal(evaluate({ tasks: [task({ plannedEndAt: PAST, status: "CANCELADA" })] }).status, "NO_PRAZO");
    assert.equal(evaluate({ phases: [phase({ status: "SUSPENSA" })], tasks: [task({ plannedEndAt: PAST })] }).status, "NO_PRAZO");
  });
});

describe("Situação do prazo: homologação de marcos (regra existente)", () => {
  it("marco entregue no prazo e aguardando homologação não é atraso", () => {
    const delivered = milestone({ status: "ENTREGUE", plannedAt: PAST });
    assert.equal(
      evaluate({ tasks: [], milestones: [delivered], deliveries: [{ milestoneId: "m1", submittedAt: day("2026-10-19") }] }).status,
      "NO_PRAZO",
    );
  });

  it("marco entregue depois do prazo conta como atraso", () => {
    const delivered = milestone({ status: "ENTREGUE", plannedAt: PAST });
    assert.equal(
      evaluate({ tasks: [], milestones: [delivered], deliveries: [{ milestoneId: "m1", submittedAt: day("2026-10-22") }] }).status,
      "ATRASADO",
    );
  });

  it("marco aprovado não é atraso nem atenção", () => {
    assert.equal(evaluate({ tasks: [], milestones: [milestone({ status: "APROVADO", plannedAt: PAST })] }).status, "NO_PRAZO");
  });

  it("marco entregue na janela depende da homologação: tarefa corretiva impedida não gera atenção", () => {
    const corrective = task({ id: "t2", plannedEndAt: AFTER_WINDOW, hasImpediment: true, correctiveMilestoneId: "m1" });
    assert.equal(evaluate({ tasks: [corrective], milestones: [milestone({ status: "ENTREGUE" })] }).status, "NO_PRAZO");
  });
});

describe("Situação do prazo: Em atenção", () => {
  it("a proximidade do vencimento, isoladamente, não caracteriza risco", () => {
    const result = evaluate({ tasks: [task({ plannedEndAt: now })], milestones: [milestone()], projectPlannedEndAt: IN_WINDOW });
    assert.equal(result.status, "NO_PRAZO");
  });

  it("impedimento ativo em tarefa com vencimento na janela", () => {
    assert.deepEqual(evaluate({ tasks: [impeded] }).attentionItems, [{ entityType: "TASK", entityId: "t1", reason: "ACTIVE_IMPEDIMENT" }]);
  });

  it("a janela vai de hoje até o último dia, inclusive", () => {
    assert.equal(DEADLINE_ATTENTION_WINDOW_DAYS, 30);
    assert.equal(evaluate({ tasks: [task({ hasImpediment: true, plannedEndAt: now })] }).status, "EM_ATENCAO");
    assert.equal(evaluate({ tasks: [task({ hasImpediment: true, plannedEndAt: WINDOW_LAST_DAY })] }).status, "EM_ATENCAO");
    assert.equal(evaluate({ tasks: [task({ hasImpediment: true, plannedEndAt: AFTER_WINDOW })] }).status, "NO_PRAZO");
  });

  it("impedimento sem prazo ou em item encerrado não gera atenção", () => {
    assert.equal(evaluate({ tasks: [task({ hasImpediment: true, plannedEndAt: null })] }).status, "NO_PRAZO");
    assert.equal(evaluate({ tasks: [task({ hasImpediment: true, status: "CANCELADA" })] }).status, "NO_PRAZO");
    assert.equal(evaluate({ tasks: [task({ hasImpediment: true, progressPercent: 100, status: "CONCLUIDA" })] }).status, "NO_PRAZO");
    assert.equal(evaluate({ phases: [phase({ status: "SUSPENSA" })], tasks: [impeded] }).status, "NO_PRAZO");
  });

  it("início planejado passado sem início registrado, com vencimento na janela", () => {
    const late = task({ progressPercent: 0, status: "NAO_INICIADA", actualStartAt: null });
    assert.deepEqual(evaluate({ tasks: [late] }).attentionItems, [
      { entityType: "TASK", entityId: "t1", reason: "NOT_STARTED_AFTER_PLANNED_START" },
    ]);
  });

  it("não presume atraso de início sem registro suficiente", () => {
    const base = { progressPercent: 0, status: "NAO_INICIADA" as const, actualStartAt: null };
    assert.equal(evaluate({ tasks: [task({ ...base, plannedStartAt: null })] }).status, "NO_PRAZO");
    assert.equal(evaluate({ tasks: [task({ ...base, plannedStartAt: now })] }).status, "NO_PRAZO");
    assert.equal(evaluate({ tasks: [task({ ...base, plannedEndAt: AFTER_WINDOW })] }).status, "NO_PRAZO");
    assert.equal(evaluate({ tasks: [task({ ...base, actualStartAt: day("2026-10-02") })] }).status, "NO_PRAZO");
    assert.equal(evaluate({ tasks: [task({ ...base, progressPercent: 10, status: "EM_ANDAMENTO" })] }).status, "NO_PRAZO");
  });

  it("marco só recebe impedimento pelo vínculo explícito da tarefa corretiva", () => {
    const linked = task({ id: "t2", plannedEndAt: AFTER_WINDOW, hasImpediment: true, correctiveMilestoneId: "m1" });
    assert.deepEqual(evaluate({ tasks: [linked], milestones: [milestone({ status: "AJUSTES_SOLICITADOS" })] }).attentionItems, [
      { entityType: "MILESTONE", entityId: "m1", reason: "ACTIVE_IMPEDIMENT" },
    ]);
    const samePhase = task({ id: "t2", plannedEndAt: AFTER_WINDOW, hasImpediment: true });
    assert.equal(evaluate({ tasks: [samePhase], milestones: [milestone()] }).status, "NO_PRAZO");
  });

  it("informa os indicadores sem registro no sistema, sem presumi-los", () => {
    const result = evaluate();
    assert.deepEqual(result.unevaluatedIndicators, ["DEPENDENCIES", "FORMAL_RISKS"]);
    assert.equal(result.status, "NO_PRAZO");
  });
});

describe("Situação do prazo: compromissos datados", () => {
  it("informa quando não há compromisso datado", () => {
    const result = evaluate({ tasks: [task({ plannedEndAt: null })], milestones: [milestone({ plannedAt: null })] });
    assert.deepEqual([result.status, result.hasDatedCommitments], ["NO_PRAZO", false]);
    assert.equal(evaluate({ tasks: [], phases: [] }).hasDatedCommitments, false);
  });

  it("basta um compromisso datado: tarefa, marco ou prazo final do projeto", () => {
    assert.equal(evaluate().hasDatedCommitments, true);
    assert.equal(evaluate({ tasks: [], milestones: [milestone()] }).hasDatedCommitments, true);
    assert.equal(evaluate({ tasks: [], projectPlannedEndAt: AFTER_WINDOW }).hasDatedCommitments, true);
  });

  it("tarefa cancelada e item de fase suspensa não contam como compromisso", () => {
    assert.equal(evaluate({ tasks: [task({ status: "CANCELADA" })] }).hasDatedCommitments, false);
    assert.equal(evaluate({ phases: [phase({ status: "SUSPENSA" })] }).hasDatedCommitments, false);
  });
});

describe("Situação do prazo: independência da situação do projeto", () => {
  it("atraso de 3 dias: projeto Em atenção e prazo Atrasado, sem alterar projectSituation", () => {
    const phases = [phase()];
    const tasks = [task({ plannedEndAt: day("2026-10-23") })];
    const situation = projectSituation({ projectStatus: "EM_EXECUCAO", statusHistory: [], phases, tasks, milestones: [], deliveries: [], now });
    assert.equal(situation.status, "EM_ATENCAO");
    assert.equal(evaluate({ situationStatus: situation.status, phases, tasks }).status, "ATRASADO");
  });
});

describe("Monitoramento de prazos", () => {
  const pmo: AuthUser = { id: "pmo-1", name: "pmo-1", email: "pmo-1@igepps.test", role: "PMO" };
  const iso = (value: string) => `${value}T15:00:00.000Z`;

  async function setup() {
    const store = createEapInMemoryStore({
      users: [makeUser({ id: "pmo-1", role: "PMO" })],
      projects: [makeProject({ id: "project-1", ownerId: "owner-1" })],
      members: [],
    });
    const repos = makeEapInMemoryRepos(store);
    const deps = { repos, runInTransaction: makeEapInMemoryTransactionRunner(repos, store) };
    const createdPhase = await makeCreatePhaseUseCase(deps)(pmo, "project-1", { name: "Fase" });
    const created = await makeCreateTaskUseCase(deps)(pmo, "project-1", createdPhase.id, {
      title: "Tarefa",
      plannedStartAt: iso("2026-06-01"),
      plannedEndAt: iso("2026-06-30"),
    });
    return { store, createdPhase, created, monitoring: makeGetScheduleMonitoringUseCase(deps), reschedule: makeRescheduleUseCase(deps) };
  }

  it("expõe deadlineSituation no contrato, sem mudar a situação do projeto", async () => {
    const ctx = await setup();
    const row = ctx.store.tasks.find((item) => item.id === ctx.created.id)!;
    row.plannedEndAt = IN_WINDOW;
    row.progressPercent = 30;
    row.hasImpediment = true;

    const result = await ctx.monitoring(pmo, "project-1", now);

    assert.equal(eapScheduleMonitoringSchema.parse(result).deadlineSituation.status, "EM_ATENCAO");
    assert.deepEqual(result.deadlineSituation.attentionItems, [{ entityType: "TASK", entityId: ctx.created.id, reason: "ACTIVE_IMPEDIMENT" }]);
    assert.notEqual(result.situation.status, "EM_ATENCAO");
  });

  it("a quantidade de reprogramações não altera a situação do prazo", async () => {
    const ctx = await setup();
    const target = { entityType: "TASK" as const, phaseId: ctx.createdPhase.id, taskId: ctx.created.id };
    for (const end of ["2026-12-10", "2026-12-20", "2026-12-30"]) {
      await ctx.reschedule(pmo, "project-1", target, {
        plannedStartAt: iso("2026-06-01"),
        plannedEndAt: iso(end),
        justification: "Ajuste formal do planejamento.",
      });
    }

    const result = await ctx.monitoring(pmo, "project-1", now);

    assert.equal(result.reschedules.total, 3);
    assert.equal(result.deadlineSituation.status, "NO_PRAZO");
  });
});

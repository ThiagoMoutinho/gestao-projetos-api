import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EapMilestoneRow } from "../dtos/eap-milestones.dto";
import type { EapPhaseRow } from "../dtos/eap-phases.dto";
import type { EapTaskRow } from "../dtos/eap-tasks.dto";
import { projectSituation } from "./project-situation";

const day = (value: string) => new Date(`${value}T15:00:00.000Z`);
const now = day("2026-10-26");

function phase(overrides: Partial<EapPhaseRow> = {}): EapPhaseRow {
  return { id: "f1", status: "EM_ANDAMENTO", actualStartAt: null, actualEndAt: null, ...overrides } as EapPhaseRow;
}

function task(overrides: Partial<EapTaskRow> = {}): EapTaskRow {
  return {
    id: "t1",
    phaseId: "f1",
    status: "EM_ANDAMENTO",
    progressPercent: 30,
    plannedEndAt: day("2026-11-30"),
    actualStartAt: day("2026-10-01"),
    actualEndAt: null,
    hasImpediment: false,
    ...overrides,
  } as EapTaskRow;
}

function milestone(overrides: Partial<EapMilestoneRow> = {}): EapMilestoneRow {
  return { id: "m1", phaseId: "f1", status: "PENDENTE", plannedAt: day("2026-11-30"), actualAt: null, ...overrides } as EapMilestoneRow;
}

function situation(input: Partial<Parameters<typeof projectSituation>[0]> = {}) {
  return projectSituation({
    projectStatus: "EM_EXECUCAO",
    statusHistory: [],
    phases: [phase()],
    tasks: [task()],
    milestones: [],
    deliveries: [],
    now,
    ...input,
  });
}

describe("Situação automática do projeto", () => {
  it("atraso de 1 a 5 dias é atenção; acima de 5 dias é crítico", () => {
    assert.equal(situation({ tasks: [task({ plannedEndAt: day("2026-10-21") })] }).status, "EM_ATENCAO");
    const critical = situation({ tasks: [task({ plannedEndAt: day("2026-10-20") })] });
    assert.deepEqual([critical.status, critical.delayDays, critical.delayedItems], ["CRITICO", 6, 1]);
    assert.equal(situation({ tasks: [task({ plannedEndAt: day("2026-10-26") })] }).status, "EM_EXECUCAO");
  });

  it("marco entregue no prazo e aguardando validação não é atraso: fica em validação", () => {
    const delivered = milestone({ status: "ENTREGUE", plannedAt: day("2026-10-15") });
    const result = situation({ milestones: [delivered], deliveries: [{ milestoneId: "m1", submittedAt: day("2026-10-14") }] });
    assert.deepEqual([result.status, result.delayDays, result.pendingValidation], ["EM_VALIDACAO", 0, 1]);
  });

  it("marco entregue depois do prazo conta o atraso até a entrega", () => {
    const delivered = milestone({ status: "ENTREGUE", plannedAt: day("2026-10-10") });
    const result = situation({ milestones: [delivered], deliveries: [{ milestoneId: "m1", submittedAt: day("2026-10-13") }] });
    assert.deepEqual([result.status, result.delayDays], ["EM_ATENCAO", 3]);
  });

  it("atraso prevalece sobre homologação pendente, que continua visível", () => {
    const result = situation({
      tasks: [task({ plannedEndAt: day("2026-10-10") })],
      milestones: [milestone({ status: "ENTREGUE", plannedAt: day("2026-11-10") })],
      deliveries: [{ milestoneId: "m1", submittedAt: day("2026-10-20") }],
    });
    assert.deepEqual([result.status, result.pendingValidation], ["CRITICO", 1]);
  });

  it("marco vencido sem entrega, rejeitado ou em ajustes conta atraso desde a data prevista", () => {
    for (const status of ["PENDENTE", "REJEITADO", "AJUSTES_SOLICITADOS"] as const) {
      assert.equal(situation({ milestones: [milestone({ status, plannedAt: day("2026-10-24") })] }).delayDays, 2);
    }
    assert.equal(situation({ milestones: [milestone({ status: "APROVADO", plannedAt: day("2026-10-01") })] }).delayDays, 0);
  });

  it("ignora tarefas concluídas ou canceladas e itens de fase suspensa", () => {
    const late = day("2026-10-01");
    assert.equal(situation({ tasks: [task({ status: "CONCLUIDA", progressPercent: 100, plannedEndAt: late })] }).delayDays, 0);
    assert.equal(situation({ tasks: [task({ status: "CANCELADA", plannedEndAt: late })] }).delayDays, 0);
    assert.equal(situation({ phases: [phase({ status: "SUSPENSA" })], tasks: [task({ plannedEndAt: late })] }).delayDays, 0);
  });

  it("entrega sem data conhecida não entra no atraso e fica sinalizada", () => {
    const result = situation({ milestones: [milestone({ status: "ENTREGUE", plannedAt: day("2026-10-01") })] });
    assert.deepEqual([result.status, result.undatedDeliveries], ["EM_VALIDACAO", 1]);
  });

  it("suspensão só vale como decisão formal registrada no histórico", () => {
    const late = [task({ plannedEndAt: day("2026-10-10") })];
    assert.equal(situation({ projectStatus: "SUSPENSO", tasks: late }).status, "CRITICO");
    const formal = situation({ projectStatus: "SUSPENSO", tasks: late, statusHistory: [{ to: "SUSPENSO", createdAt: day("2026-10-20") }] });
    assert.deepEqual([formal.status, formal.formalDecision?.status], ["SUSPENSO", "SUSPENSO"]);
    // Situação alterada depois da suspensão: a decisão antiga não vale mais.
    const resumed = situation({
      projectStatus: "EM_EXECUCAO",
      statusHistory: [{ to: "SUSPENSO", createdAt: day("2026-10-01") }, { to: "EM_EXECUCAO", createdAt: day("2026-10-05") }],
    });
    assert.equal(resumed.status, "EM_EXECUCAO");
  });

  it("concluído exige encerramento formal e todas as fases concluídas; 100% sozinho não basta", () => {
    const done = { phases: [phase({ status: "CONCLUIDA" })], tasks: [task({ status: "CONCLUIDA", progressPercent: 100, actualEndAt: day("2026-10-10") })] };
    assert.equal(situation({ ...done, projectStatus: "EM_EXECUCAO" }).status, "EM_EXECUCAO");
    const closed = situation({ ...done, projectStatus: "CONCLUIDO", statusHistory: [{ to: "CONCLUIDO", createdAt: day("2026-10-20") }] });
    assert.equal(closed.status, "CONCLUIDO");
    const pending = situation({ projectStatus: "CONCLUIDO", statusHistory: [{ to: "CONCLUIDO", createdAt: day("2026-10-20") }] });
    assert.deepEqual([pending.status, pending.closureRequirementsMissing], ["EM_EXECUCAO", true]);
  });

  it("apto para encerramento: fases concluídas sem encerramento formal; não vale para suspenso, concluído ou 100% isolado", () => {
    const done = {
      phases: [phase({ status: "CONCLUIDA" })],
      tasks: [task({ status: "CONCLUIDA", progressPercent: 100, actualEndAt: day("2026-10-10") })],
      milestones: [milestone({ status: "APROVADO", plannedAt: day("2026-10-10") })],
    };
    const ready = situation(done);
    assert.deepEqual([ready.status, ready.readyForClosure], ["EM_EXECUCAO", true]);
    assert.equal(situation({ ...done, projectStatus: "SUSPENSO", statusHistory: [{ to: "SUSPENSO", createdAt: day("2026-10-20") }] }).readyForClosure, false);
    assert.equal(situation({ ...done, projectStatus: "CONCLUIDO", statusHistory: [{ to: "CONCLUIDO", createdAt: day("2026-10-20") }] }).readyForClosure, false);
    // Marco ainda não aceito: a fase não está concluída, mesmo com as tarefas a 100%.
    const awaiting = situation({ ...done, phases: [phase()], milestones: [milestone({ status: "ENTREGUE", plannedAt: day("2026-11-10") })] });
    assert.equal(awaiting.readyForClosure, false);
    assert.equal(situation({ phases: [], tasks: [] }).readyForClosure, false);
  });

  it("sem item iniciado o projeto não foi iniciado", () => {
    assert.equal(situation({ tasks: [task({ status: "NAO_INICIADA", progressPercent: 0, actualStartAt: null })] }).status, "NAO_INICIADO");
    assert.equal(situation({ phases: [], tasks: [] }).status, "NAO_INICIADO");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EapMilestoneRow } from "../dtos/eap-milestones.dto";
import type { EapPhaseRow } from "../dtos/eap-phases.dto";
import type { EapTaskRow } from "../dtos/eap-tasks.dto";
import { eapDelays } from "./eap-delay";

const day = (value: string) => new Date(`${value}T15:00:00.000Z`);
const now = day("2026-10-26");

function phase(overrides: Partial<EapPhaseRow> = {}): EapPhaseRow {
  return { id: "f1", status: "EM_ANDAMENTO", actualStartAt: null, actualEndAt: null, plannedEndAt: day("2026-11-30"), ...overrides } as EapPhaseRow;
}

function task(overrides: Partial<EapTaskRow> = {}): EapTaskRow {
  return { id: "t1", phaseId: "f1", status: "EM_ANDAMENTO", progressPercent: 30, plannedEndAt: day("2026-11-30"), actualStartAt: day("2026-10-01"), actualEndAt: null, hasImpediment: false, ...overrides } as EapTaskRow;
}

function milestone(overrides: Partial<EapMilestoneRow> = {}): EapMilestoneRow {
  return { id: "m1", phaseId: "f1", status: "PENDENTE", plannedAt: day("2026-11-30"), actualAt: null, ...overrides } as EapMilestoneRow;
}

function delays(input: { phases?: EapPhaseRow[]; tasks?: EapTaskRow[]; milestones?: EapMilestoneRow[]; deliveries?: { milestoneId: string; submittedAt: Date | null }[] }) {
  return eapDelays({ phases: input.phases ?? [phase()], tasks: input.tasks ?? [], milestones: input.milestones ?? [], deliveries: input.deliveries ?? [], now });
}

describe("regra única de atraso (eap-delay)", () => {
  it("1. tarefa aberta com o prazo vigente vencido é atraso", () => {
    const result = delays({ tasks: [task({ plannedEndAt: day("2026-10-20") })] });
    assert.deepEqual(result.items, [{ entityType: "TASK", entityId: "t1", days: 6, reason: "OPEN_OVERDUE" }]);
    assert.equal(result.isDelayed("TASK", "t1"), true);
    assert.equal(delays({ tasks: [task({ plannedEndAt: day("2026-10-26") })] }).items.length, 0); // vence hoje: ainda não é atraso
    assert.equal(delays({ tasks: [task({ plannedEndAt: day("2026-10-20"), status: "CONCLUIDA", progressPercent: 100, actualEndAt: day("2026-10-19") })] }).items.length, 0);
  });

  it("2. marco pendente com o prazo vencido é atraso", () => {
    const result = delays({ milestones: [milestone({ status: "PENDENTE", plannedAt: day("2026-10-21") })] });
    assert.deepEqual(result.items, [{ entityType: "MILESTONE", entityId: "m1", days: 5, reason: "OPEN_OVERDUE" }]);
  });

  it("3. marco rejeitado ou com ajustes solicitados e vencido é atraso", () => {
    for (const status of ["REJEITADO", "AJUSTES_SOLICITADOS"] as const) {
      const result = delays({ milestones: [milestone({ status, plannedAt: day("2026-10-21") })] });
      assert.equal(result.items.length, 1, status);
      assert.equal(result.items[0].reason, "OPEN_OVERDUE", status);
    }
  });

  it("4. marco entregue dentro do prazo, aguardando homologação, não é atraso (mesmo com o prazo já passado)", () => {
    const result = delays({
      milestones: [milestone({ status: "ENTREGUE", plannedAt: day("2026-10-22"), actualAt: day("2026-10-20") })],
      deliveries: [{ milestoneId: "m1", submittedAt: day("2026-10-22") }], // entregue no último dia do prazo
    });
    assert.equal(result.items.length, 0);
    assert.equal(result.isDelayed("MILESTONE", "m1"), false);
    assert.equal(result.delayDays, 0);
  });

  it("5. marco entregue depois do prazo é atraso, contado até a entrega", () => {
    const result = delays({
      milestones: [milestone({ status: "ENTREGUE", plannedAt: day("2026-10-20"), actualAt: day("2026-10-23") })],
      deliveries: [{ milestoneId: "m1", submittedAt: day("2026-10-23") }],
    });
    assert.deepEqual(result.items, [{ entityType: "MILESTONE", entityId: "m1", days: 3, reason: "DELIVERED_LATE" }]);
    // Marco aprovado não é atraso de execução, mesmo que tenha sido entregue tarde.
    assert.equal(delays({ milestones: [milestone({ status: "APROVADO", plannedAt: day("2026-10-20"), actualAt: day("2026-10-23") })] }).items.length, 0);
  });

  it("entrega sem data conhecida não entra no atraso e fica sinalizada", () => {
    const result = delays({ milestones: [milestone({ status: "ENTREGUE", plannedAt: day("2026-10-20"), actualAt: null })] });
    assert.equal(result.items.length, 0);
    assert.equal(result.undatedDeliveries, 1);
  });

  it("6. itens de fases suspensas não entram na contagem", () => {
    const result = delays({
      phases: [phase({ id: "f1", status: "SUSPENSA" }), phase({ id: "f2" })],
      tasks: [task({ id: "t1", phaseId: "f1", plannedEndAt: day("2026-10-01") }), task({ id: "t2", phaseId: "f2", plannedEndAt: day("2026-10-01") })],
      milestones: [milestone({ id: "m1", phaseId: "f1", plannedAt: day("2026-10-01") }), milestone({ id: "m2", phaseId: "f2", plannedAt: day("2026-10-01") })],
    });
    assert.deepEqual(result.items.map((item) => item.entityId), ["t2", "m2"]);
  });

  it("7. fases não são contabilizadas como itens de atraso: só tarefas e marcos", () => {
    // Fase com prazo vencido e sem itens em atraso: nada a contar.
    const lonely = delays({ phases: [phase({ plannedEndAt: day("2026-10-01") })], tasks: [task({ plannedEndAt: day("2026-12-01") })] });
    assert.equal(lonely.items.length, 0);
    // Fase vencida e tarefa vencida dentro dela: conta-se só a tarefa, sem duplicar pela fase.
    const both = delays({ phases: [phase({ plannedEndAt: day("2026-10-01") })], tasks: [task({ plannedEndAt: day("2026-10-01") })] });
    assert.deepEqual(both.items.map((item) => item.entityType), ["TASK"]);
  });
});

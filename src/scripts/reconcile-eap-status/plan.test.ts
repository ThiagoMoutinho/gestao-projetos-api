import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatReconciliationPreview, planReconciliation } from "./plan";

describe("reconciliação de situações legadas da EAP", () => {
  it("lista só divergências e calcula a fase com as tarefas já corrigidas", () => {
    const plan = planReconciliation({
      phases: [
        { id: "ph-1", projectId: "p-1", name: "teste", status: "NAO_INICIADA" },
        { id: "ph-2", projectId: "p-1", name: "Fechamento", status: "EM_ANDAMENTO" },
        { id: "ph-3", projectId: "p-1", name: "Parada", status: "SUSPENSA" },
      ],
      tasks: [
        { id: "t-1", phaseId: "ph-1", title: "teste2", status: "NAO_INICIADA", progressPercent: 90, hasImpediment: false },
        { id: "t-2", phaseId: "ph-1", title: "Programação", status: "EM_ANDAMENTO", progressPercent: 100, hasImpediment: false },
        { id: "t-3", phaseId: "ph-1", title: "Bloqueada", status: "IMPEDIDA", progressPercent: 40, hasImpediment: false },
        { id: "t-4", phaseId: "ph-1", title: "Cancelada", status: "CANCELADA", progressPercent: 30, hasImpediment: false },
        { id: "t-5", phaseId: "ph-2", title: "Ok", status: "CONCLUIDA", progressPercent: 100, hasImpediment: false },
        { id: "t-6", phaseId: "ph-3", title: "Suspensa", status: "NAO_INICIADA", progressPercent: 10, hasImpediment: false },
      ],
      milestones: [{ phaseId: "ph-2", status: "APROVADO" }],
    });

    assert.deepEqual(
      plan.tasks.map((change) => [change.title, change.from, change.to, change.markImpediment]),
      [
        ["teste2", "NAO_INICIADA", "EM_ANDAMENTO", false],
        ["Programação", "EM_ANDAMENTO", "CONCLUIDA", false],
        ["Bloqueada", "IMPEDIDA", "EM_ANDAMENTO", true],
        ["Suspensa", "NAO_INICIADA", "EM_ANDAMENTO", false],
      ],
    );
    assert.deepEqual(
      plan.phases.map((change) => [change.name, change.from, change.to]),
      [
        ["teste", "NAO_INICIADA", "EM_ANDAMENTO"],
        ["Fechamento", "EM_ANDAMENTO", "CONCLUIDA"],
      ],
    );
    assert.match(formatReconciliationPreview(plan), /Datas realizadas antigas não serão preenchidas/);
  });
});

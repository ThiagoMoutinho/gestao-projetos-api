import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createMilestoneBodySchema } from "../schemas/eap-milestones.schema";
import { createPhaseBodySchema } from "../schemas/eap-phases.schema";

describe("Criação de fase: responsável obrigatório", () => {
  it("aceita a fase com responsável e recusa sem ele", () => {
    assert.equal(createPhaseBodySchema.safeParse({ name: "Execução", responsibleId: "gestor-1" }).success, true);
    assert.equal(createPhaseBodySchema.safeParse({ name: "Execução" }).success, false);
    assert.equal(createPhaseBodySchema.safeParse({ name: "Execução", responsibleId: null }).success, false);
    assert.equal(createPhaseBodySchema.safeParse({ name: "Execução", responsibleId: "" }).success, false);
  });
});

const valid = {
  title: "Homologação final",
  description: "Aceite formal do sistema em produção.",
  type: "HOMOLOGACAO",
  plannedAt: "2026-06-20T15:00:00.000Z",
  reviewerId: "gestor-1",
  presenterId: "fornecedor-1",
};

describe("Criação de marco: campos obrigatórios", () => {
  it("aceita nome, descrição, data, gestor validador e apresentador", () => {
    assert.equal(createMilestoneBodySchema.safeParse(valid).success, true);
  });

  it("recusa a criação sem descrição, data, gestor validador ou apresentador", () => {
    for (const field of ["title", "description", "plannedAt", "reviewerId", "presenterId"] as const) {
      const body: Record<string, unknown> = { ...valid };
      delete body[field];
      assert.equal(createMilestoneBodySchema.safeParse(body).success, false, field);
    }
    assert.equal(createMilestoneBodySchema.safeParse({ ...valid, description: "   " }).success, false);
    assert.equal(createMilestoneBodySchema.safeParse({ ...valid, reviewerId: null }).success, false);
  });
});

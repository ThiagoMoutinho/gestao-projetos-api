import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import {
  createEapInMemoryStore,
  makeEapInMemoryRepos,
  makeEapInMemoryTransactionRunner,
  makeProject,
  makeUser,
} from "../test/in-memory";
import { makeCreatePhaseUseCase } from "./create-phase";
import { makeGetPhaseUseCase } from "./get-phase";
import { makeListPhasesUseCase } from "./list-phases";

function actor(role: AuthUser["role"], id = "actor-1"): AuthUser {
  return { id, name: "Actor", email: `${id}@igepps.test`, role };
}

describe("ListPhases e GetPhase", () => {
  it("impede usuário sem vínculo de consultar fases restritas", async () => {
    const store = createEapInMemoryStore({
      users: [
        makeUser({ id: "pmo-1", role: "PMO" }),
        makeUser({ id: "forn-1", role: "FORNECEDOR" }),
      ],
      projects: [makeProject({ id: "project-1", ownerId: "owner-1" })],
    });
    const repos = makeEapInMemoryRepos(store);
    const listPhases = makeListPhasesUseCase({ repos });
    const getPhase = makeGetPhaseUseCase({ repos });

    await assert.rejects(
      () => listPhases(actor("FORNECEDOR", "forn-1"), "project-1"),
      (error: unknown) =>
        error instanceof HttpError && error.code === "PROJECT_FORBIDDEN",
    );
    await assert.rejects(
      () => getPhase(actor("COLABORADOR", "colab-1"), "project-1", "phase-1"),
      (error: unknown) =>
        error instanceof HttpError && error.code === "PROJECT_FORBIDDEN",
    );
  });

  it("lista fases do projeto autorizado na ordem", async () => {
    const store = createEapInMemoryStore({
      users: [makeUser({ id: "pmo-1", role: "PMO" })],
      projects: [makeProject({ id: "project-1", ownerId: "owner-1" })],
    });
    const repos = makeEapInMemoryRepos(store);
    const runner = makeEapInMemoryTransactionRunner(repos);
    const createPhase = makeCreatePhaseUseCase({ repos, runInTransaction: runner });
    const listPhases = makeListPhasesUseCase({ repos });

    await createPhase(actor("PMO", "pmo-1"), "project-1", { name: "Fase A" });
    await createPhase(actor("PMO", "pmo-1"), "project-1", { name: "Fase B" });

    const result = await listPhases(actor("PMO", "pmo-1"), "project-1");
    assert.deepEqual(
      result.data.map((phase) => phase.name),
      ["Fase A", "Fase B"],
    );
    assert.deepEqual(
      result.data.map((phase) => phase.sortOrder),
      [0, 1],
    );
  });
});

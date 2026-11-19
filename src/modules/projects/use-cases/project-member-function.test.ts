import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import { createInMemoryStore, makeInMemoryRepos, makeInMemoryTransactionRunner, makeUser, noPlan } from "../test/in-memory";
import { makeAddProjectMemberUseCase } from "./add-project-member";
import { makeListProjectMembersUseCase } from "./list-project-members";
import { makeUpdateProjectMemberUseCase } from "./update-project-member";

const actor = (role: AuthUser["role"], id = "pmo-1"): AuthUser => ({ id, name: "Actor", email: `${id}@igepps.test`, role });

function setup() {
  const store = createInMemoryStore({
    users: [makeUser({ id: "pmo-1", role: "PMO" }), makeUser({ id: "pessoa-1", role: "COLABORADOR" })],
    projects: [
      {
        id: "project-1",
        name: "Projeto",
        description: null,
        glpiTicketId: null,
        pmoGlpiTicketId: null,
        ownerId: "pmo-1",
        status: "NAO_INICIADO",
        ...noPlan,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    members: [{ id: "m-owner", projectId: "project-1", userId: "pmo-1", role: "DONO_PROJETO", createdAt: new Date() }],
    memberFunctions: [
      { id: "fn-stake", name: "Stakeholder", isActive: true },
      { id: "fn-old", name: "Função antiga", isActive: false },
    ],
  });
  const repos = makeInMemoryRepos(store);
  const runInTransaction = makeInMemoryTransactionRunner(repos);
  return {
    store,
    add: makeAddProjectMemberUseCase({ repos, runInTransaction }),
    update: makeUpdateProjectMemberUseCase({ repos, runInTransaction }),
    list: makeListProjectMembersUseCase({ repos }),
  };
}

async function failure(promise: Promise<unknown>): Promise<HttpError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof HttpError);
    return error;
  }
  throw new Error("Era esperado um erro.");
}

describe("Participante com função do catálogo", () => {
  it("inclui com a função, mantém o acesso de Observador e audita o rótulo", async () => {
    const { add, store } = setup();
    const created = await add(actor("PMO"), "project-1", { userId: "pessoa-1", role: "OBSERVADOR", functionId: "fn-stake" });
    assert.equal(created.role, "OBSERVADOR");
    assert.deepEqual(created.function, { id: "fn-stake", name: "Stakeholder" });
    assert.equal(store.audit[0].payload.functionName, "Stakeholder");
    assert.match(store.audit[0].summary, /Stakeholder \(OBSERVADOR\)/);
  });

  it("a função só vale com o acesso de Observador (nunca dá permissão extra)", async () => {
    const { add } = setup();
    for (const role of ["GESTOR", "DESENVOLVEDOR", "PO", "FORNECEDOR", "RESPONSAVEL_TECNICO", "DONO_PROJETO"] as const) {
      const error = await failure(add(actor("PMO"), "project-1", { userId: "pessoa-1", role, functionId: "fn-stake" }));
      assert.equal(error.statusCode, 400, role);
      assert.equal(error.code, "MEMBER_FUNCTION_REQUIRES_OBSERVER", role);
    }
  });

  it("recusa função inexistente e função desativada em novas inclusões", async () => {
    const { add } = setup();
    assert.equal((await failure(add(actor("PMO"), "project-1", { userId: "pessoa-1", role: "OBSERVADOR", functionId: "nao-existe" }))).statusCode, 404);
    const inactive = await failure(add(actor("PMO"), "project-1", { userId: "pessoa-1", role: "OBSERVADOR", functionId: "fn-old" }));
    assert.equal(inactive.statusCode, 409);
    assert.equal(inactive.code, "MEMBER_FUNCTION_INACTIVE");
  });

  it("sem função, o Observador continua como antes (função nula)", async () => {
    const { add } = setup();
    const created = await add(actor("PMO"), "project-1", { userId: "pessoa-1", role: "OBSERVADOR" });
    assert.equal(created.function, null);
  });

  it("a listagem devolve a função de cada participante", async () => {
    const { add, list } = setup();
    await add(actor("PMO"), "project-1", { userId: "pessoa-1", role: "OBSERVADOR", functionId: "fn-stake" });
    const { data } = await list(actor("PMO"), "project-1");
    assert.deepEqual(
      data.map((entry) => [entry.userId, entry.role, entry.function?.name ?? null]).sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
      [
        ["pessoa-1", "OBSERVADOR", "Stakeholder"],
        ["pmo-1", "DONO_PROJETO", null],
      ],
    );
  });

  it("trocar para outro acesso limpa a função; sem informar a função, Observador mantém a atual", async () => {
    const { add, update } = setup();
    const created = await add(actor("PMO"), "project-1", { userId: "pessoa-1", role: "OBSERVADOR", functionId: "fn-stake" });

    const same = await update(actor("PMO"), "project-1", created.id, { role: "OBSERVADOR" });
    assert.deepEqual(same.function, { id: "fn-stake", name: "Stakeholder" });

    const toDev = await update(actor("PMO"), "project-1", created.id, { role: "DESENVOLVEDOR" });
    assert.equal(toDev.role, "DESENVOLVEDOR");
    assert.equal(toDev.function, null);
  });

  it("pode remover a função mantendo o Observador, e quem já tem uma função desativada a conserva", async () => {
    const { add, update, store } = setup();
    const created = await add(actor("PMO"), "project-1", { userId: "pessoa-1", role: "OBSERVADOR", functionId: "fn-stake" });
    store.memberFunctions![0].isActive = false; // desativada depois de atribuída
    const kept = await update(actor("PMO"), "project-1", created.id, { role: "OBSERVADOR", functionId: "fn-stake" });
    assert.equal(kept.function?.name, "Stakeholder");

    const cleared = await update(actor("PMO"), "project-1", created.id, { role: "OBSERVADOR", functionId: null });
    assert.equal(cleared.function, null);
  });

  it("só quem gerencia a equipe altera funções", async () => {
    const { add } = setup();
    const error = await failure(add(actor("COLABORADOR", "pessoa-1"), "project-1", { userId: "pessoa-1", role: "OBSERVADOR", functionId: "fn-stake" }));
    assert.ok([403, 404].includes(error.statusCode));
  });
});

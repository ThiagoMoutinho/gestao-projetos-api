import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../lib/http-error";
import { UniqueConstraintError } from "../../lib/postgres-errors";
import type { AuthUser } from "../../lib/session";
import type { MemberFunctionRow, MemberFunctionsRepository } from "./member-functions.repository";
import { createMemberFunctionBodySchema } from "./member-functions.schema";
import { cleanFunctionName, functionNameKey } from "./member-functions.text";
import { canManageMemberFunctions, makeMemberFunctionsUseCases } from "./member-functions.use-cases";

const user = (id: string, role: AuthUser["role"]) => ({ id, name: id, email: `${id}@x.test`, role }) as AuthUser;

function memoryRepo(): MemberFunctionsRepository & { rows: MemberFunctionRow[] } {
  const rows: MemberFunctionRow[] = [];
  return {
    rows,
    async list(includeInactive) {
      return rows.filter((row) => includeInactive || row.isActive).sort((a, b) => a.nameKey.localeCompare(b.nameKey));
    },
    async findById(id) {
      return rows.find((row) => row.id === id) ?? null;
    },
    async findByKey(nameKey) {
      return rows.find((row) => row.nameKey === nameKey) ?? null;
    },
    async create(data) {
      if (rows.some((row) => row.nameKey === data.nameKey)) {
        throw new UniqueConstraintError();
      }
      const row: MemberFunctionRow = { ...data, isActive: true, createdAt: new Date() };
      rows.push(row);
      return row;
    },
    async setActive(id, isActive) {
      const row = rows.find((entry) => entry.id === id);
      if (!row) return null;
      row.isActive = isActive;
      return row;
    },
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

describe("Nome da função", () => {
  it("limpa espaços e gera a mesma chave para variações do mesmo nome", () => {
    assert.equal(cleanFunctionName("  Parte   interessada "), "Parte interessada");
    assert.equal(functionNameKey("Stakeholder"), functionNameKey("  STAKEHOLDER "));
    assert.equal(functionNameKey("Fiscal de Contrato"), functionNameKey("fiscal  de   contrato"));
    assert.equal(functionNameKey("Gestão"), functionNameKey("gestao"));
    assert.notEqual(functionNameKey("Stakeholder"), functionNameKey("Patrocinador"));
  });

  it("valida o tamanho do nome no corpo da requisição", () => {
    assert.equal(createMemberFunctionBodySchema.safeParse({ name: "a" }).success, false);
    assert.equal(createMemberFunctionBodySchema.safeParse({ name: "x".repeat(61) }).success, false);
    assert.equal(createMemberFunctionBodySchema.safeParse({ name: "Stakeholder" }).success, true);
    assert.equal(createMemberFunctionBodySchema.safeParse({ name: "Stakeholder", extra: 1 }).success, false);
  });
});

describe("Catálogo de funções de participante", () => {
  it("só ADMIN e PMO criam e desativam; os demais perfis são barrados no servidor", async () => {
    for (const role of ["COORDENADOR", "GESTOR", "FORNECEDOR", "COLABORADOR"] as const) {
      const useCases = makeMemberFunctionsUseCases(memoryRepo());
      assert.equal((await failure(useCases.create(user("u", role), "Stakeholder"))).statusCode, 403, role);
      assert.equal(canManageMemberFunctions(role), false, role);
    }
    for (const role of ["ADMIN", "PMO"] as const) {
      const useCases = makeMemberFunctionsUseCases(memoryRepo());
      const created = await useCases.create(user("u", role), "  Stakeholder ");
      assert.equal(created.name, "Stakeholder");
      assert.equal(created.isActive, true);
    }
  });

  it("impede duplicata ignorando caixa, acento e espaços", async () => {
    const useCases = makeMemberFunctionsUseCases(memoryRepo());
    await useCases.create(user("a", "PMO"), "Gestão de Contrato");
    const duplicate = await failure(useCases.create(user("a", "PMO"), "gestao  de contrato"));
    assert.equal(duplicate.statusCode, 409);
    assert.equal(duplicate.code, "MEMBER_FUNCTION_DUPLICATE");
  });

  it("avisa quando o nome repetido pertence a uma função desativada", async () => {
    const useCases = makeMemberFunctionsUseCases(memoryRepo());
    const created = await useCases.create(user("a", "PMO"), "Stakeholder");
    await useCases.setActive(user("a", "PMO"), created.id, false);
    const duplicate = await failure(useCases.create(user("a", "PMO"), "STAKEHOLDER"));
    assert.equal(duplicate.statusCode, 409);
    assert.match(duplicate.message, /desativada/);
  });

  it("recusa nome sem letras ou números", async () => {
    const useCases = makeMemberFunctionsUseCases(memoryRepo());
    assert.equal((await failure(useCases.create(user("a", "ADMIN"), "!!"))).code, "MEMBER_FUNCTION_NAME_INVALID");
  });

  it("qualquer perfil lista as ativas; só ADMIN e PMO enxergam as desativadas", async () => {
    const repo = memoryRepo();
    const useCases = makeMemberFunctionsUseCases(repo);
    const a = await useCases.create(user("a", "PMO"), "Stakeholder");
    await useCases.create(user("a", "PMO"), "Patrocinador");
    await useCases.setActive(user("a", "PMO"), a.id, false);

    assert.deepEqual((await useCases.list(user("g", "GESTOR"), false)).data.map((entry) => entry.name), ["Patrocinador"]);
    assert.deepEqual((await useCases.list(user("g", "GESTOR"), true)).data.map((entry) => entry.name), ["Patrocinador"], "gestor não vê desativadas");
    assert.deepEqual((await useCases.list(user("a", "PMO"), true)).data.map((entry) => entry.name), ["Patrocinador", "Stakeholder"]);
  });

  it("ativar/desativar exige ADMIN ou PMO e função existente", async () => {
    const useCases = makeMemberFunctionsUseCases(memoryRepo());
    const created = await useCases.create(user("a", "ADMIN"), "Stakeholder");
    assert.equal((await failure(useCases.setActive(user("g", "GESTOR"), created.id, false))).statusCode, 403);
    assert.equal((await failure(useCases.setActive(user("a", "ADMIN"), "nao-existe", false))).statusCode, 404);
    assert.equal((await useCases.setActive(user("a", "ADMIN"), created.id, false)).isActive, false);
  });
});

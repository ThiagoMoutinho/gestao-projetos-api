import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../lib/http-error";
import { UniqueConstraintError } from "../../lib/postgres-errors";
import type { AuthUser } from "../../lib/session";
import type { MemberFunctionPatch, MemberFunctionRow, MemberFunctionsRepository } from "./member-functions.repository";
import { createMemberFunctionBodySchema, updateMemberFunctionBodySchema, type MemberFunctionUsage } from "./member-functions.schema";
import { cleanFunctionName, functionNameKey, isReservedFunctionName } from "./member-functions.text";
import { canManageMemberFunctions, makeMemberFunctionsUseCases } from "./member-functions.use-cases";

const user = (id: string, role: AuthUser["role"]) => ({ id, name: id, email: `${id}@x.test`, role }) as AuthUser;
const PMO = user("pmo-1", "PMO");

/** Repositório em memória. `members` e `history` simulam os vínculos atuais e os registros de histórico de cada função. */
function memoryRepo() {
  const rows: MemberFunctionRow[] = [];
  const members = new Map<string, number>();
  const history = new Map<string, number>();
  const repo: MemberFunctionsRepository = {
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
    async update(id, patch: MemberFunctionPatch) {
      const row = rows.find((entry) => entry.id === id);
      if (!row) return null;
      if (patch.nameKey !== undefined && rows.some((entry) => entry.id !== id && entry.nameKey === patch.nameKey)) {
        throw new UniqueConstraintError();
      }
      Object.assign(row, patch);
      return row;
    },
    async usage(ids) {
      const map = new Map<string, MemberFunctionUsage>();
      for (const id of ids) map.set(id, { members: members.get(id) ?? 0, history: history.get(id) ?? 0 });
      return map;
    },
    async deleteIfUnused(id) {
      if ((members.get(id) ?? 0) > 0 || (history.get(id) ?? 0) > 0) return false;
      const index = rows.findIndex((row) => row.id === id);
      if (index < 0) return false;
      rows.splice(index, 1);
      return true;
    },
  };
  return { repo, rows, members, history };
}

/** Cria uma linha direto no repositório (para simular registros antigos, como o "Desenvolvedor" criado antes da regra dos papéis fixos). */
function seed(rows: MemberFunctionRow[], name: string, isActive = true): MemberFunctionRow {
  const row: MemberFunctionRow = { id: crypto.randomUUID(), name, nameKey: functionNameKey(name), isActive, createdBy: "x", createdAt: new Date() };
  rows.push(row);
  return row;
}

async function failure(promise: Promise<unknown>): Promise<HttpError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof HttpError, String(error));
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

  it("valida o corpo da criação e da edição", () => {
    assert.equal(createMemberFunctionBodySchema.safeParse({ name: "a" }).success, false);
    assert.equal(createMemberFunctionBodySchema.safeParse({ name: "x".repeat(61) }).success, false);
    assert.equal(createMemberFunctionBodySchema.safeParse({ name: "Stakeholder", extra: 1 }).success, false);
    assert.equal(updateMemberFunctionBodySchema.safeParse({}).success, false, "vazio não vale");
    assert.equal(updateMemberFunctionBodySchema.safeParse({ name: "Novo nome" }).success, true);
    assert.equal(updateMemberFunctionBodySchema.safeParse({ isActive: false }).success, true);
    assert.equal(updateMemberFunctionBodySchema.safeParse({ name: "a" }).success, false);
    assert.equal(updateMemberFunctionBodySchema.safeParse({ isActive: true, extra: 1 }).success, false);
  });

  it("reconhece os papéis fixos ignorando caixa, acento e espaços", () => {
    for (const nome of ["Desenvolvedor", "  desenvolvedor ", "GESTOR", "Responsavel  tecnico", "po", "Observador", "Dono do Projeto", "Fornecedor"]) {
      assert.equal(isReservedFunctionName(nome), true, nome);
    }
    assert.equal(isReservedFunctionName("Stakeholder"), false);
    assert.equal(isReservedFunctionName("Desenvolvedor sênior"), false);
  });
});

describe("Catálogo: permissões", () => {
  it("só ADMIN e PMO criam, editam, desativam e excluem; os demais perfis são barrados no servidor", async () => {
    for (const role of ["COORDENADOR", "GESTOR", "FORNECEDOR", "COLABORADOR"] as const) {
      const { repo, rows } = memoryRepo();
      const f = seed(rows, "Stakeholder");
      const useCases = makeMemberFunctionsUseCases(repo);
      const ator = user("u", role);
      assert.equal(canManageMemberFunctions(role), false, role);
      assert.equal((await failure(useCases.create(ator, "Outra"))).statusCode, 403, `criar ${role}`);
      assert.equal((await failure(useCases.update(ator, f.id, { name: "Novo nome" }))).statusCode, 403, `editar ${role}`);
      assert.equal((await failure(useCases.update(ator, f.id, { isActive: false }))).statusCode, 403, `desativar ${role}`);
      assert.equal((await failure(useCases.remove(ator, f.id))).statusCode, 403, `excluir ${role}`);
      assert.equal(rows.length, 1, "nada foi alterado");
      assert.equal(rows[0].isActive, true);
      assert.equal(rows[0].name, "Stakeholder");
    }
    for (const role of ["ADMIN", "PMO"] as const) {
      const { repo } = memoryRepo();
      const useCases = makeMemberFunctionsUseCases(repo);
      const created = await useCases.create(user("u", role), "  Stakeholder ");
      assert.equal(created.name, "Stakeholder");
      assert.equal((await useCases.update(user("u", role), created.id, { name: "Patrocinador" })).name, "Patrocinador");
      await useCases.remove(user("u", role), created.id);
    }
  });

  it("qualquer perfil lista as ativas; só ADMIN e PMO enxergam desativadas e o uso", async () => {
    const { repo, members } = memoryRepo();
    const useCases = makeMemberFunctionsUseCases(repo);
    const a = await useCases.create(PMO, "Stakeholder");
    await useCases.create(PMO, "Patrocinador");
    members.set(a.id, 3);
    await useCases.update(PMO, a.id, { isActive: false });

    const gestor = await useCases.list(user("g", "GESTOR"), true);
    assert.deepEqual(gestor.data.map((entry) => entry.name), ["Patrocinador"], "gestor não vê desativadas");
    assert.ok(gestor.data.every((entry) => entry.usage === null), "gestor não vê o uso");

    const gerente = await useCases.list(PMO, true);
    assert.deepEqual(gerente.data.map((entry) => [entry.name, entry.isActive, entry.usage?.members]), [["Patrocinador", true, 0], ["Stakeholder", false, 3]]);
  });
});

describe("Catálogo: criar", () => {
  it("impede duplicata ignorando caixa, acento e espaços, avisando quando a existente está desativada", async () => {
    const { repo } = memoryRepo();
    const useCases = makeMemberFunctionsUseCases(repo);
    const gestao = await useCases.create(PMO, "Gestão de Contrato");
    const duplicate = await failure(useCases.create(PMO, "gestao  de contrato"));
    assert.equal(duplicate.statusCode, 409);
    assert.equal(duplicate.code, "MEMBER_FUNCTION_DUPLICATE");
    await useCases.update(PMO, gestao.id, { isActive: false });
    assert.match((await failure(useCases.create(PMO, "GESTAO DE CONTRATO"))).message, /desativada/);
  });

  it("recusa nome igual ao de um papel fixo e nome sem letras ou números", async () => {
    const { repo, rows } = memoryRepo();
    const useCases = makeMemberFunctionsUseCases(repo);
    for (const nome of ["Desenvolvedor", "  desenvolvedor ", "GESTOR", "Responsavel  tecnico", "po", "Observador", "Dono do Projeto", "Fornecedor"]) {
      const erro = await failure(useCases.create(PMO, nome));
      assert.equal(erro.statusCode, 409, nome);
      assert.equal(erro.code, "MEMBER_FUNCTION_RESERVED", nome);
    }
    assert.equal((await failure(useCases.create(PMO, "!!"))).code, "MEMBER_FUNCTION_NAME_INVALID");
    assert.equal(rows.length, 0, "nada foi gravado");
    assert.equal((await useCases.create(PMO, "Desenvolvedor sênior")).name, "Desenvolvedor sênior");
  });
});

describe("Catálogo: editar, desativar e reativar", () => {
  it("renomeia mantendo o mesmo id (os vínculos seguem a função) e atualiza a chave", async () => {
    const { repo } = memoryRepo();
    const useCases = makeMemberFunctionsUseCases(repo);
    const f = await useCases.create(PMO, "Stakeholder");
    const renamed = await useCases.update(PMO, f.id, { name: "  Parte   Interessada " });
    assert.equal(renamed.id, f.id);
    assert.equal(renamed.name, "Parte Interessada");
    // a chave nova vale contra duplicatas, e a antiga fica livre
    assert.equal((await failure(useCases.create(PMO, "parte interessada"))).code, "MEMBER_FUNCTION_DUPLICATE");
    assert.equal((await useCases.create(PMO, "Stakeholder")).name, "Stakeholder");
  });

  it("o novo nome não pode repetir outra função nem ser de papel fixo; o mesmo nome é aceito sem mudança", async () => {
    const { repo } = memoryRepo();
    const useCases = makeMemberFunctionsUseCases(repo);
    const a = await useCases.create(PMO, "Stakeholder");
    await useCases.create(PMO, "Patrocinador");
    assert.equal((await failure(useCases.update(PMO, a.id, { name: "patrocinador" }))).code, "MEMBER_FUNCTION_DUPLICATE");
    assert.equal((await failure(useCases.update(PMO, a.id, { name: "Desenvolvedor" }))).code, "MEMBER_FUNCTION_RESERVED");
    assert.equal((await failure(useCases.update(PMO, a.id, { name: "!!" }))).code, "MEMBER_FUNCTION_NAME_INVALID");
    // só mudar a caixa do próprio nome é permitido (mesma chave, é a mesma função)
    assert.equal((await useCases.update(PMO, a.id, { name: "STAKEHOLDER" })).name, "STAKEHOLDER");
    assert.equal((await useCases.update(PMO, a.id, { name: "STAKEHOLDER" })).name, "STAKEHOLDER", "repetir o mesmo nome não falha");
  });

  it("desativa e reativa; quem a tem mantém o vínculo (o uso não muda)", async () => {
    const { repo, members } = memoryRepo();
    const useCases = makeMemberFunctionsUseCases(repo);
    const f = await useCases.create(PMO, "Stakeholder");
    members.set(f.id, 2);
    const off = await useCases.update(PMO, f.id, { isActive: false });
    assert.equal(off.isActive, false);
    assert.equal(off.usage?.members, 2, "os vínculos continuam");
    assert.deepEqual((await useCases.list(user("g", "GESTOR"), false)).data, [], "some das opções para os demais");
    const on = await useCases.update(PMO, f.id, { isActive: true });
    assert.equal(on.isActive, true);
    assert.equal(on.usage?.members, 2);
  });

  it("função antiga com nome de papel fixo (ex.: criada antes da regra) não pode ser reativada, mas pode ser desativada ou renomeada", async () => {
    const { repo, rows } = memoryRepo();
    const useCases = makeMemberFunctionsUseCases(repo);
    const antiga = seed(rows, "Desenvolvedor", false);
    assert.equal((await failure(useCases.update(PMO, antiga.id, { isActive: true }))).code, "MEMBER_FUNCTION_RESERVED");
    assert.equal(rows[0].isActive, false, "continua desativada");
    // renomear e reativar de uma vez é válido: o nome novo não é reservado
    const ok = await useCases.update(PMO, antiga.id, { name: "Desenvolvedor externo", isActive: true });
    assert.equal(ok.isActive, true);
    assert.equal(ok.name, "Desenvolvedor externo");
    // desativar uma função com nome reservado é permitido
    const outra = seed(rows, "Gestor", true);
    assert.equal((await useCases.update(PMO, outra.id, { isActive: false })).isActive, false);
  });

  it("função inexistente responde 404", async () => {
    const useCases = makeMemberFunctionsUseCases(memoryRepo().repo);
    assert.equal((await failure(useCases.update(PMO, "nao-existe", { isActive: false }))).statusCode, 404);
  });
});

describe("Catálogo: excluir definitivamente", () => {
  it("exclui quando nunca foi atribuída e as demais funções não são afetadas", async () => {
    const { repo, rows } = memoryRepo();
    const useCases = makeMemberFunctionsUseCases(repo);
    const f = await useCases.create(PMO, "Teste de função");
    const outra = await useCases.create(PMO, "Stakeholder");
    await useCases.remove(PMO, f.id);
    assert.deepEqual(rows.map((row) => row.id), [outra.id]);
    assert.equal((await failure(useCases.remove(PMO, f.id))).statusCode, 404, "excluída de verdade");
    // o nome volta a ficar livre
    assert.equal((await useCases.create(PMO, "Teste de função")).name, "Teste de função");
  });

  it("não exclui quando algum participante a tem hoje: orienta a desativar e preserva o vínculo", async () => {
    const { repo, rows, members } = memoryRepo();
    const useCases = makeMemberFunctionsUseCases(repo);
    const f = await useCases.create(PMO, "Stakeholder");
    members.set(f.id, 3);
    const erro = await failure(useCases.remove(PMO, f.id));
    assert.equal(erro.statusCode, 409);
    assert.equal(erro.code, "MEMBER_FUNCTION_IN_USE");
    assert.match(erro.message, /3 participantes/);
    assert.match(erro.message, /apenas desativada/);
    assert.equal(rows.length, 1, "continua no catálogo");
    assert.equal(members.get(f.id), 3, "vínculos intactos");
  });

  it("não exclui quando só existe vínculo histórico (função já removida dos participantes)", async () => {
    const { repo, rows, history } = memoryRepo();
    const useCases = makeMemberFunctionsUseCases(repo);
    const f = await useCases.create(PMO, "Stakeholder");
    history.set(f.id, 2);
    const erro = await failure(useCases.remove(PMO, f.id));
    assert.equal(erro.code, "MEMBER_FUNCTION_IN_USE");
    assert.match(erro.message, /2 registros do histórico/);
    assert.equal(rows.length, 1);
    // desativar continua possível
    assert.equal((await useCases.update(PMO, f.id, { isActive: false })).isActive, false);
  });

  it("exclui também função desativada e sem uso (inclusive a antiga com nome de papel fixo)", async () => {
    const { repo, rows } = memoryRepo();
    const useCases = makeMemberFunctionsUseCases(repo);
    const antiga = seed(rows, "Desenvolvedor", true);
    await useCases.remove(PMO, antiga.id);
    assert.equal(rows.length, 0);
  });
});

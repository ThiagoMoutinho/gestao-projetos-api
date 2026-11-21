import { HttpError } from "../../lib/http-error";
import { isForeignKeyViolation, UniqueConstraintError } from "../../lib/postgres-errors";
import type { AuthUser } from "../../lib/session";
import type { MemberFunctionRow, MemberFunctionsRepository } from "./member-functions.repository";
import type { MemberFunctionDto, MemberFunctionUsage } from "./member-functions.schema";
import { cleanFunctionName, functionNameKey, isReservedFunctionName } from "./member-functions.text";

/** O catálogo é institucional: só ADMIN e PMO criam, editam, desativam, reativam e excluem funções; qualquer usuário autenticado lista as ativas. */
export function canManageMemberFunctions(role: AuthUser["role"]): boolean {
  return role === "ADMIN" || role === "PMO";
}

function toDto(row: MemberFunctionRow, usage: MemberFunctionUsage | null): MemberFunctionDto {
  return { id: row.id, name: row.name, isActive: row.isActive, usage };
}

function assertCanManage(actor: AuthUser) {
  if (!canManageMemberFunctions(actor.role)) {
    throw new HttpError(403, "Apenas ADMIN e PMO podem gerenciar as funções de participante.", "MEMBER_FUNCTION_FORBIDDEN");
  }
}

const reservedError = () => new HttpError(409, "Esse nome já existe como papel na lista de funções (ex.: Desenvolvedor).", "MEMBER_FUNCTION_RESERVED");

function inUseMessage(usage: MemberFunctionUsage) {
  const parts: string[] = [];
  if (usage.members > 0) parts.push(usage.members === 1 ? "1 participante a tem hoje" : `${usage.members} participantes a têm hoje`);
  if (usage.history > 0) parts.push(usage.history === 1 ? "consta em 1 registro do histórico" : `consta em ${usage.history} registros do histórico`);
  return `A função está em uso (${parts.join("; ")}). Não pode ser excluída, apenas desativada.`;
}

export function makeMemberFunctionsUseCases(repo: MemberFunctionsRepository) {
  async function usageOf(id: string): Promise<MemberFunctionUsage> {
    return (await repo.usage([id])).get(id) ?? { members: 0, history: 0 };
  }

  return {
    async list(actor: AuthUser, includeInactive: boolean): Promise<{ data: MemberFunctionDto[] }> {
      const manager = canManageMemberFunctions(actor.role);
      const rows = await repo.list(includeInactive && manager);
      const usage = manager ? await repo.usage(rows.map((row) => row.id)) : null;
      return { data: rows.map((row) => toDto(row, usage ? (usage.get(row.id) ?? { members: 0, history: 0 }) : null)) };
    },

    async create(actor: AuthUser, name: string): Promise<MemberFunctionDto> {
      assertCanManage(actor);
      const clean = cleanFunctionName(name);
      const nameKey = functionNameKey(clean);
      if (nameKey.length < 2) {
        throw new HttpError(400, "Informe um nome com letras ou números.", "MEMBER_FUNCTION_NAME_INVALID");
      }
      if (isReservedFunctionName(clean)) {
        throw reservedError();
      }
      try {
        return toDto(await repo.create({ id: crypto.randomUUID(), name: clean, nameKey, createdBy: actor.id }), { members: 0, history: 0 });
      } catch (error) {
        if (error instanceof UniqueConstraintError) {
          const existing = await repo.findByKey(nameKey);
          throw new HttpError(
            409,
            existing && !existing.isActive ? "Já existe uma função com esse nome, mas ela está desativada." : "Já existe uma função com esse nome.",
            "MEMBER_FUNCTION_DUPLICATE",
          );
        }
        throw error;
      }
    },

    /**
     * Edita o nome e/ou ativa e desativa. Regras no servidor: o nome novo não pode ser de papel fixo nem repetir outra função,
     * e uma função cujo nome é de papel fixo (herança de antes da regra) não pode ser reativada. Desativar não apaga: quem já
     * tem a função mantém o rótulo; ela só deixa de ser oferecida em novas inclusões. Renomear vale para todos que a têm; o histórico
     * (auditoria) guarda o nome da época.
     */
    async update(actor: AuthUser, id: string, patch: { name?: string; isActive?: boolean }): Promise<MemberFunctionDto> {
      assertCanManage(actor);
      const current = await repo.findById(id);
      if (!current) {
        throw new HttpError(404, "Função não encontrada.", "MEMBER_FUNCTION_NOT_FOUND");
      }
      const next: { name?: string; nameKey?: string; isActive?: boolean } = {};
      if (patch.name !== undefined) {
        const clean = cleanFunctionName(patch.name);
        const nameKey = functionNameKey(clean);
        if (nameKey.length < 2) {
          throw new HttpError(400, "Informe um nome com letras ou números.", "MEMBER_FUNCTION_NAME_INVALID");
        }
        if (isReservedFunctionName(clean)) {
          throw reservedError();
        }
        if (clean !== current.name) {
          next.name = clean;
          next.nameKey = nameKey;
        }
      }
      if (patch.isActive !== undefined && patch.isActive !== current.isActive) {
        if (patch.isActive && isReservedFunctionName(next.name ?? current.name)) {
          throw new HttpError(409, "Esta função tem o nome de um papel fixo e não pode ser reativada. Exclua-a ou renomeie-a.", "MEMBER_FUNCTION_RESERVED");
        }
        next.isActive = patch.isActive;
      }
      if (Object.keys(next).length === 0) {
        return toDto(current, await usageOf(id));
      }
      try {
        const row = await repo.update(id, next);
        if (!row) {
          throw new HttpError(404, "Função não encontrada.", "MEMBER_FUNCTION_NOT_FOUND");
        }
        return toDto(row, await usageOf(id));
      } catch (error) {
        if (error instanceof UniqueConstraintError) {
          throw new HttpError(409, "Já existe outra função com esse nome.", "MEMBER_FUNCTION_DUPLICATE");
        }
        throw error;
      }
    },

    /**
     * Exclusão definitiva: só se a função nunca foi atribuída (nenhum participante a tem e nenhum registro do histórico a cita).
     * A checagem e a exclusão acontecem na mesma instrução no banco; havendo uso, só resta desativar.
     */
    async remove(actor: AuthUser, id: string): Promise<void> {
      assertCanManage(actor);
      const current = await repo.findById(id);
      if (!current) {
        throw new HttpError(404, "Função não encontrada.", "MEMBER_FUNCTION_NOT_FOUND");
      }
      let deleted: boolean;
      try {
        deleted = await repo.deleteIfUnused(id);
      } catch (error) {
        if (isForeignKeyViolation(error)) {
          deleted = false;
        } else {
          throw error;
        }
      }
      if (!deleted) {
        const usage = await usageOf(id);
        // Pode ter sido excluída por outra requisição entre a leitura e a exclusão.
        if (!(await repo.findById(id))) {
          throw new HttpError(404, "Função não encontrada.", "MEMBER_FUNCTION_NOT_FOUND");
        }
        throw new HttpError(409, inUseMessage(usage), "MEMBER_FUNCTION_IN_USE");
      }
    },
  };
}

export type MemberFunctionsUseCases = ReturnType<typeof makeMemberFunctionsUseCases>;

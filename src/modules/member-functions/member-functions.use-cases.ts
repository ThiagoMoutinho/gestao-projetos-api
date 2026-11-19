import { HttpError } from "../../lib/http-error";
import { UniqueConstraintError } from "../../lib/postgres-errors";
import type { AuthUser } from "../../lib/session";
import type { MemberFunctionRow, MemberFunctionsRepository } from "./member-functions.repository";
import type { MemberFunctionDto } from "./member-functions.schema";
import { cleanFunctionName, functionNameKey } from "./member-functions.text";

/** O catálogo é institucional: só ADMIN e PMO criam e desativam funções; qualquer usuário autenticado pode listá-las. */
export function canManageMemberFunctions(role: AuthUser["role"]): boolean {
  return role === "ADMIN" || role === "PMO";
}

function toDto(row: MemberFunctionRow): MemberFunctionDto {
  return { id: row.id, name: row.name, isActive: row.isActive };
}

function assertCanManage(actor: AuthUser) {
  if (!canManageMemberFunctions(actor.role)) {
    throw new HttpError(403, "Apenas ADMIN e PMO podem gerenciar as funções de participante.", "MEMBER_FUNCTION_FORBIDDEN");
  }
}

export function makeMemberFunctionsUseCases(repo: MemberFunctionsRepository) {
  return {
    async list(actor: AuthUser, includeInactive: boolean): Promise<{ data: MemberFunctionDto[] }> {
      const rows = await repo.list(includeInactive && canManageMemberFunctions(actor.role));
      return { data: rows.map(toDto) };
    },

    async create(actor: AuthUser, name: string): Promise<MemberFunctionDto> {
      assertCanManage(actor);
      const clean = cleanFunctionName(name);
      const nameKey = functionNameKey(clean);
      if (nameKey.length < 2) {
        throw new HttpError(400, "Informe um nome com letras ou números.", "MEMBER_FUNCTION_NAME_INVALID");
      }
      try {
        return toDto(await repo.create({ id: crypto.randomUUID(), name: clean, nameKey, createdBy: actor.id }));
      } catch (error) {
        if (error instanceof UniqueConstraintError) {
          const existing = await repo.findByKey(nameKey);
          throw new HttpError(
            409,
            existing && !existing.isActive
              ? "Já existe uma função com esse nome, mas ela está desativada."
              : "Já existe uma função com esse nome.",
            "MEMBER_FUNCTION_DUPLICATE",
          );
        }
        throw error;
      }
    },

    /** Desativar não apaga: quem já tem a função continua com o rótulo; ela só deixa de ser oferecida em novas inclusões. */
    async setActive(actor: AuthUser, id: string, isActive: boolean): Promise<MemberFunctionDto> {
      assertCanManage(actor);
      const row = await repo.setActive(id, isActive);
      if (!row) {
        throw new HttpError(404, "Função não encontrada.", "MEMBER_FUNCTION_NOT_FOUND");
      }
      return toDto(row);
    },
  };
}

export type MemberFunctionsUseCases = ReturnType<typeof makeMemberFunctionsUseCases>;

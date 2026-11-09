import { z } from "zod";

import { HttpError } from "../../lib/http-error";
import type { AuthUser } from "../../lib/session";
import type { AdminUserRow, UserAdminRepository } from "./user-admin.repository";

export const userParamsSchema = z.object({ id: z.string().min(1) });

export const userActivationBodySchema = z
  .object({ reason: z.string().trim().min(5, "Informe a justificativa.").max(1000) })
  .strict();

export const adminUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
  isActive: z.boolean(),
  deactivatedAt: z.string().nullable(),
});

export const adminUserListSchema = z.object({ data: z.array(adminUserSchema) });

/** Só o ADMIN consulta, ativa e desativa usuários. */
export function canManageUsers(actor: AuthUser) {
  return actor.role === "ADMIN";
}

const forbidden = () => new HttpError(403, "Somente o ADMIN gerencia usuários.", "USER_ADMIN_FORBIDDEN");
const notFound = () => new HttpError(404, "Usuário não encontrado.", "USER_NOT_FOUND");

function toDto(row: AdminUserRow) {
  return { ...row, deactivatedAt: row.deactivatedAt ? row.deactivatedAt.toISOString() : null };
}

export function makeUserAdminUseCases(repository: UserAdminRepository) {
  return {
    async list(actor: AuthUser) {
      if (!canManageUsers(actor)) throw forbidden();
      return { data: (await repository.listUsers()).map(toDto) };
    },

    /**
     * Desativa o usuário: encerra as sessões, impede novos logins e novas notificações. O histórico e os vínculos ficam
     * como estão. Não desativa a si mesmo nem o último ADMIN ativo.
     */
    async deactivate(actor: AuthUser, userId: string, reason: string, now = new Date()) {
      if (!canManageUsers(actor)) throw forbidden();
      if (actor.id === userId) {
        throw new HttpError(409, "Você não pode desativar o próprio usuário.", "USER_SELF_DEACTIVATION");
      }
      return repository.transaction(async (store) => {
        const target = await store.getUser(userId);
        if (!target) throw notFound();
        if (!target.isActive) throw new HttpError(409, "O usuário já está inativo.", "USER_ALREADY_INACTIVE");
        if (target.role === "ADMIN" && (await store.countOtherActiveAdmins(userId)) === 0) {
          throw new HttpError(409, "Não é possível desativar o último ADMIN ativo.", "USER_LAST_ACTIVE_ADMIN");
        }
        await store.setActive(userId, { isActive: false, deactivatedAt: now, deactivatedBy: actor.id });
        const sessionsRevoked = await store.revokeSessions(userId);
        await store.appendChange({ id: crypto.randomUUID(), userId, action: "DEACTIVATE", actorId: actor.id, reason, sessionsRevoked });
        return toDto({ ...target, isActive: false, deactivatedAt: now });
      });
    },

    async activate(actor: AuthUser, userId: string, reason: string) {
      if (!canManageUsers(actor)) throw forbidden();
      return repository.transaction(async (store) => {
        const target = await store.getUser(userId);
        if (!target) throw notFound();
        if (target.isActive) throw new HttpError(409, "O usuário já está ativo.", "USER_ALREADY_ACTIVE");
        await store.setActive(userId, { isActive: true, deactivatedAt: null, deactivatedBy: null });
        await store.appendChange({ id: crypto.randomUUID(), userId, action: "ACTIVATE", actorId: actor.id, reason, sessionsRevoked: 0 });
        return toDto({ ...target, isActive: true, deactivatedAt: null });
      });
    },
  };
}

export type UserAdminUseCases = ReturnType<typeof makeUserAdminUseCases>;

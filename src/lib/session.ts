import { fromNodeHeaders } from "better-auth/node";
import type { FastifyReply, FastifyRequest } from "fastify";

import { userRoleEnum } from "../db/schema";
import { auth } from "./auth";
import { HttpError } from "./http-error";

export type UserRole = (typeof userRoleEnum.enumValues)[number];

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
};

declare module "fastify" {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
}

function parseUserRole(role: unknown): UserRole {
  if (
    typeof role === "string" &&
    (userRoleEnum.enumValues as readonly string[]).includes(role)
  ) {
    return role as UserRole;
  }

  return "COLABORADOR";
}

/** Sessão de usuário desativado deixa de valer na hora (a leitura da sessão é feita no banco a cada requisição). */
export function assertSessionUserActive(sessionUser: { isActive?: boolean | null }) {
  if (sessionUser.isActive === false) {
    throw new HttpError(401, "Usuário inativo. Procure o administrador.", "USER_INACTIVE");
  }
}

export async function requireAuth(
  request: FastifyRequest,
  _reply: FastifyReply,
) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(request.headers),
  });

  if (!session) {
    throw new HttpError(
      401,
      "Você precisa estar autenticado.",
      "UNAUTHENTICATED",
    );
  }

  assertSessionUserActive(session.user);

  request.authUser = {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    role: parseUserRole(session.user.role),
  };
}

export function getAuthUser(request: FastifyRequest): AuthUser {
  if (!request.authUser) {
    throw new HttpError(
      401,
      "Você precisa estar autenticado.",
      "UNAUTHENTICATED",
    );
  }

  return request.authUser;
}

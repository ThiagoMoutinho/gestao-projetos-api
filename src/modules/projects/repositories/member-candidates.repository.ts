import { asc, eq } from "drizzle-orm";

import { user } from "../../../db/schema";
import type { DbClient } from "../../../db/types";
import type { MemberCandidatesRepository } from "../use-cases/list-member-candidates";

/** Usuários ativos (sem dados sensíveis) para compor a equipe de um projeto. */
export class DrizzleMemberCandidatesRepository implements MemberCandidatesRepository {
  constructor(private readonly client: DbClient) {}

  async listActive() {
    return this.client
      .select({ id: user.id, name: user.name, email: user.email, role: user.role })
      .from(user)
      .where(eq(user.isActive, true))
      .orderBy(asc(user.name));
  }
}

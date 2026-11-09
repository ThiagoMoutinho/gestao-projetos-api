import { and, asc, eq } from "drizzle-orm";

import { session, user, userActivationChanges } from "../../db/schema";
import type { Database, DbClient } from "../../db/types";

export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  deactivatedAt: Date | null;
};

export type NewActivationChange = {
  id: string;
  userId: string;
  action: "ACTIVATE" | "DEACTIVATE";
  actorId: string;
  reason: string;
  sessionsRevoked: number;
};

export interface UserAdminStore {
  listUsers(): Promise<AdminUserRow[]>;
  getUser(id: string): Promise<AdminUserRow | null>;
  /** Trava os ADMIN ativos e devolve quantos existem além de `excludeId` (evita desativar os dois últimos ao mesmo tempo). */
  countOtherActiveAdmins(excludeId: string): Promise<number>;
  setActive(id: string, data: { isActive: boolean; deactivatedAt: Date | null; deactivatedBy: string | null }): Promise<void>;
  revokeSessions(userId: string): Promise<number>;
  appendChange(change: NewActivationChange): Promise<void>;
}

export interface UserAdminRepository extends UserAdminStore {
  transaction<T>(fn: (store: UserAdminStore) => Promise<T>): Promise<T>;
}

const columns = {
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  isActive: user.isActive,
  deactivatedAt: user.deactivatedAt,
};

class DrizzleUserAdminStore implements UserAdminStore {
  constructor(protected readonly client: DbClient) {}

  listUsers() {
    return this.client.select(columns).from(user).orderBy(asc(user.name));
  }

  async getUser(id: string) {
    const [row] = await this.client.select(columns).from(user).where(eq(user.id, id));
    return row ?? null;
  }

  async countOtherActiveAdmins(excludeId: string) {
    const rows = await this.client
      .select({ id: user.id })
      .from(user)
      .where(and(eq(user.role, "ADMIN"), eq(user.isActive, true)))
      .for("update");
    return rows.filter((row) => row.id !== excludeId).length;
  }

  async setActive(id: string, data: { isActive: boolean; deactivatedAt: Date | null; deactivatedBy: string | null }) {
    await this.client.update(user).set(data).where(eq(user.id, id));
  }

  async revokeSessions(userId: string) {
    const removed = await this.client.delete(session).where(eq(session.userId, userId)).returning({ id: session.id });
    return removed.length;
  }

  async appendChange(change: NewActivationChange) {
    await this.client.insert(userActivationChanges).values(change);
  }
}

export class DrizzleUserAdminRepository extends DrizzleUserAdminStore implements UserAdminRepository {
  constructor(private readonly database: Database) {
    super(database);
  }

  transaction<T>(fn: (store: UserAdminStore) => Promise<T>) {
    return this.database.transaction((tx) => fn(new DrizzleUserAdminStore(tx)));
  }
}

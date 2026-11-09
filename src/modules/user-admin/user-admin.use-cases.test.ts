import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../lib/http-error";
import type { AuthUser } from "../../lib/session";
import type { AdminUserRow, NewActivationChange, UserAdminRepository, UserAdminStore } from "./user-admin.repository";
import { makeUserAdminUseCases } from "./user-admin.use-cases";

class InMemoryUserAdminRepository implements UserAdminRepository {
  users: AdminUserRow[] = [];
  sessions: Array<{ id: string; userId: string }> = [];
  changes: NewActivationChange[] = [];

  async listUsers() {
    return [...this.users];
  }
  async getUser(id: string) {
    return this.users.find((row) => row.id === id) ?? null;
  }
  async countOtherActiveAdmins(excludeId: string) {
    return this.users.filter((row) => row.role === "ADMIN" && row.isActive && row.id !== excludeId).length;
  }
  async setActive(id: string, data: { isActive: boolean; deactivatedAt: Date | null }) {
    const index = this.users.findIndex((row) => row.id === id);
    this.users[index] = { ...this.users[index], isActive: data.isActive, deactivatedAt: data.deactivatedAt };
  }
  async revokeSessions(userId: string) {
    const before = this.sessions.length;
    this.sessions = this.sessions.filter((row) => row.userId !== userId);
    return before - this.sessions.length;
  }
  async appendChange(change: NewActivationChange) {
    this.changes.push(change);
  }
  async transaction<T>(fn: (store: UserAdminStore) => Promise<T>) {
    const snapshot = { users: this.users.map((row) => ({ ...row })), sessions: [...this.sessions], changes: [...this.changes] };
    try {
      return await fn(this);
    } catch (error) {
      this.users = snapshot.users;
      this.sessions = snapshot.sessions;
      this.changes = snapshot.changes;
      throw error;
    }
  }
}

const actor = (role: AuthUser["role"], id: string): AuthUser => ({ id, name: id, email: `${id}@x.test`, role });
const user = (id: string, role: string, isActive = true): AdminUserRow => ({ id, name: id, email: `${id}@x.test`, role, isActive, deactivatedAt: isActive ? null : new Date() });
const rejects = (status: number, code: string) => (error: unknown) => error instanceof HttpError && error.statusCode === status && error.code === code;

function setup() {
  const repository = new InMemoryUserAdminRepository();
  repository.users = [user("admin-1", "ADMIN"), user("admin-2", "ADMIN"), user("pmo-1", "PMO"), user("forn-1", "FORNECEDOR")];
  repository.sessions = [
    { id: "s1", userId: "forn-1" },
    { id: "s2", userId: "forn-1" },
    { id: "s3", userId: "pmo-1" },
  ];
  return { repository, useCases: makeUserAdminUseCases(repository) };
}

describe("administração de usuários", () => {
  it("somente o ADMIN lista, desativa e reativa", async () => {
    const { useCases } = setup();
    for (const who of [actor("PMO", "pmo-1"), actor("COORDENADOR", "c"), actor("GESTOR", "g"), actor("FORNECEDOR", "forn-1")]) {
      await assert.rejects(() => useCases.list(who), rejects(403, "USER_ADMIN_FORBIDDEN"));
      await assert.rejects(() => useCases.deactivate(who, "pmo-1", "Teste de permissão."), rejects(403, "USER_ADMIN_FORBIDDEN"));
      await assert.rejects(() => useCases.activate(who, "pmo-1", "Teste de permissão."), rejects(403, "USER_ADMIN_FORBIDDEN"));
    }
  });

  it("desativa: encerra só as sessões do usuário, registra auditoria e preserva os demais usuários ativos", async () => {
    const { repository, useCases } = setup();
    const result = await useCases.deactivate(actor("ADMIN", "admin-1"), "forn-1", "Contrato encerrado.", new Date("2026-11-03T12:00:00Z"));
    assert.equal(result.isActive, false);
    assert.equal(result.deactivatedAt, "2026-11-03T12:00:00.000Z");
    assert.deepEqual(repository.sessions.map((row) => row.userId), ["pmo-1"]); // sessões de outros usuários intactas
    assert.deepEqual(repository.changes.map((change) => [change.action, change.userId, change.actorId, change.reason, change.sessionsRevoked]), [
      ["DEACTIVATE", "forn-1", "admin-1", "Contrato encerrado.", 2],
    ]);
    assert.equal(repository.users.filter((row) => row.isActive).length, 3);
    await assert.rejects(() => useCases.deactivate(actor("ADMIN", "admin-1"), "forn-1", "De novo."), rejects(409, "USER_ALREADY_INACTIVE"));
    await assert.rejects(() => useCases.deactivate(actor("ADMIN", "admin-1"), "nao-existe", "Inexistente."), rejects(404, "USER_NOT_FOUND"));
  });

  it("não desativa a si mesmo nem o último ADMIN ativo", async () => {
    const { repository, useCases } = setup();
    await assert.rejects(() => useCases.deactivate(actor("ADMIN", "admin-1"), "admin-1", "Autodesativação."), rejects(409, "USER_SELF_DEACTIVATION"));
    await useCases.deactivate(actor("ADMIN", "admin-1"), "admin-2", "Desligamento do segundo ADMIN.");
    // admin-1 é o único ADMIN ativo: outro ADMIN (inativo) não pode desativá-lo, e ninguém mais o desativa.
    repository.users = repository.users.map((row) => (row.id === "admin-2" ? { ...row, isActive: true, deactivatedAt: null } : row));
    await useCases.deactivate(actor("ADMIN", "admin-2"), "admin-1", "Passagem de função.");
    await assert.rejects(() => useCases.deactivate(actor("ADMIN", "admin-1"), "admin-2", "Último ADMIN."), rejects(409, "USER_LAST_ACTIVE_ADMIN"));
    assert.equal(repository.users.find((row) => row.id === "admin-2")!.isActive, true);
  });

  it("reativa com justificativa, sem restaurar sessões, e mantém o histórico", async () => {
    const { repository, useCases } = setup();
    await useCases.deactivate(actor("ADMIN", "admin-1"), "forn-1", "Contrato encerrado.");
    const result = await useCases.activate(actor("ADMIN", "admin-1"), "forn-1", "Contrato renovado.");
    assert.equal(result.isActive, true);
    assert.equal(result.deactivatedAt, null);
    assert.equal(repository.sessions.some((row) => row.userId === "forn-1"), false);
    assert.deepEqual(repository.changes.map((change) => change.action), ["DEACTIVATE", "ACTIVATE"]);
    await assert.rejects(() => useCases.activate(actor("ADMIN", "admin-1"), "forn-1", "De novo."), rejects(409, "USER_ALREADY_ACTIVE"));
  });
});

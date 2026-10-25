import { UniqueConstraintError } from "../../../lib/postgres-errors";
import type {
  ProjectMemberRow,
  ProjectRow,
  UserRow,
} from "../dtos/projects.dto";
import type {
  NewProjectMemberRecord,
  NewProjectRecord,
  ProjectMembersRepository,
  ProjectRepos,
  ProjectsRepository,
  ProjectUpdateRecord,
  TransactionRunner,
  UsersRepository,
} from "../repositories/contracts";
import type { ProjectMemberRole } from "../schemas/projects.schema";

export type InMemoryStore = {
  users: UserRow[];
  projects: ProjectRow[];
  members: ProjectMemberRow[];
};

/** Projeto sem planejamento definido (datas vigentes e linha de base vazias). */
export const noPlan = {
  baselineStartAt: null,
  baselineEndAt: null,
  plannedStartAt: null,
  plannedEndAt: null,
} satisfies Partial<ProjectRow>;

export function createInMemoryStore(seed?: Partial<InMemoryStore>): InMemoryStore {
  return {
    users: seed?.users ?? [],
    projects: seed?.projects ?? [],
    members: seed?.members ?? [],
  };
}

class InMemoryUsersRepository implements UsersRepository {
  constructor(private readonly store: InMemoryStore) {}

  async findById(id: string) {
    return this.store.users.find((row) => row.id === id) ?? null;
  }
}

class InMemoryProjectsRepository implements ProjectsRepository {
  constructor(private readonly store: InMemoryStore) {}

  async findById(id: string) {
    return this.store.projects.find((row) => row.id === id) ?? null;
  }

  async create(data: NewProjectRecord) {
    const now = new Date();
    const row: ProjectRow = {
      ...data,
      ...noPlan,
      createdAt: now,
      updatedAt: now,
    };
    this.store.projects.push(row);
    return row;
  }

  async update(id: string, data: ProjectUpdateRecord) {
    const index = this.store.projects.findIndex((row) => row.id === id);
    if (index < 0) {
      return null;
    }

    const current = this.store.projects[index];
    const updated: ProjectRow = {
      ...current,
      ...data,
      updatedAt: data.updatedAt ?? new Date(),
    };
    this.store.projects[index] = updated;
    return updated;
  }

  async listAll() {
    return [...this.store.projects].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  async listByOwnerOrIds(ownerId: string, projectIds: string[]) {
    return this.store.projects
      .filter((row) => row.ownerId === ownerId || projectIds.includes(row.id))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}

class InMemoryProjectMembersRepository implements ProjectMembersRepository {
  constructor(private readonly store: InMemoryStore) {}

  async findRoles(projectId: string, userId: string) {
    return this.store.members
      .filter((row) => row.projectId === projectId && row.userId === userId)
      .map((row) => row.role);
  }

  async listByUser(userId: string) {
    return this.store.members
      .filter((row) => row.userId === userId)
      .map((row) => ({ projectId: row.projectId, role: row.role }));
  }

  async listByProject(projectId: string) {
    return this.store.members
      .filter((row) => row.projectId === projectId)
      .map((member) => {
        const user = this.store.users.find((row) => row.id === member.userId);
        if (!user) {
          throw new Error(`User ${member.userId} not found`);
        }

        return { member, user };
      })
      .sort((a, b) => b.member.createdAt.getTime() - a.member.createdAt.getTime());
  }

  async findByProjectUserRole(
    projectId: string,
    userId: string,
    role: ProjectMemberRole,
  ) {
    return (
      this.store.members.find(
        (row) =>
          row.projectId === projectId && row.userId === userId && row.role === role,
      ) ?? null
    );
  }

  async findByIdAndProject(memberId: string, projectId: string) {
    return (
      this.store.members.find(
        (row) => row.id === memberId && row.projectId === projectId,
      ) ?? null
    );
  }

  async create(data: NewProjectMemberRecord) {
    const duplicate = await this.findByProjectUserRole(
      data.projectId,
      data.userId,
      data.role,
    );
    if (duplicate) {
      throw new UniqueConstraintError();
    }

    const row: ProjectMemberRow = {
      ...data,
      createdAt: new Date(),
    };
    this.store.members.push(row);
    return row;
  }

  async updateRole(memberId: string, role: ProjectMemberRole) {
    const index = this.store.members.findIndex((row) => row.id === memberId);
    const current = this.store.members[index];
    const duplicate = await this.findByProjectUserRole(
      current.projectId,
      current.userId,
      role,
    );

    if (duplicate && duplicate.id !== memberId) {
      throw new UniqueConstraintError();
    }

    const updated = { ...current, role };
    this.store.members[index] = updated;
    return updated;
  }

  async deleteById(memberId: string) {
    this.store.members = this.store.members.filter((row) => row.id !== memberId);
  }

  async deleteOwnerRole(projectId: string, userId: string) {
    this.store.members = this.store.members.filter(
      (row) =>
        !(
          row.projectId === projectId &&
          row.userId === userId &&
          row.role === "DONO_PROJETO"
        ),
    );
  }

  async ensureOwnerMembership(projectId: string, ownerId: string) {
    const existing = await this.findByProjectUserRole(
      projectId,
      ownerId,
      "DONO_PROJETO",
    );
    if (existing) {
      return existing;
    }

    return this.create({
      id: crypto.randomUUID(),
      projectId,
      userId: ownerId,
      role: "DONO_PROJETO",
    });
  }
}

export function makeInMemoryRepos(store: InMemoryStore): ProjectRepos {
  return {
    projects: new InMemoryProjectsRepository(store),
    members: new InMemoryProjectMembersRepository(store),
    users: new InMemoryUsersRepository(store),
  };
}

export function makeInMemoryTransactionRunner(
  repos: ProjectRepos,
): TransactionRunner {
  return async (fn) => fn(repos);
}

export function makeUser(overrides: Partial<UserRow> & Pick<UserRow, "id" | "role">): UserRow {
  const now = new Date();
  return {
    name: overrides.name ?? "Usuário",
    email: overrides.email ?? `${overrides.id}@igepps.test`,
    emailVerified: overrides.emailVerified ?? true,
    image: overrides.image ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    ...overrides,
  };
}

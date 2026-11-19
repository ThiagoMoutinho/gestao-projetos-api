import { and, desc, eq } from "drizzle-orm";

import { projectMemberFunctions, projectMembers, user } from "../../../db/schema";
import type { DbClient } from "../../../db/types";
import {
  isUniqueViolation,
  UniqueConstraintError,
} from "../../../lib/postgres-errors";
import type { ProjectMemberRole } from "../schemas/projects.schema";
import type {
  NewProjectMemberRecord,
  ProjectMembersRepository,
} from "./contracts";

export class DrizzleProjectMembersRepository implements ProjectMembersRepository {
  constructor(private readonly client: DbClient) {}

  async findRoles(projectId: string, userId: string) {
    const rows = await this.client
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(
        and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)),
      );

    return rows.map((row) => row.role);
  }

  async listByUser(userId: string) {
    return this.client
      .select({
        projectId: projectMembers.projectId,
        role: projectMembers.role,
      })
      .from(projectMembers)
      .where(eq(projectMembers.userId, userId));
  }

  async listByProject(projectId: string) {
    const rows = await this.client
      .select({
        member: projectMembers,
        user,
        fnId: projectMemberFunctions.id,
        fnName: projectMemberFunctions.name,
      })
      .from(projectMembers)
      .innerJoin(user, eq(user.id, projectMembers.userId))
      .leftJoin(projectMemberFunctions, eq(projectMemberFunctions.id, projectMembers.functionId))
      .where(eq(projectMembers.projectId, projectId))
      .orderBy(desc(projectMembers.createdAt));

    return rows.map(({ member, user: memberUser, fnId, fnName }) => ({
      member,
      user: memberUser,
      fn: fnId && fnName ? { id: fnId, name: fnName } : null,
    }));
  }

  async findByProjectUserRole(
    projectId: string,
    userId: string,
    role: ProjectMemberRole,
  ) {
    const [row] = await this.client
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId),
          eq(projectMembers.role, role),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  async findByIdAndProject(memberId: string, projectId: string) {
    const [row] = await this.client
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.id, memberId), eq(projectMembers.projectId, projectId)))
      .limit(1);

    return row ?? null;
  }

  async create(data: NewProjectMemberRecord) {
    try {
      const [row] = await this.client.insert(projectMembers).values(data).returning();
      return row;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new UniqueConstraintError();
      }

      throw error;
    }
  }

  async findFunction(functionId: string) {
    const [row] = await this.client
      .select({ id: projectMemberFunctions.id, name: projectMemberFunctions.name, isActive: projectMemberFunctions.isActive })
      .from(projectMemberFunctions)
      .where(eq(projectMemberFunctions.id, functionId))
      .limit(1);

    return row ?? null;
  }

  async updateRole(memberId: string, role: ProjectMemberRole, functionId?: string | null) {
    try {
      const [row] = await this.client
        .update(projectMembers)
        .set({ role, functionId: functionId ?? null })
        .where(eq(projectMembers.id, memberId))
        .returning();

      return row;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new UniqueConstraintError();
      }

      throw error;
    }
  }

  async deleteById(memberId: string) {
    await this.client.delete(projectMembers).where(eq(projectMembers.id, memberId));
  }

  async deleteOwnerRole(projectId: string, userId: string) {
    await this.client
      .delete(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId),
          eq(projectMembers.role, "DONO_PROJETO"),
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

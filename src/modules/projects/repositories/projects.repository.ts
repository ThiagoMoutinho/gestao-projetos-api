import { desc, eq, inArray, or } from "drizzle-orm";

import { projects } from "../../../db/schema";
import type { DbClient } from "../../../db/types";
import type {
  NewProjectRecord,
  ProjectsRepository,
  ProjectUpdateRecord,
} from "./contracts";

export class DrizzleProjectsRepository implements ProjectsRepository {
  constructor(private readonly client: DbClient) {}

  async findById(id: string) {
    const [row] = await this.client
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);

    return row ?? null;
  }

  async create(data: NewProjectRecord) {
    const [row] = await this.client.insert(projects).values(data).returning();
    return row;
  }

  async update(id: string, data: ProjectUpdateRecord) {
    const [row] = await this.client
      .update(projects)
      .set(data)
      .where(eq(projects.id, id))
      .returning();

    return row ?? null;
  }

  async listAll() {
    return this.client.select().from(projects).orderBy(desc(projects.createdAt));
  }

  async listByOwnerOrIds(ownerId: string, projectIds: string[]) {
    const filters = [eq(projects.ownerId, ownerId)];

    if (projectIds.length > 0) {
      filters.push(inArray(projects.id, projectIds));
    }

    return this.client
      .select()
      .from(projects)
      .where(or(...filters))
      .orderBy(desc(projects.createdAt));
  }
}

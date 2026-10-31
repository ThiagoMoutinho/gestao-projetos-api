import { eq } from "drizzle-orm";

import type { DbClient } from "../../db/types";
import { userOverviewLayouts } from "../../db/schema";
import type { OverviewWidget } from "./overview-layout.schema";

export interface OverviewLayoutRepository {
  find(userId: string): Promise<OverviewWidget[] | null>;
  save(userId: string, widgets: OverviewWidget[]): Promise<void>;
  remove(userId: string): Promise<void>;
}

export class DrizzleOverviewLayoutRepository implements OverviewLayoutRepository {
  constructor(private readonly client: DbClient) {}

  async find(userId: string) {
    const [row] = await this.client.select().from(userOverviewLayouts).where(eq(userOverviewLayouts.userId, userId)).limit(1);
    return (row?.widgets as OverviewWidget[] | undefined) ?? null;
  }

  async save(userId: string, widgets: OverviewWidget[]) {
    await this.client
      .insert(userOverviewLayouts)
      .values({ userId, widgets })
      .onConflictDoUpdate({ target: userOverviewLayouts.userId, set: { widgets, updatedAt: new Date() } });
  }

  async remove(userId: string) {
    await this.client.delete(userOverviewLayouts).where(eq(userOverviewLayouts.userId, userId));
  }
}

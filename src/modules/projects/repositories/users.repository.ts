import { eq } from "drizzle-orm";

import { user } from "../../../db/schema";
import type { DbClient } from "../../../db/types";
import type { UsersRepository } from "./contracts";

export class DrizzleUsersRepository implements UsersRepository {
  constructor(private readonly client: DbClient) {}

  async findById(id: string) {
    const [row] = await this.client
      .select()
      .from(user)
      .where(eq(user.id, id))
      .limit(1);

    return row ?? null;
  }
}

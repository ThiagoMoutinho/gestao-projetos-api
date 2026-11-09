import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { openAPI } from "better-auth/plugins";
import { eq } from "drizzle-orm";

import { db } from "../db";
import * as schema from "../db/schema";

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,

  trustedOrigins: [
    "http://localhost:3000",
    "http://localhost:3001",
  ],

  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
  },

  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        input: false,
        defaultValue: "COLABORADOR",
      },
      /** Usuário inativo não entra nem mantém sessão (gestão pelo ADMIN). */
      isActive: {
        type: "boolean",
        required: false,
        input: false,
        defaultValue: true,
      },
    },
  },

  databaseHooks: {
    session: {
      create: {
        // Bloqueia novos logins de usuário inativo; as sessões já abertas são barradas em requireAuth.
        before: async (newSession) => {
          const [row] = await db
            .select({ isActive: schema.user.isActive })
            .from(schema.user)
            .where(eq(schema.user.id, newSession.userId));
          if (row && !row.isActive) {
            throw new APIError("FORBIDDEN", { message: "Usuário inativo. Procure o administrador.", code: "USER_INACTIVE" });
          }
        },
      },
    },
  },

  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),

  plugins: [openAPI()],
});

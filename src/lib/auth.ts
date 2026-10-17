import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth";
import { openAPI } from "better-auth/plugins";

import { db } from "../db";
import * as schema from "../db/schema";

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,

  trustedOrigins: [
    "http://localhost:3000",
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
    },
  },


  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),

  plugins: [openAPI()],
});



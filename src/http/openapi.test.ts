import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hashPassword } from "better-auth/crypto";
import { eq, like } from "drizzle-orm";

import { buildApp } from "../app";
import { db } from "../db";
import { account, session, user } from "../db/schema";

const FRONT_ORIGIN = "http://localhost:3001";
const API_ORIGIN = "http://localhost:3000";
const BLOCKED_ORIGIN = "http://evil.example";
const EMAIL_SUFFIX = "@openapi-cors.test";
const EMAIL = `pmo${EMAIL_SUFFIX}`;
const PASSWORD = "Ficticio@Cors20";

const BUSINESS_OPERATION_IDS = [
  "createProject",
  "listProjects",
  "listMyProjects",
  "getProject",
  "updateProject",
  "listProjectMembers",
  "addProjectMember",
  "updateProjectMember",
  "removeProjectMember",
  "listEapPhases",
  "createEapPhase",
  "reorderEapPhases",
  "getEapPhase",
  "updateEapPhase",
  "listEapTasks",
  "createEapTask",
  "reorderEapTasks",
  "getEapTask",
  "updateEapTask",
  "updateEapTaskProgress",
  "listEapMilestones",
  "reorderEapMilestones",
  "createEapMilestone",
  "getEapMilestone",
  "updateEapMilestone",
  "deliverEapMilestone",
  "reviewEapMilestone",
  "listEapEvidences",
  "createEapEvidence",
  "getEapEvidence",
  "updateEapEvidence",
] as const;

type OpenApiOperation = {
  operationId?: string;
  responses?: Record<string, unknown>;
};

type OpenApiDocument = {
  openapi: string;
  paths: Record<string, Record<string, OpenApiOperation>>;
};

function operationsOf(document: OpenApiDocument) {
  const operations: Array<{ method: string; path: string; operation: OpenApiOperation }> = [];
  for (const [path, methods] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (method.startsWith("x-") || method === "parameters") {
        continue;
      }
      operations.push({ method, path, operation });
    }
  }
  return operations;
}

function header(response: { headers: Record<string, unknown> }, name: string) {
  const value = response.headers[name];
  return Array.isArray(value) ? value.join(",") : value == null ? "" : String(value);
}

describe("OpenAPI, CORS e origens confiáveis", () => {
  it("gera swagger com operationId único em cada operação de negócio", async () => {
    const app = await buildApp();
    await app.ready();

    try {
      const document = app.swagger() as OpenApiDocument;
      const served = await app.inject({ method: "GET", url: "/swagger.json" });
      const body = served.json() as OpenApiDocument;

      assert.equal(served.statusCode, 200);
      assert.match(document.openapi, /^3\./);
      assert.equal(body.openapi, document.openapi);

      const operations = operationsOf(document);
      const missing = operations.filter((item) => !item.operation.operationId);
      assert.deepEqual(
        missing.map((item) => `${item.method.toUpperCase()} ${item.path}`),
        [],
      );

      const ids = operations.map((item) => item.operation.operationId);
      assert.equal(new Set(ids).size, ids.length);

      for (const operationId of BUSINESS_OPERATION_IDS) {
        const operation = operations.find((item) => item.operation.operationId === operationId);
        assert.ok(operation, operationId);
        assert.ok(operation.operation.responses);
        assert.ok(Object.keys(operation.operation.responses).length > 0);
      }
    } finally {
      await app.close();
    }
  });

  it("aceita credenciais do front em localhost:3001 e mantém localhost:3000", async () => {
    const app = await buildApp();
    await app.ready();

    try {
      for (const origin of [FRONT_ORIGIN, API_ORIGIN]) {
        const preflight = await app.inject({
          method: "OPTIONS",
          url: "/projects",
          headers: {
            origin,
            "access-control-request-method": "GET",
            "access-control-request-headers": "content-type",
          },
        });
        assert.equal(header(preflight, "access-control-allow-origin"), origin);
        assert.equal(header(preflight, "access-control-allow-credentials"), "true");

        const actual = await app.inject({
          method: "GET",
          url: "/",
          headers: { origin },
        });
        assert.equal(actual.statusCode, 200);
        assert.equal(header(actual, "access-control-allow-origin"), origin);
        assert.equal(header(actual, "access-control-allow-credentials"), "true");
      }

      const blocked = await app.inject({
        method: "GET",
        url: "/",
        headers: { origin: BLOCKED_ORIGIN },
      });
      assert.notEqual(header(blocked, "access-control-allow-origin"), BLOCKED_ORIGIN);
    } finally {
      await app.close();
    }
  });

  it("permite login do front com cookie e recusa origem não confiável", async () => {
    const password = await hashPassword(PASSWORD);
    await db.insert(user).values({
      id: "openapi-cors-pmo",
      name: "PMO Ficticio",
      email: EMAIL,
      emailVerified: true,
      role: "PMO",
    });
    await db.insert(account).values({
      id: "acc-openapi-cors-pmo",
      accountId: "openapi-cors-pmo",
      providerId: "credential",
      userId: "openapi-cors-pmo",
      password,
    });

    const app = await buildApp();
    await app.ready();

    try {
      const signup = await app.inject({
        method: "POST",
        url: "/api/auth/sign-up/email",
        headers: { origin: FRONT_ORIGIN, "content-type": "application/json" },
        payload: JSON.stringify({
          email: `novo${EMAIL_SUFFIX}`,
          password: PASSWORD,
          name: "Novo Ficticio",
        }),
      });
      assert.equal(signup.statusCode, 400);
      assert.equal(header(signup, "access-control-allow-origin"), FRONT_ORIGIN);
      assert.equal(header(signup, "access-control-allow-credentials"), "true");

      const blocked = await app.inject({
        method: "POST",
        url: "/api/auth/sign-in/email",
        headers: { origin: BLOCKED_ORIGIN, "content-type": "application/json" },
        payload: JSON.stringify({ email: EMAIL, password: PASSWORD }),
      });
      assert.equal(blocked.statusCode, 403);
      assert.match(blocked.body, /INVALID_ORIGIN/);

      const login = await app.inject({
        method: "POST",
        url: "/api/auth/sign-in/email",
        headers: { origin: FRONT_ORIGIN, "content-type": "application/json" },
        payload: JSON.stringify({ email: EMAIL, password: PASSWORD }),
      });
      assert.equal(login.statusCode, 200);
      assert.equal(header(login, "access-control-allow-origin"), FRONT_ORIGIN);
      assert.equal(header(login, "access-control-allow-credentials"), "true");
      assert.match(header(login, "set-cookie"), /better-auth\.session_token=/);

      const sessionResponse = await app.inject({
        method: "GET",
        url: "/api/auth/get-session",
        headers: {
          origin: FRONT_ORIGIN,
          cookie: header(login, "set-cookie").split(";")[0],
        },
      });
      assert.equal(sessionResponse.statusCode, 200);
      assert.match(sessionResponse.body, /openapi-cors-pmo/);
      assert.equal(header(sessionResponse, "access-control-allow-credentials"), "true");
    } finally {
      await app.close();
      const rows = await db
        .select({ id: user.id })
        .from(user)
        .where(like(user.email, `%${EMAIL_SUFFIX}`));
      const ids = rows.map((row) => row.id);
      for (const id of ids) {
        await db.delete(session).where(eq(session.userId, id));
        await db.delete(account).where(eq(account.userId, id));
        await db.delete(user).where(eq(user.id, id));
      }
    }
  });
});

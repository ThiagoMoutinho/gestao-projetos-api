import { CLEAN_CONFIRMATION, DEMO_DATABASE_NAME } from "./constants";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export class DemoSeedRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoSeedRefused";
  }
}

export type DemoDatabaseAssessment =
  | {
      ok: true;
      databaseName: string;
      host: string;
      authHost: string;
    }
  | {
      ok: false;
      reason: string;
    };

export function assessDemoDatabase(env: NodeJS.ProcessEnv): DemoDatabaseAssessment {
  if (env.NODE_ENV === "production") {
    return { ok: false, reason: "Execução bloqueada: este script não roda em produção." };
  }

  if (env.NODE_ENV !== "development") {
    return {
      ok: false,
      reason: "Execução bloqueada: defina NODE_ENV=development. Homologação e outros ambientes não são aceitos.",
    };
  }

  if (!env.DATABASE_URL || !env.BETTER_AUTH_URL) {
    return { ok: false, reason: "Execução bloqueada: DATABASE_URL e BETTER_AUTH_URL são obrigatórios." };
  }

  let databaseUrl: URL;
  let authUrl: URL;

  try {
    databaseUrl = new URL(env.DATABASE_URL);
    authUrl = new URL(env.BETTER_AUTH_URL);
  } catch {
    return { ok: false, reason: "Execução bloqueada: DATABASE_URL ou BETTER_AUTH_URL é inválido." };
  }

  const host = normalizeHost(databaseUrl.hostname);
  const authHost = normalizeHost(authUrl.hostname);

  if (!LOCAL_HOSTS.has(host) || !LOCAL_HOSTS.has(authHost)) {
    return {
      ok: false,
      reason: "Execução bloqueada: o banco e o Better Auth precisam estar em localhost.",
    };
  }

  const sslMode = databaseUrl.searchParams.get("sslmode")?.toLowerCase();

  if (sslMode && sslMode !== "disable") {
    return {
      ok: false,
      reason: "Execução bloqueada: a conexão não é o PostgreSQL local sem SSL obrigatório.",
    };
  }

  const databaseName = databaseNameOf(databaseUrl);

  if (!databaseName) {
    return { ok: false, reason: "Execução bloqueada: não foi possível identificar o nome do banco." };
  }

  if (databaseName !== DEMO_DATABASE_NAME) {
    return {
      ok: false,
      reason: `Execução bloqueada: o banco precisa ser ${DEMO_DATABASE_NAME}. Localhost sozinho não autoriza o seed.`,
    };
  }

  if (env.DEMO_SEED_TARGET !== DEMO_DATABASE_NAME) {
    return {
      ok: false,
      reason: `Execução bloqueada: defina DEMO_SEED_TARGET=${DEMO_DATABASE_NAME}. Localhost sozinho não autoriza o seed.`,
    };
  }

  return { ok: true, databaseName, host, authHost };
}

export function cleanConfirmationMode(value: string | undefined): "preview" | "confirmed" | "rejected" {
  if (value === undefined || value.trim() === "") {
    return "preview";
  }

  if (value === CLEAN_CONFIRMATION) {
    return "confirmed";
  }

  return "rejected";
}

function normalizeHost(hostname: string) {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

function databaseNameOf(url: URL) {
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));

  if (!name || name.includes("/")) {
    return "";
  }

  return name;
}

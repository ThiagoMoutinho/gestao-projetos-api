/**
 * Proteção dos testes que acessam o banco (`test:integration`). Sem dependência do restante do sistema (não importa `db`),
 * para poder ser avaliada ANTES de qualquer conexão.
 *
 * Regras (todas obrigatórias):
 * 1. O banco de testes vem SOMENTE de `TEST_DATABASE_URL`. Nunca há retorno ao `DATABASE_URL` (o do desenvolvimento).
 * 2. O nome do banco precisa seguir o padrão exclusivo de testes (`gp_test`, `gp_test_<sufixo>`) e não pode ser um dos
 *    bancos protegidos (principal, prévia, `postgres`, modelos).
 * 3. A autorização é nominal: `TEST_DATABASE_CONFIRM` precisa conter exatamente o nome do banco. Uma sinalização genérica
 *    (por exemplo `=true` ou `=1`) não autoriza nada.
 * 4. Só servidor local (localhost, 127.0.0.1, ::1) e sem parâmetros de URL que troquem host ou banco.
 * 5. O nome do banco REALMENTE conectado (`select current_database()`) é conferido antes da primeira operação do pool.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Padrão exclusivo de bancos de teste. Prévia (`gp_iso_*`) e desenvolvimento ficam de fora por construção. */
export const TEST_DATABASE_NAME_PATTERN = /^gp_test(_[a-z0-9]+)*$/;

/** Bancos que jamais podem ser usados em testes, mesmo que alguém tente alterar o padrão ou a confirmação. */
export const PROTECTED_DATABASE_NAMES: readonly string[] = [
  "gestao-projetos",
  "gp_iso_preview",
  "postgres",
  "template0",
  "template1",
];

/** Parâmetros de URL que poderiam redirecionar a conexão para outro banco ou servidor. */
const FORBIDDEN_URL_PARAMS = ["dbname", "database", "host", "hostaddr", "service", "options", "user", "port"];

export class TestDatabaseRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestDatabaseRefused";
  }
}

export type TestDatabaseAssessment =
  | { ok: true; url: string; databaseName: string; host: string; port: string }
  | { ok: false; reason: string };

function parseDatabaseUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "postgres:" || url.protocol === "postgresql:" ? url : null;
  } catch {
    return null;
  }
}

function databaseNameOf(url: URL) {
  return decodeURIComponent(url.pathname.replace(/^\//, ""));
}

/** Verifica se um nome pode ser usado como banco de testes (padrão exclusivo e fora da lista de protegidos). */
export function isAuthorizedTestDatabaseName(name: string) {
  return TEST_DATABASE_NAME_PATTERN.test(name) && !PROTECTED_DATABASE_NAMES.includes(name);
}

/**
 * Avalia o ambiente. Não abre conexão. `DATABASE_URL` só é lido para recusar um banco de testes igual ao do
 * desenvolvimento; ele nunca é usado como origem da conexão de teste.
 */
export function assessTestDatabase(env: NodeJS.ProcessEnv): TestDatabaseAssessment {
  const raw = env.TEST_DATABASE_URL?.trim();
  if (!raw) {
    return {
      ok: false,
      reason:
        "TEST_DATABASE_URL não definido. Os testes de integração exigem um banco de testes explícito e não usam o DATABASE_URL.",
    };
  }

  const url = parseDatabaseUrl(raw);
  if (!url) {
    return { ok: false, reason: "TEST_DATABASE_URL inválido: informe uma URL postgresql://…" };
  }

  const databaseName = databaseNameOf(url);
  if (!databaseName) {
    return { ok: false, reason: "TEST_DATABASE_URL sem nome de banco." };
  }

  if (PROTECTED_DATABASE_NAMES.includes(databaseName)) {
    return { ok: false, reason: `O banco "${databaseName}" é protegido e não pode ser usado em testes.` };
  }

  if (!TEST_DATABASE_NAME_PATTERN.test(databaseName)) {
    return {
      ok: false,
      reason: `O banco "${databaseName}" não é um banco de testes autorizado (esperado: gp_test ou gp_test_<sufixo>).`,
    };
  }

  const host = url.hostname.toLowerCase();
  if (!LOCAL_HOSTS.has(host)) {
    return { ok: false, reason: `Servidor "${host}" não é local. Testes só rodam em servidor local.` };
  }

  const forbidden = FORBIDDEN_URL_PARAMS.find((name) => url.searchParams.has(name));
  if (forbidden) {
    return { ok: false, reason: `Parâmetro "${forbidden}" na URL de testes não é permitido.` };
  }

  const confirm = env.TEST_DATABASE_CONFIRM?.trim();
  if (!confirm) {
    return {
      ok: false,
      reason: `Autorização ausente: defina TEST_DATABASE_CONFIRM=${databaseName} (o nome exato do banco de testes).`,
    };
  }
  if (confirm !== databaseName) {
    return {
      ok: false,
      reason: `TEST_DATABASE_CONFIRM ("${confirm}") não corresponde ao banco de TEST_DATABASE_URL ("${databaseName}").`,
    };
  }

  const dev = env.DATABASE_URL ? parseDatabaseUrl(env.DATABASE_URL.trim()) : null;
  if (dev && databaseNameOf(dev) === databaseName && dev.hostname.toLowerCase() === host && (dev.port || "5432") === (url.port || "5432")) {
    return { ok: false, reason: "O banco de testes é o mesmo do DATABASE_URL de desenvolvimento." };
  }

  return { ok: true, url: raw, databaseName, host, port: url.port || "5432" };
}

/** Variável que marca o processo como "execução de testes de integração" (ver `force-test-mode.ts`). */
export const TEST_MODE_FLAG = "IGEPPS_DB_TEST_MODE";

/**
 * O processo está em modo de teste quando roda sob o executor de testes do Node (`NODE_TEST_CONTEXT`), com
 * `NODE_ENV=test`, ou quando o arquivo de teste ligou o modo explicitamente. Nesse modo o acesso ao banco só existe
 * para um banco de testes autorizado.
 */
export function isTestMode(env: NodeJS.ProcessEnv) {
  return Boolean(env.NODE_TEST_CONTEXT) || env.NODE_ENV === "test" || env[TEST_MODE_FLAG] === "1";
}

export type QueryOneName = () => Promise<string>;

/**
 * Confere o nome do banco REALMENTE conectado contra o autorizado. Rejeita se for protegido, se fugir do padrão ou se
 * diferir do esperado. Só executa uma leitura (`select current_database()`), feita pelo chamador.
 */
export async function assertConnectedToTestDatabase(readCurrentDatabase: QueryOneName, authorizedName: string) {
  const actual = await readCurrentDatabase();
  if (!isAuthorizedTestDatabaseName(actual) || actual !== authorizedName) {
    throw new TestDatabaseRefused(
      `Conexão recusada: o servidor respondeu com o banco "${actual}", diferente do banco de testes autorizado "${authorizedName}". Nenhuma operação foi executada.`,
    );
  }
}

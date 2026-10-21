import "dotenv/config";

import { auth } from "../lib/auth";

const EMAIL = "pmo.teste@exemplo.com";
const NAME = "Usuário de Teste PMO";
const ROLE = "PMO";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

type StoredUser = {
  id: string;
  email: string;
  name?: string;
  role?: string;
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function hostnameOf(value: string) {
  return new URL(value).hostname;
}

function assertDevelopmentOnly() {
  if (process.env.NODE_ENV === "production") {
    fail("Execução bloqueada: este script não roda em produção.");
  }

  if (process.env.NODE_ENV !== "development") {
    fail("Execução bloqueada: defina NODE_ENV=development.");
  }

  const databaseUrl = process.env.DATABASE_URL;
  const authUrl = process.env.BETTER_AUTH_URL;

  if (!databaseUrl || !authUrl) {
    fail("Execução bloqueada: DATABASE_URL e BETTER_AUTH_URL são obrigatórios.");
  }

  let databaseHost: string;
  let authHost: string;

  try {
    databaseHost = hostnameOf(databaseUrl);
    authHost = hostnameOf(authUrl);
  } catch {
    fail("Execução bloqueada: DATABASE_URL ou BETTER_AUTH_URL é inválido.");
  }

  if (!LOCAL_HOSTS.has(databaseHost) || !LOCAL_HOSTS.has(authHost)) {
    fail("Execução bloqueada: o banco e o Better Auth precisam apontar para localhost.");
  }
}

function readPassword() {
  const password = process.env.BOOTSTRAP_PMO_PASSWORD;

  if (!password) {
    fail(
      "Informe BOOTSTRAP_PMO_PASSWORD no ambiente. Não passe a senha como argumento do comando.",
    );
  }

  if (password.length < 8 || password.length > 128) {
    fail("A senha precisa ter entre 8 e 128 caracteres.");
  }

  return password;
}

function asUsers(value: unknown): StoredUser[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const record = item as Record<string, unknown>;

    if (typeof record.id !== "string" || typeof record.email !== "string") {
      return [];
    }

    return [
      {
        id: record.id,
        email: record.email,
        name: typeof record.name === "string" ? record.name : undefined,
        role: typeof record.role === "string" ? record.role : undefined,
      },
    ];
  });
}

function roleOf(user: object | null | undefined) {
  if (!user || !("role" in user) || typeof user.role !== "string") {
    return undefined;
  }

  return user.role;
}

function sameRoles(before: StoredUser[], after: StoredUser[]) {
  const roles = new Map(before.map((user) => [user.id, user.role]));

  return after
    .filter((user) => roles.has(user.id))
    .every((user) => roles.get(user.id) === user.role);
}

async function main() {
  assertDevelopmentOnly();
  const password = readPassword();
  const context = await auth.$context;
  const before = asUsers(await context.internalAdapter.listUsers(1000, 0));
  const existing = await context.internalAdapter.findUserByEmail(EMAIL);

  if (existing?.user) {
    const after = asUsers(await context.internalAdapter.listUsers(1000, 0));

    if (!sameRoles(before, after)) {
      fail("A execução foi interrompida porque o perfil de outro usuário mudou.");
    }

    console.log("Usuário já existe. Senha e perfil não foram alterados.");
    console.log(`E-mail: ${EMAIL}`);
    return;
  }

  const hashedPassword = await context.password.hash(password);
  const created = asUsers([
    await context.internalAdapter.createUser(
      {
        email: EMAIL,
        name: NAME,
        role: ROLE,
        emailVerified: false,
      },
      { method: "email-password" },
    ),
  ])[0];

  if (!created) {
    fail("Não foi possível criar o usuário.");
  }

  if (created.role !== ROLE) {
    await context.internalAdapter.deleteUser(created.id);
    fail("O usuário não ficou com o perfil PMO e a criação foi desfeita.");
  }

  try {
    await context.internalAdapter.linkAccount({
      accountId: created.id,
      providerId: "credential",
      userId: created.id,
      password: hashedPassword,
    });
  } catch (error) {
    await context.internalAdapter.deleteUser(created.id);
    throw error;
  }

  const confirmed = await context.internalAdapter.findUserByEmail(EMAIL, {
    includeAccounts: true,
  });
  const account = confirmed?.accounts?.[0] as { password?: unknown; providerId?: unknown } | undefined;
  const storedPassword = typeof account?.password === "string" ? account.password : "";

  if (
    roleOf(confirmed?.user) !== ROLE ||
    account?.providerId !== "credential" ||
    storedPassword.length === 0 ||
    storedPassword === password
  ) {
    await context.internalAdapter.deleteUser(created.id);
    fail("A credencial não foi gravada com o hash do Better Auth. A criação foi desfeita.");
  }

  const after = asUsers(await context.internalAdapter.listUsers(1000, 0));

  if (!sameRoles(before, after)) {
    await context.internalAdapter.deleteUser(created.id);
    fail("A criação foi desfeita porque o perfil de outro usuário mudou.");
  }

  console.log("Usuário de teste criado.");
  console.log(`Nome: ${NAME}`);
  console.log(`E-mail: ${EMAIL}`);
  console.log("Perfil: PMO");
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    const password = process.env.BOOTSTRAP_PMO_PASSWORD ?? "";
    const message = error instanceof Error ? error.message : "Falha ao criar o usuário de teste.";
    console.error(password ? message.split(password).join("[redigido]") : message);
    process.exit(1);
  });

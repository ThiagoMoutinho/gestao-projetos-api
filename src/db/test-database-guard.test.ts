import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

import { createTestDatabase } from "./create-database";
import { GuardedTestPool } from "./guarded-test-pool";
import {
  assertConnectedToTestDatabase,
  assessTestDatabase,
  isAuthorizedTestDatabaseName,
  isTestMode,
  TestDatabaseRefused,
} from "./test-database-guard";

/**
 * Estes testes NÃO abrem conexão com nenhum banco real: usam leituras simuladas do nome do banco e um endereço sem
 * servidor (127.0.0.1:1). Provam que a proteção bloqueia antes de qualquer operação.
 */
const DEV_URL = "postgresql://postgres:segredo@localhost:5432/gestao-projetos";
const url = (name: string, host = "localhost") => `postgresql://postgres:segredo@${host}:5432/${name}`;
const valid = (name = "gp_test") => ({ TEST_DATABASE_URL: url(name), TEST_DATABASE_CONFIRM: name, DATABASE_URL: DEV_URL }) as NodeJS.ProcessEnv;
const reason = (env: NodeJS.ProcessEnv) => {
  const result = assessTestDatabase(env);
  assert.equal(result.ok, false);
  return result.ok ? "" : result.reason;
};

describe("proteção do banco de testes: avaliação do ambiente", () => {
  it("aceita somente um banco gp_test explícito, com confirmação nominal", () => {
    for (const name of ["gp_test", "gp_test_ci", "gp_test_2"]) {
      const result = assessTestDatabase(valid(name));
      assert.equal(result.ok, true, name);
      assert.equal(result.ok && result.databaseName, name);
    }
  });

  it("não tem fallback para o DATABASE_URL de desenvolvimento", () => {
    assert.match(reason({ DATABASE_URL: DEV_URL } as NodeJS.ProcessEnv), /TEST_DATABASE_URL não definido/);
    assert.match(reason({ DATABASE_URL: url("gp_test"), TEST_DATABASE_URL: "   " } as NodeJS.ProcessEnv), /TEST_DATABASE_URL não definido/);
  });

  it("rejeita os bancos protegidos, mesmo com a confirmação correta", () => {
    for (const name of ["gestao-projetos", "gp_iso_preview", "postgres", "template0", "template1"]) {
      const env = { TEST_DATABASE_URL: url(name), TEST_DATABASE_CONFIRM: name } as NodeJS.ProcessEnv;
      assert.match(reason(env), /protegido/, name);
    }
  });

  it("rejeita qualquer banco fora do padrão de testes", () => {
    for (const name of ["gp_iso_verify", "gp_iso_33", "gp_testing", "GP_TEST", "gp_test-", "gestao_projetos_test", "gp_restore_test_main_20261106", "meu_banco"]) {
      const env = { TEST_DATABASE_URL: url(name), TEST_DATABASE_CONFIRM: name } as NodeJS.ProcessEnv;
      assert.match(reason(env), /não é um banco de testes autorizado/, name);
    }
    assert.equal(isAuthorizedTestDatabaseName("gp_test"), true);
    assert.equal(isAuthorizedTestDatabaseName("gp_iso_preview"), false);
  });

  it("exige autorização nominal: ausente, genérica ou de outro banco não autoriza", () => {
    const base = { TEST_DATABASE_URL: url("gp_test") };
    assert.match(reason({ ...base } as NodeJS.ProcessEnv), /Autorização ausente/);
    for (const confirm of ["true", "1", "yes", "sim", "gp_test_ci", "gestao-projetos", "GP_TEST"]) {
      assert.match(reason({ ...base, TEST_DATABASE_CONFIRM: confirm } as NodeJS.ProcessEnv), /não corresponde/, confirm);
    }
  });

  it("só aceita servidor local e URL sem parâmetros que troquem host ou banco", () => {
    const remote = { TEST_DATABASE_URL: url("gp_test", "db.interno.exemplo"), TEST_DATABASE_CONFIRM: "gp_test" } as NodeJS.ProcessEnv;
    assert.match(reason(remote), /não é local/);
    for (const param of ["dbname=gestao-projetos", "host=outro", "options=-c%20search_path%3Dx", "database=gestao-projetos"]) {
      const env = { TEST_DATABASE_URL: `${url("gp_test")}?${param}`, TEST_DATABASE_CONFIRM: "gp_test" } as NodeJS.ProcessEnv;
      assert.match(reason(env), /não é permitido/, param);
    }
    assert.match(reason({ TEST_DATABASE_URL: "mysql://x/gp_test", TEST_DATABASE_CONFIRM: "gp_test" } as NodeJS.ProcessEnv), /inválido/);
    assert.match(reason({ TEST_DATABASE_URL: "postgresql://localhost:5432/", TEST_DATABASE_CONFIRM: "x" } as NodeJS.ProcessEnv), /sem nome de banco/);
  });

  it("recusa banco de testes igual ao do desenvolvimento", () => {
    const env = { TEST_DATABASE_URL: url("gp_test"), TEST_DATABASE_CONFIRM: "gp_test", DATABASE_URL: url("gp_test") } as NodeJS.ProcessEnv;
    assert.match(reason(env), /mesmo do DATABASE_URL/);
  });

  it("modo de teste: executor do Node, NODE_ENV=test ou ativação explícita", () => {
    assert.equal(isTestMode({ NODE_TEST_CONTEXT: "child-v8" } as NodeJS.ProcessEnv), true);
    assert.equal(isTestMode({ NODE_ENV: "test" } as NodeJS.ProcessEnv), true);
    assert.equal(isTestMode({ IGEPPS_DB_TEST_MODE: "1" } as NodeJS.ProcessEnv), true);
    assert.equal(isTestMode({ NODE_ENV: "development" } as NodeJS.ProcessEnv), false);
  });
});

describe("proteção do banco de testes: nome do banco realmente conectado", () => {
  it("rejeita quando o servidor responde com outro banco, sem executar nada além da leitura", async () => {
    for (const actual of ["gestao-projetos", "gp_iso_preview", "postgres", "gp_test_outro"]) {
      await assert.rejects(() => assertConnectedToTestDatabase(async () => actual, "gp_test"), TestDatabaseRefused, actual);
    }
    await assertConnectedToTestDatabase(async () => "gp_test", "gp_test");
  });

  it("o pool recusa a primeira consulta e não abre nenhuma conexão quando o banco real é protegido", async () => {
    let reads = 0;
    const pool = new GuardedTestPool("postgresql://postgres:x@127.0.0.1:1/gp_test", "gp_test", {}, async () => {
      reads += 1;
      return "gestao-projetos";
    });
    await assert.rejects(() => pool.query("insert into projects default values"), TestDatabaseRefused);
    await assert.rejects(() => pool.connect(), TestDatabaseRefused);
    await assert.rejects(() => pool.query("delete from projects"), TestDatabaseRefused);
    await new Promise<void>((resolve) =>
      pool.connect((error) => {
        assert.ok(error instanceof TestDatabaseRefused);
        resolve();
      }),
    );
    assert.equal(reads, 1, "a conferência é feita uma única vez e a recusa é definitiva");
    assert.equal(pool.totalCount, 0, "nenhuma conexão do pool foi aberta");
    await pool.end();
  });

  it("com o nome correto a conferência passa e a operação segue (aqui falha só por não haver servidor em 127.0.0.1:1)", async () => {
    const pool = new GuardedTestPool("postgresql://postgres:x@127.0.0.1:1/gp_test", "gp_test", {}, async () => "gp_test");
    await assert.rejects(
      () => pool.query("select 1"),
      (error: unknown) => !(error instanceof TestDatabaseRefused),
    );
    await pool.end();
  });
});

describe("proteção do banco de testes: criação do acesso ao banco", () => {
  it("createTestDatabase falha antes de criar qualquer conexão quando a configuração é inválida", () => {
    for (const env of [
      { DATABASE_URL: DEV_URL },
      { DATABASE_URL: DEV_URL, TEST_DATABASE_URL: DEV_URL, TEST_DATABASE_CONFIRM: "gestao-projetos" },
      { DATABASE_URL: DEV_URL, TEST_DATABASE_URL: url("gp_iso_preview"), TEST_DATABASE_CONFIRM: "gp_iso_preview" },
      { DATABASE_URL: DEV_URL, TEST_DATABASE_URL: url("postgres"), TEST_DATABASE_CONFIRM: "postgres" },
      { DATABASE_URL: DEV_URL, TEST_DATABASE_URL: url("gp_test") },
    ] as NodeJS.ProcessEnv[]) {
      assert.throws(() => createTestDatabase(env), TestDatabaseRefused);
    }
  });

  it("com configuração válida cria o acesso (preguiçoso: não conecta até a primeira operação) e não altera o ambiente de outros", async () => {
    const env = valid("gp_test");
    const database = createTestDatabase(env);
    assert.equal((database.$client as GuardedTestPool).totalCount, 0);
    assert.equal(env.DATABASE_URL, DEV_URL, "só o ambiente do processo é reescrito, nunca um objeto recebido de fora");
    await database.$client.end();
  });
});

describe("proteção do banco de testes: arquivos de teste de integração", () => {
  const root = new URL("../../", import.meta.url);
  // Sem nenhum servidor possível (porta 1) e sem ler o .env real: se algo tentasse conectar, o erro seria ECONNREFUSED.
  const childEnv = {
    ...process.env,
    DATABASE_URL: "postgresql://postgres:x@127.0.0.1:1/gestao-projetos",
    TEST_DATABASE_URL: "",
    TEST_DATABASE_CONFIRM: "",
    DOTENV_CONFIG_PATH: "nao-existe.env",
  };

  function run(args: string[], env: NodeJS.ProcessEnv) {
    return spawnSync(process.execPath, ["--import", "tsx", ...args], { cwd: root, env, encoding: "utf8", timeout: 60_000 });
  }

  it("importar o db em modo de teste, sem banco de testes, aborta com TestDatabaseRefused e sem tentar conectar", () => {
    const result = run(["-e", "import('./src/db/index.ts')"], { ...childEnv, IGEPPS_DB_TEST_MODE: "1" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /TestDatabaseRefused/);
    assert.match(result.stderr, /TEST_DATABASE_URL não definido/);
    assert.doesNotMatch(result.stderr, /ECONNREFUSED/);
  });

  it("o db sob o executor de testes (NODE_TEST_CONTEXT) também exige o banco de testes", () => {
    const result = run(["-e", "import('./src/db/index.ts')"], { ...childEnv, NODE_TEST_CONTEXT: "child-v8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /TestDatabaseRefused/);
  });

  it("o db sob o executor de testes recusa o banco principal e a prévia mesmo com confirmação", () => {
    for (const name of ["gestao-projetos", "gp_iso_preview"]) {
      const result = run(["-e", "import('./src/db/index.ts')"], {
        ...childEnv,
        NODE_TEST_CONTEXT: "child-v8",
        TEST_DATABASE_URL: `postgresql://postgres:x@127.0.0.1:1/${name}`,
        TEST_DATABASE_CONFIRM: name,
      });
      assert.notEqual(result.status, 0, name);
      assert.match(result.stderr, /protegido/, name);
      assert.doesNotMatch(result.stderr, /ECONNREFUSED/, name);
    }
  });

  it("src/http/openapi.test.ts executado diretamente, sem o executor, aborta antes de qualquer teste ou conexão", () => {
    const result = run(["src/http/openapi.test.ts"], childEnv);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /TestDatabaseRefused/);
    assert.doesNotMatch(result.stderr, /ECONNREFUSED/);
    assert.doesNotMatch(result.stdout, /✔/, "nenhum teste chegou a rodar");
  });
});

import { Client, Pool, type PoolClient, type PoolConfig } from "pg";

import { assertConnectedToTestDatabase } from "./test-database-guard";

type ReadDatabaseName = () => Promise<string>;

/**
 * Pool usado somente nos testes. Antes de entregar a primeira conexão (qualquer consulta, escrita ou transação), abre uma
 * conexão separada, só de leitura, e confere o nome do banco realmente conectado (`select current_database()`).
 * Se não for o banco de testes autorizado, TODAS as operações seguintes falham e nenhuma conexão do pool é aberta.
 * O resultado da conferência (inclusive a recusa) fica guardado: não há segunda chance dentro do mesmo processo.
 */
export class GuardedTestPool extends Pool {
  readonly #authorizedName: string;
  readonly #readDatabaseName: ReadDatabaseName;
  #verified: Promise<void> | null = null;

  constructor(
    url: string,
    authorizedName: string,
    config: PoolConfig = {},
    /** Apenas para testes da própria proteção: substitui a leitura real do nome do banco. */
    readDatabaseName?: ReadDatabaseName,
  ) {
    super({ ...config, connectionString: url });
    this.#authorizedName = authorizedName;
    this.#readDatabaseName =
      readDatabaseName ??
      (async () => {
        const client = new Client({ connectionString: url });
        await client.connect();
        try {
          const result = await client.query<{ name: string }>("select current_database() as name");
          return result.rows[0].name;
        } finally {
          await client.end();
        }
      });
  }

  #verify() {
    this.#verified ??= assertConnectedToTestDatabase(this.#readDatabaseName, this.#authorizedName);
    return this.#verified;
  }

  // `Pool.query` e as transações do Drizzle passam por `connect`; sobrescrevê-lo cobre todos os caminhos.
  override connect(): Promise<PoolClient>;
  override connect(callback: (error: Error | undefined, client: PoolClient | undefined, done: (release?: unknown) => void) => void): void;
  override connect(callback?: (error: Error | undefined, client: PoolClient | undefined, done: (release?: unknown) => void) => void) {
    if (typeof callback === "function") {
      this.#verify().then(
        () => super.connect(callback),
        (error: Error) => callback(error, undefined, () => undefined),
      );
      return;
    }
    return this.#verify().then(() => super.connect());
  }
}

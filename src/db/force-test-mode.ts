/**
 * Liga o modo de teste do acesso ao banco (ver `test-database-guard.ts`). Deve ser o PRIMEIRO import de todo arquivo de
 * teste que usa `db`, `app` ou `lib/auth`. Assim, mesmo executado sem o executor de testes do Node
 * (por exemplo `tsx src/http/openapi.test.ts`), o arquivo nunca conecta ao banco de desenvolvimento.
 */
import { TEST_MODE_FLAG } from "./test-database-guard";

process.env[TEST_MODE_FLAG] = "1";

# Migrations 0026 a 0030: verificação e preparo para versionamento

Registro da conferência feita em 06/11/2026 (somente leitura). As migrations já estavam aplicadas no banco de
desenvolvimento; nenhum arquivo SQL foi alterado, recriado ou reexecutado, e nenhum schema foi sincronizado.

## Arquivos (ordem de execução = ordem do `_journal.json`)

| idx | Arquivo SQL | Snapshot | Bytes | SHA-256 do SQL |
|---|---|---|---|---|
| 26 | `drizzle/0026_executive_summary_validations.sql` | `drizzle/meta/0026_snapshot.json` | 3534 | `caad104b51736927…` |
| 27 | `drizzle/0027_business_calendar.sql` | `drizzle/meta/0027_snapshot.json` | 6517 | `e2912ba10745303c…` |
| 28 | `drizzle/0028_user_activation.sql` | `drizzle/meta/0028_snapshot.json` | 2870 | `b18d8e012a00e3e1…` |
| 29 | `drizzle/0029_notifications.sql` | `drizzle/meta/0029_snapshot.json` | 19016 | `c9676d3e53ae7f52…` |
| 30 | `drizzle/0030_notification_scheduler.sql` | `drizzle/meta/0030_snapshot.json` | 3441 | `4ef151de49694742…` |

O `drizzle/meta/_journal.json` acrescenta apenas as 5 entradas (0026 a 0030) às 26 já versionadas (diff: +35 linhas, nenhuma
remoção).

## Conferência contra `drizzle.__drizzle_migrations` (banco `gestao-projetos`)

- 31 linhas no banco, 31 entradas no journal.
- Para cada migration 0026 a 0030: o SHA-256 do arquivo é **igual** ao `hash` gravado pelo Drizzle, o `created_at` é
  **igual** ao `when` do journal e a posição (`id` = idx + 1) coincide. As mesmas 31 linhas existem em `gp_iso_preview`.
- Todos os objetos criados pelos comandos `CREATE TABLE`, `ADD COLUMN`, `CREATE INDEX` e `ADD CONSTRAINT` dos 5 arquivos
  existem no banco (nenhum ausente).
- Dados semeados: `notification_settings` tem a linha `GLOBAL` com `activation_enabled = false` (0029) e
  `notification_scheduler_state` tem 1 linha (0030).
- Os CHECKs recriados na 0030 (`notification_issues_kind_chk` e `notification_runs_origin_chk`) têm no banco apenas valores
  presentes no arquivo.
- Cadeia de snapshots 0026 a 0030: cada `prevId` aponta para o `id` do snapshot anterior.

## Preparo para o Git

- Nenhum dos 10 arquivos (5 `.sql` e 5 snapshots) é ignorado por `.gitignore` (`git check-ignore` sem resultado).
- Terminam em LF, sem BOM e sem CRLF, e o `.gitattributes` (`* text=auto eol=lf`) mantém os bytes idênticos no commit, ou seja,
  o hash do SQL que o Drizzle espera não muda ao versionar.
- Os arquivos continuam **não rastreados**: nada foi adicionado ao índice e nenhum commit foi feito.

## Dependência para o commit (não organizado nesta etapa)

0026 → 0029 (FK `resolved_validation_id`), 0027 → 0029, 0028 → 0029 e 0029 → 0030. Um commit que leve código de notificações
precisa levar 0026 a 0030; o de resumo executivo precisa de 0026 (e o código do ciclo depende do calendário, 0027).

## O que não foi feito

- `drizzle-kit generate/check/migrate/push` não foram executados (`generate` gravaria arquivos e `migrate/push` alteram o banco).
- A igualdade entre o schema TypeScript (`src/db/schema/*`) e o último snapshot não foi recalculada; só foram conferidos
  arquivos, histórico e catálogo do banco.

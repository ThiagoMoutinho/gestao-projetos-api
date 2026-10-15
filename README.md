# gestao-projetos-api

API Fastify com PostgreSQL e Drizzle.

## Primeiro uso

1. Suba o Postgres com `docker compose up -d` na pasta raiz do projeto.
2. `pnpm run db:push` — cria as tabelas a partir de `src/db/schema.ts`.
3. `pnpm run dev` — sobe a API em `http://localhost:3000`. A documentação fica em `/docs`.

## Banco

- `pnpm run db:studio` — abre o Drizzle Studio para ver e editar os dados
- `pnpm run db:generate` — gera uma migration em `drizzle/` depois de mudar o schema
- `pnpm run db:migrate` — aplica as migrations geradas
- `pnpm run db:push` — aplica o schema direto no banco, sem arquivo de migration

O schema fica em `src/db/schema.ts`. O client fica em `src/db/index.ts` (`import { db } from "./db"`)
import "dotenv/config";

import { sql } from "drizzle-orm";

import { db } from "../db";
import { makeNotificationsModule } from "../modules/notifications/notifications.routes";

/**
 * Ensaio da paginação por cursor das notificações no Postgres real, em BANCO ISOLADO (nome iniciado por "gp_iso").
 * Cobre datas idênticas ao microssegundo, datas que diferem só em microssegundos e inserções durante a navegação.
 *
 *   DATABASE_URL=postgresql://.../gp_iso_35 pnpm tsx src/scripts/notifications-pagination-rehearsal.ts
 */
if (!/\/gp_iso[^/]*$/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Recusado: este ensaio só roda em banco isolado (nome iniciado por gp_iso).");
  process.exit(2);
}

const log: string[] = [];
const ok = (condition: boolean, message: string) => log.push(`${condition ? "OK    " : "FALHA "}${message}`);
const q = async (query: string) => (await db.execute(sql.raw(query))).rows as Array<Record<string, unknown>>;
const useCases = makeNotificationsModule(db);
const pmo = { id: "iso-pmo", name: "PMO", email: "p@x.test", role: "PMO" as const };
const other = { id: "iso-other", name: "Outro", email: "o@x.test", role: "PMO" as const };
const colab = { id: "iso-colab", name: "Colab", email: "c@x.test", role: "COLABORADOR" as const };

let seq = 0;
/** Insere uma notificação com data de criação exata (microssegundos) e uma entrega para o PMO de ensaio. */
async function add(createdAt: string, extra: { kind?: string; resolved?: boolean; read?: boolean; id?: string } = {}) {
  const id = extra.id ?? `n${String(++seq).padStart(4, "0")}`;
  await q(`insert into executive_followup_notifications (id, project_id, kind, cycle_start, due_date, scheduled_for, dedupe_key, title, body, followup_snapshot, run_id, created_at, resolved_at, resolution_reason, resolved_validation_id)
           values ('${id}', 'iso-p1', '${extra.kind ?? "OVERDUE"}', '2026-11-05', '2026-11-11', '2026-11-12 12:00:00', 'k-${id}', 'Título ${id}', 'Corpo ${id}', '{}', 'run-1', '${createdAt}',
                   ${extra.resolved ? `'${createdAt}', 'VALIDATED', 'iso-val1'` : "null, null, null"})`);
  await q(`insert into notification_deliveries (id, notification_id, user_id, recipient_name, recipient_email, recipient_role, visibility, delivered_at, read_at)
           values ('d-${id}', '${id}', 'iso-pmo', 'PMO', 'p@x.test', 'PMO', 'TO', '${createdAt}', ${extra.read ? `'${createdAt}'` : "null"})`);
  return id;
}

async function walkAll(limit: number, mine: boolean, between?: (page: number) => Promise<void>) {
  const seen: string[] = [];
  let cursor: string | undefined;
  let page = 0;
  do {
    const result = mine ? await useCases.listInbox(pmo, { cursor, limit }) : await useCases.listNotifications(pmo, { cursor, limit });
    seen.push(...(mine ? (result as Awaited<ReturnType<typeof useCases.listInbox>>).data.map((item) => item.notification.id) : (result as Awaited<ReturnType<typeof useCases.listNotifications>>).data.map((item) => item.id)));
    cursor = result.nextCursor ?? undefined;
    page += 1;
    if (between) await between(page);
  } while (cursor && page < 500);
  return seen;
}

async function main() {
  // ---- Dados de ensaio (banco isolado) ----
  for (const id of ["iso-admin", "iso-pmo", "iso-other", "iso-colab"]) {
    await q(`insert into "user" (id, name, email, role) values ('${id}', '${id}', '${id}@x.test', '${id === "iso-admin" ? "ADMIN" : id === "iso-colab" ? "COLABORADOR" : "PMO"}')`);
  }
  await q(`insert into projects (id, name, owner_id, status) values ('iso-p1', 'Projeto de ensaio', 'iso-admin', 'EM_EXECUCAO')`);
  await q(`insert into notification_runs (id, mode, origin, status, as_of) values ('run-1', 'ACTIVE', 'CLI', 'COMPLETED', now())`);
  await q(`insert into project_executive_summary_validations (id, project_id, cycle_start, cycle_end, kind, snapshot, fingerprint, validated_by) values ('iso-val1', 'iso-p1', '2026-11-12', '2026-11-18', 'REGULAR', '{}', 'fp', 'iso-pmo')`);
  await q(`update notification_settings set activation_enabled = true, activation_cutoff = '2026-11-05', activated_at = '2026-11-01 10:00:00', activated_by = 'iso-admin'`);

  // 20 com data idêntica ao microssegundo; 20 que diferem só em microssegundos (mesmo milissegundo); 20 distintas.
  const same: string[] = [];
  for (let i = 0; i < 20; i += 1) same.push(await add("2026-11-12 13:00:00.123456", { kind: i % 3 === 0 ? "PREVENTIVE" : "OVERDUE", resolved: i % 4 === 0, read: i % 2 === 0 }));
  const micro: string[] = [];
  for (let i = 0; i < 20; i += 1) micro.push(await add(`2026-11-12 13:00:01.2345${String(10 + i).padStart(2, "0")}`));
  const distinct: string[] = [];
  for (let i = 0; i < 20; i += 1) distinct.push(await add(`2026-11-12 12:${String(i).padStart(2, "0")}:00.000000`));
  const total = 60;

  const expectedOrder = (await q(`select id from executive_followup_notifications order by created_at desc, id desc`)).map((row) => String(row.id));
  ok(expectedOrder.length === total, `${total} notificações de ensaio (20 com data idêntica ao microssegundo, 20 só com microssegundos diferentes, 20 distintas)`);

  // ---- 1. Qualquer tamanho de página: sem repetir, sem perder, na ordem do banco ----
  for (const limit of [1, 2, 3, 5, 7, 9, 13, 20, 59, 60, 200]) {
    const admin = await walkAll(limit, false);
    const mine = await walkAll(limit, true);
    const good = (list: string[]) => list.length === total && new Set(list).size === total && JSON.stringify(list) === JSON.stringify(expectedOrder);
    if (!good(admin) || !good(mine)) ok(false, `limite ${limit}: lista incorreta (todas=${admin.length}/${new Set(admin).size}, minhas=${mine.length}/${new Set(mine).size})`);
  }
  ok(!log.some((line) => line.startsWith("FALHA")), "11 tamanhos de página (1 a 200): nenhuma repetição, nenhuma perda, ordem idêntica à do banco (Todas e Minhas)");

  // ---- 2. Novos registros chegando DURANTE a navegação ----
  let injected = 0;
  const during = await walkAll(7, false, async (page) => {
    if (page === 1 || page === 3) {
      await add(`2026-11-12 14:${String(page).padStart(2, "0")}:00.000000`);
      await add(`2026-11-12 14:${String(page).padStart(2, "0")}:00.000001`);
      injected += 2;
    }
  });
  ok(injected === 4 && during.length === total && new Set(during).size === total && JSON.stringify(during) === JSON.stringify(expectedOrder), "4 notificações novas criadas durante a navegação: a lista percorrida tem exatamente os 60 originais, sem repetir nem perder");
  const refreshed = await useCases.listNotifications(pmo, { limit: 6 });
  ok(refreshed.data.length === 6 && refreshed.data[0].createdAt > refreshed.data[5].createdAt && (await q(`select count(*)::int as n from executive_followup_notifications`))[0].n === 64, "ao atualizar, as 4 novas aparecem no topo");

  // ---- 3. Filtros no banco real ----
  const count = async (filter: object) => {
    const ids = await walkAll(11, false).then(() => []);
    void ids;
    let cursor: string | undefined;
    let n = 0;
    do {
      const page = await useCases.listNotifications(pmo, { cursor, limit: 9, ...filter });
      n += page.data.length;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return n;
  };
  const dbCount = async (where: string) => Number((await q(`select count(*)::int as n from executive_followup_notifications n where ${where}`))[0].n);
  ok((await count({ kind: "PREVENTIVE" })) === (await dbCount("kind = 'PREVENTIVE'")), "filtro por tipo confere com o banco");
  ok((await count({ resolved: true })) === (await dbCount("resolved_at is not null")) && (await count({ resolved: false })) === (await dbCount("resolved_at is null")), "filtro de pendência (resolvidas e pendentes) confere com o banco");
  ok((await count({ projectId: "iso-p1" })) === 64 && (await count({ projectId: "outro" })) === 0, "filtro por projeto confere");
  ok((await count({ unread: true })) === (await dbCount("exists (select 1 from notification_deliveries d where d.notification_id = n.id and d.read_at is null)")), "filtro 'com não lidas' (Todas) confere");
  const inboxCount = async (filter: object) => {
    let cursor: string | undefined;
    let n = 0;
    do {
      const page = await useCases.listInbox(pmo, { cursor, limit: 9, ...filter });
      n += page.data.length;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return n;
  };
  const unreadInDb = Number((await q(`select count(*)::int as n from notification_deliveries where user_id = 'iso-pmo' and read_at is null`))[0].n);
  ok((await inboxCount({ read: false })) === unreadInDb && (await inboxCount({ read: true })) === 64 - unreadInDb, "filtros lida/não lida da caixa de entrada conferem");
  ok((await useCases.listInbox(pmo, { limit: 1 })).unread === unreadInDb, `contador de não lidas exato (${unreadInDb})`);

  // ---- 4. Ler não resolve; resolvidas continuam no histórico ----
  const target = (await useCases.listInbox(pmo, { read: false, resolved: false, limit: 1 })).data[0];
  await useCases.markRead(pmo, target.deliveryId);
  const afterRead = (await q(`select resolved_at from executive_followup_notifications where id = '${target.notification.id}'`))[0].resolved_at;
  ok(afterRead === null, "marcar como lida não resolve a pendência");
  ok((await useCases.listInbox(pmo, { limit: 1 })).unread === unreadInDb - 1, "e o contador diminui em 1");
  ok((await dbCount("resolved_at is not null")) > 0 && (await count({ resolved: true })) === (await dbCount("resolved_at is not null")), "notificações resolvidas continuam listáveis (histórico preservado)");

  // ---- 5. Privacidade do cursor e permissões ----
  const pmoPage = await useCases.listInbox(pmo, { limit: 5 });
  const otherPage = await useCases.listInbox(other, { cursor: pmoPage.nextCursor ?? undefined, limit: 50 });
  ok(otherPage.data.length === 0 && otherPage.unread === 0, "o cursor de outra pessoa não revela entregas alheias");
  const forbidden = await useCases.listNotifications(colab, { limit: 5 }).then(() => "permitido", (error: { statusCode?: number }) => error.statusCode);
  ok(forbidden === 403, "COLABORADOR não lista 'Todas' (403)");
  const bad = await useCases.listNotifications(pmo, { cursor: "lixo", limit: 5 }).then(() => "aceito", (error: { statusCode?: number; code?: string }) => `${error.statusCode}/${error.code}`);
  ok(bad === "400/NOTIFICATIONS_INVALID_CURSOR", "cursor inválido: 400");

  // ---- 6. Detalhe ----
  const detail = await useCases.getNotification(pmo, same[0]);
  ok(detail.title === `Título ${same[0]}` && detail.body === `Corpo ${same[0]}` && detail.deliveries.length === 1 && detail.deliveries[0].userId === "iso-pmo", "detalhe: conteúdo congelado e destinatário");
  const noDetail = await useCases.getNotification(colab, same[0]).then(() => "permitido", (error: { statusCode?: number }) => error.statusCode);
  const missing = await useCases.getNotification(pmo, "nao-existe").then(() => "achou", (error: { statusCode?: number }) => error.statusCode);
  ok(noDetail === 403 && missing === 404, "detalhe: COLABORADOR 403; inexistente 404");

  console.log(log.join("\n"));
  console.log(`\nTOTAL: ${log.filter((l) => l.startsWith("OK")).length} OK, ${log.filter((l) => l.startsWith("FALHA")).length} FALHA`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.log(log.join("\n"));
    console.error("ERRO NO ENSAIO:", error instanceof Error ? error.stack : error);
    process.exit(1);
  });

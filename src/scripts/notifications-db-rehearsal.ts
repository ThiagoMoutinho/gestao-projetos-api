import "dotenv/config";

import { sql } from "drizzle-orm";

import { db } from "../db";
import { runNotificationGenerator } from "../modules/notifications/notification-generator";
import { makeNotificationDeps } from "../modules/notifications/notifications.routes";
import { makeNotificationUseCases } from "../modules/notifications/notifications.use-cases";
import { makeUserAdminUseCases } from "../modules/user-admin/user-admin.use-cases";
import { DrizzleUserAdminRepository } from "../modules/user-admin/user-admin.repository";

/**
 * Ensaio das migrations 0028/0029 e do módulo de notificações em BANCO ISOLADO (nunca no desenvolvimento).
 * Recusa-se a rodar se o banco não for um banco de ensaio (nome iniciado por "gp_iso").
 *
 *   DATABASE_URL=postgresql://.../gp_iso_33 pnpm tsx src/scripts/notifications-db-rehearsal.ts
 */
if (!/\/gp_iso[^/]*$/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Recusado: este ensaio só roda em banco isolado (nome iniciado por gp_iso).");
  process.exit(2);
}

const log: string[] = [];
const ok = (condition: boolean, message: string) => log.push(`${condition ? "OK    " : "FALHA "}${message}`);
const q = async (query: string) => ((await db.execute(sql.raw(query))).rows as Array<Record<string, unknown>>);
const count = async (table: string, where = "true") => Number((await q(`select count(*)::int as n from ${table} where ${where}`))[0].n);
/** Executa e devolve a mensagem do erro (ou null se não falhou). */
async function failure(query: string) {
  try {
    await db.execute(sql.raw(query));
    return null;
  } catch (error) {
    const e = error as { message?: string; cause?: { message?: string } };
    return `${e.message ?? ""} ${e.cause?.message ?? ""}`;
  }
}
async function failureOf(fn: () => Promise<unknown>) {
  try {
    await fn();
    return null;
  } catch (error) {
    const e = error as { message?: string; cause?: { message?: string }; code?: string };
    return `${e.message ?? ""} ${e.cause?.message ?? ""} ${e.code ?? ""}`;
  }
}

const at = (value: string) => new Date(value);
const deps = makeNotificationDeps(db);
const useCases = makeNotificationUseCases(deps);
const userAdmin = makeUserAdminUseCases(new DrizzleUserAdminRepository(db));
const admin = { id: "iso-admin", name: "Admin", email: "iso-admin@x.test", role: "ADMIN" as const };
const pmo = { id: "iso-pmo", name: "PMO", email: "iso-pmo@x.test", role: "PMO" as const };

async function main() {
  // ---- Dados de ensaio (sintéticos, só neste banco) ----
  for (const [id, role] of [["iso-admin", "ADMIN"], ["iso-admin2", "ADMIN"], ["iso-pmo", "PMO"], ["iso-pmo2", "PMO"], ["iso-coord", "COORDENADOR"], ["iso-forn", "FORNECEDOR"]] as const) {
    await q(`insert into "user" (id, name, email, role) values ('${id}', '${id}', '${id}@x.test', '${role}')`);
  }
  await q(`insert into projects (id, name, owner_id, status) values ('iso-p1', 'Projeto de ensaio', 'iso-admin', 'EM_EXECUCAO')`);
  await q(`insert into eap_audit_logs (id, project_id, entity_type, entity_id, action, summary, payload, actor_id, created_at)
           values ('iso-ev1', 'iso-p1', 'PROJECT', 'iso-p1', 'STATUS_CHANGE', 'início', '{"automatic": false, "from": "NAO_INICIADO", "to": "EM_EXECUCAO"}', 'iso-admin', '2026-09-01 13:00:00')`);
  await q(`insert into business_calendar_years (year, status, national_checked, state_checked, municipal_checked, validated_by, validated_at, source_note)
           values (2026, 'VALIDATED', true, true, true, 'iso-admin', now(), 'ensaio')`);

  // ---- 1. Migrações e dados existentes ----
  ok((await count("drizzle.__drizzle_migrations")) >= 30, "migrations 0028 e 0029 aplicadas (30 ou mais no total)");
  ok((await count(`"user"`, "is_active")) === (await count(`"user"`)), "todos os usuários (existentes e de ensaio) ativos por padrão");
  ok((await count("notification_settings", "id = 'GLOBAL' and not activation_enabled")) === 1, "configuração única criada desligada");

  // ---- 2. Antes da ativação: o banco impede qualquer geração real ----
  const direct = (kind: string) =>
    `insert into executive_followup_notifications (id, project_id, kind, cycle_start, due_date, scheduled_for, dedupe_key, title, body, followup_snapshot, run_id)
     values ('n-direct', 'iso-p1', '${kind}', '2026-11-05', '2026-11-11', '2026-12-01 12:00:00', 'direct-1', 't', 'b', '{}', 'run-x')`;
  const disabled = await failure(direct("OVERDUE"));
  ok(/desativadas/.test(disabled ?? ""), "INSERT direto de notificação com a ativação desligada é recusado pelo banco");
  ok(/desativadas/.test((await failure(`insert into notification_issues (id, kind, dedupe_key, details) values ('i-direct', 'NO_RECIPIENT', 'k', '{}')`)) ?? ""), "INSERT direto de ocorrência recusado");
  ok(/desativadas|violates|run_id/.test((await failure(`insert into notification_deliveries (id, notification_id, user_id, recipient_name, recipient_email, recipient_role, visibility) values ('d-direct', 'n-x', 'iso-pmo', 'a', 'b', 'PMO', 'TO')`)) ?? ""), "INSERT direto de entrega recusado");
  const refused = await failureOf(() => runNotificationGenerator(deps, { mode: "ACTIVE", origin: "CLI", actorId: null, now: at("2026-11-26T10:00:00-03:00") }));
  ok(/desativadas/.test(refused ?? ""), "geração real com a ativação desligada é recusada");
  const dryRunsBefore = await count("notification_runs", "mode = 'DRY_RUN'");
  const dry = await runNotificationGenerator(deps, { mode: "DRY_RUN", origin: "CLI", actorId: null, now: at("2026-11-26T10:00:00-03:00"), simulatedCutoff: "2026-11-05" });
  ok(dry.status === "COMPLETED", "simulação concluída");
  ok((await count("executive_followup_notifications")) === 0 && (await count("notification_deliveries")) === 0 && (await count("notification_issues")) === 0, "simulação não criou avisos, entregas nem ocorrências");
  ok((await count("notification_runs", "mode = 'DRY_RUN'")) === dryRunsBefore + 1, "simulação gravou apenas o histórico técnico da execução (1 linha)");

  // ---- 3. Regras, ativação e auditoria ----
  const rule = (input: Parameters<typeof useCases.createRule>[1]) => useCases.createRule(admin, input);
  ok((await failureOf(() => useCases.activate(admin, { cutoff: "2026-11-05", justification: "Sem regras ainda.", confirm: "ATIVAR" }, at("2026-11-01T10:00:00-03:00")))) !== null, "ativação recusada sem destinatários");
  ok(/COORDENADOR|violates|check/i.test((await failure(`insert into notification_recipient_rules (id, kind, source, role, visibility, created_by) values ('r-bad', 'ESCALATION', 'ROLE', 'COORDENADOR', 'TO', 'iso-admin')`)) ?? ""), "perfil global COORDENADOR proibido por constraint");
  await rule({ kind: "PREVENTIVE", source: "ROLE", role: "PMO", visibility: "TO", justification: "Aviso ao PMO." });
  await rule({ kind: "OVERDUE", source: "ROLE", role: "PMO", visibility: "TO", justification: "Atraso ao PMO." });
  await rule({ kind: "ESCALATION", source: "USER", userId: "iso-coord", visibility: "TO", justification: "Coordenador da CTIN." });
  await rule({ kind: "ESCALATION", source: "ROLE", role: "PMO", visibility: "CC", justification: "Cópia ao PMO." });
  ok((await count("notification_settings_changes", "action = 'RULE_CREATE'")) === 4, "4 regras cadastradas com histórico");
  const activated = await useCases.activate(admin, { cutoff: "2026-11-05", justification: "Início oficial (ensaio).", confirm: "ATIVAR" }, at("2026-11-01T10:00:00-03:00"));
  ok(activated.activationEnabled && activated.activationCutoff === "2026-11-05", "ativada com corte na quinta 05/11");
  ok(/thursday|check/i.test((await failure(`update notification_settings set activation_cutoff = '2026-11-06' where id = 'GLOBAL'`)) ?? ""), "corte fora de quinta-feira recusado pelo banco");
  // Para os ensaios abaixo o relógio de ativação precisa preceder os avisos simulados no tempo.
  await q(`set session_replication_role = default`);

  // ---- 4. Geração real (relógio avançado), idempotência e conteúdo ----
  const NOW = at("2026-11-26T10:00:00-03:00");
  const first = await runNotificationGenerator(deps, { mode: "ACTIVE", origin: "CLI", actorId: null, now: NOW });
  ok(first.status === "COMPLETED" && (await count("executive_followup_notifications", "project_id = 'iso-p1'")) === 2, `1ª execução real: ${first.summary?.created} avisos no total (cópia do banco inclui outros projetos); no projeto de ensaio: atraso + escalonamento`);
  const kinds = (await q(`select dedupe_key as k from executive_followup_notifications where project_id = 'iso-p1' order by kind`)).map((row) => row.k);
  ok(JSON.stringify(kinds) === JSON.stringify(["ESCALATION:iso-p1:2026-11-05", "OVERDUE:iso-p1:2026-11-19"]), `chaves de duplicidade: ${kinds.join(" | ")}`);
  const recipients = (await q(`select n.kind, d.user_id, d.visibility from notification_deliveries d join executive_followup_notifications n on n.id = d.notification_id where n.project_id = 'iso-p1' and d.user_id like 'iso-%' order by 1, 2`)).map((r) => `${r.kind}/${r.user_id}/${r.visibility}`);
  ok(JSON.stringify(recipients) === JSON.stringify(["ESCALATION/iso-coord/TO", "ESCALATION/iso-pmo/CC", "ESCALATION/iso-pmo2/CC", "OVERDUE/iso-pmo/TO", "OVERDUE/iso-pmo2/TO"]), `destinatários do projeto de ensaio: ${recipients.join(", ")}`);
  const everyone = await count("notification_deliveries", "user_id not like 'iso-%'");
  ok(everyone > 0 && (await count("notification_deliveries d join \"user\" u on u.id = d.user_id", "u.role not in ('PMO', 'COORDENADOR')")) === 0, "só PMO (e o coordenador configurado) recebem: nenhum ADMIN, gestor ou fornecedor recebeu aviso");
  const totalBefore = await count("executive_followup_notifications");
  const deliveriesBefore = await count("notification_deliveries");
  const second = await runNotificationGenerator(deps, { mode: "ACTIVE", origin: "CLI", actorId: null, now: NOW });
  ok(second.summary?.created === 0 && second.summary?.duplicates === totalBefore && (await count("executive_followup_notifications")) === totalBefore && (await count("notification_deliveries")) === deliveriesBefore, `2ª execução: idempotente (0 criados, ${second.summary?.duplicates} duplicados evitados)`);

  // ---- 5. Concorrência real (conexões distintas) ----
  const key = "ESCALATION:iso-p1:CONCORRENCIA";
  const racers = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      deps.notifications.createNotification(
        {
          id: `race-${index}`,
          projectId: "iso-p1",
          kind: "ESCALATION",
          cycleStart: "2026-11-05",
          sequenceStart: "2026-11-05",
          dueDate: "2026-11-21",
          scheduledFor: at("2026-11-23T12:00:00Z"),
          dedupeKey: key,
          title: "t",
          body: "b",
          followupSnapshot: {},
          runId: first.runId!,
        },
        [{ id: `race-d-${index}`, userId: "iso-pmo", recipientName: "PMO", recipientEmail: "iso-pmo@x.test", recipientRole: "PMO", visibility: "TO" }],
      ),
    ),
  );
  ok(racers.filter(Boolean).length === 1 && (await count("executive_followup_notifications", `dedupe_key = '${key}'`)) === 1, "20 inserções simultâneas da mesma chave: exatamente 1 aviso");
  ok((await count("notification_deliveries", `notification_id like 'race-%'`)) === 1, "e exatamente 1 entrega (sem duplicar destinatário)");
  const runs = await Promise.all(Array.from({ length: 6 }, () => runNotificationGenerator(deps, { mode: "ACTIVE", origin: "CLI", actorId: null, now: NOW })));
  ok(runs.every((run) => run.status === "COMPLETED" || run.status === "SKIPPED_LOCKED"), `6 execuções simultâneas: ${runs.filter((r) => r.status === "COMPLETED").length} concluída(s), ${runs.filter((r) => r.status === "SKIPPED_LOCKED").length} em espera pela trava`);
  ok((await count("executive_followup_notifications", `dedupe_key not like '%CONCORRENCIA'`)) === totalBefore, "execuções simultâneas não geraram avisos extras");

  // ---- 6. Imutabilidade e sem retroativo ----
  const noUpdate = await failure(`update executive_followup_notifications set title = 'alterado' where dedupe_key = 'OVERDUE:iso-p1:2026-11-19'`);
  ok(/imutáveis/.test(noUpdate ?? ""), "conteúdo da notificação não pode ser alterado");
  ok(/imutáveis/.test((await failure(`delete from executive_followup_notifications where dedupe_key = 'OVERDUE:iso-p1:2026-11-19'`)) ?? ""), "notificação não pode ser excluída");
  ok(/imutáveis/.test((await failure(`truncate executive_followup_notifications cascade`)) ?? ""), "TRUNCATE de notificações bloqueado");
  ok(/imutáveis/.test((await failure(`delete from notification_deliveries where notification_id like 'race-%'`)) ?? ""), "entrega não pode ser excluída");
  ok(/imutáveis/.test((await failure(`update notification_deliveries set recipient_name = 'x' where notification_id like 'race-%'`)) ?? ""), "dados da entrega não podem ser alterados");
  ok(/histórico|Registro/.test((await failure(`delete from notification_settings_changes`)) ?? ""), "histórico de configuração não pode ser excluído");
  ok(/histórico|Registro/.test((await failure(`delete from notification_recipient_rules`)) ?? ""), "regras não podem ser excluídas");
  ok(/histórico|Registro/.test((await failure(`delete from notification_settings`)) ?? ""), "configuração não pode ser excluída");
  ok(/restrict|violates|foreign/i.test((await failure(`delete from projects where id = 'iso-p1'`)) ?? ""), "projeto com notificações não pode ser excluído (RESTRICT)");
  ok(/restrict|violates|foreign/i.test((await failure(`delete from "user" where id = 'iso-coord'`)) ?? ""), "usuário com regra/entrega não pode ser excluído (RESTRICT)");
  ok(/Retroativa|retroativa/.test((await failure(`insert into executive_followup_notifications (id, project_id, kind, cycle_start, due_date, scheduled_for, dedupe_key, title, body, followup_snapshot, run_id)
     values ('n-retro1', 'iso-p1', 'OVERDUE', '2026-11-05', '2026-11-11', '2026-10-01 12:00:00', 'retro-1', 't', 'b', '{}', '${first.runId!}')`)) ?? ""), "aviso agendado antes da ativação recusado");
  ok(/Retroativa|retroativa/.test((await failure(`insert into executive_followup_notifications (id, project_id, kind, cycle_start, due_date, scheduled_for, dedupe_key, title, body, followup_snapshot, run_id)
     values ('n-retro2', 'iso-p1', 'OVERDUE', '2026-10-29', '2026-11-04', '2026-12-30 12:00:00', 'retro-2', 't', 'b', '{}', '${first.runId!}')`)) ?? ""), "aviso de ciclo anterior ao corte recusado");

  // ---- 7. Leitura e resolução separadas ----
  const inbox = await useCases.listInbox(pmo, { unread: true, limit: 50 });
  ok(inbox.data.length >= 2, `caixa do PMO: ${inbox.data.length} avisos (inclui o de concorrência)`);
  await useCases.markRead(pmo, inbox.data[0].deliveryId, NOW);
  await useCases.markRead(pmo, inbox.data[0].deliveryId, at("2026-11-27T10:00:00-03:00"));
  ok((await count("notification_deliveries", "read_at is not null")) === 1, "leitura registrada uma única vez (idempotente)");
  ok(/imutáveis/.test((await failure(`update notification_deliveries set read_at = now() where read_at is not null`)) ?? ""), "leitura não pode ser reescrita");
  ok((await count("executive_followup_notifications", "resolved_at is not null")) === 0, "ler não resolve a pendência");

  const before = await q(`select id, title, body, dedupe_key, followup_snapshot::text as snap from executive_followup_notifications order by id`);
  const totalAll = await count("executive_followup_notifications");
  await q(`insert into project_executive_summary_validations (id, project_id, cycle_start, cycle_end, kind, snapshot, fingerprint, validated_by)
           values ('iso-val1', 'iso-p1', '2026-11-26', '2026-12-02', 'REGULAR', '{}', 'fp', 'iso-pmo')`);
  const resolution = await runNotificationGenerator(deps, { mode: "ACTIVE", origin: "CLI", actorId: null, now: at("2026-11-27T10:00:00-03:00") });
  const resolved = await q(`select resolution_reason, resolved_validation_id from executive_followup_notifications where project_id = 'iso-p1' and dedupe_key not like '%CONCORRENCIA' order by id`);
  ok(resolved.length === 2 && resolved.every((row) => row.resolution_reason === "VALIDATED" && row.resolved_validation_id === "iso-val1"), "validação regular resolveu as duas pendências do projeto (com a referência da validação)");
  ok((await count("executive_followup_notifications", "project_id <> 'iso-p1' and resolved_at is not null")) === 0, "projetos sem validação continuam com a pendência em aberto");
  const after = await q(`select id, title, body, dedupe_key, followup_snapshot::text as snap from executive_followup_notifications order by id`);
  ok(JSON.stringify(before) === JSON.stringify(after), "conteúdo original das notificações preservado após a resolução");
  ok((await count("executive_followup_notifications")) === totalAll, "nenhuma notificação foi excluída");
  ok(/imutáveis/.test((await failure(`update executive_followup_notifications set resolution_reason = 'CYCLE_EXPIRED' where project_id = 'iso-p1' and dedupe_key like 'OVERDUE%'`)) ?? ""), "a resolução não pode ser reescrita");
  ok((await count("project_executive_summary_validations", "project_id = 'iso-p1'")) === 1, "histórico de validações (ciclos) intocado: só a validação regular inserida pelo ensaio");

  // ---- 8. Calendário não validado: bloqueia só o dependente e registra a ocorrência ----
  await q(`update business_calendar_years set status = 'DRAFT', validated_by = null, validated_at = null, national_checked = false, state_checked = false, municipal_checked = false where year = 2026`);
  const calendarRun = await runNotificationGenerator(deps, { mode: "ACTIVE", origin: "CLI", actorId: null, now: at("2026-12-10T10:00:00-03:00") });
  ok(calendarRun.summary!.created === 0 && calendarRun.summary!.blockedCalendar >= 1, "calendário não validado: nenhum aviso criado");
  ok((await count("notification_issues", "kind = 'CALENDAR_NOT_VALIDATED' and year = 2026 and resolved_at is null")) === 1, "ocorrência administrativa registrada para o ADMIN");
  await runNotificationGenerator(deps, { mode: "ACTIVE", origin: "CLI", actorId: null, now: at("2026-12-10T10:30:00-03:00") });
  ok((await count("notification_issues", "kind = 'CALENDAR_NOT_VALIDATED'")) === 1, "repetir a execução não duplica a ocorrência");
  await q(`update business_calendar_years set status = 'VALIDATED', validated_by = 'iso-admin', validated_at = now(), national_checked = true, state_checked = true, municipal_checked = true where year = 2026`);
  await runNotificationGenerator(deps, { mode: "ACTIVE", origin: "CLI", actorId: null, now: at("2026-12-10T11:00:00-03:00") });
  ok((await count("notification_issues", "kind = 'CALENDAR_NOT_VALIDATED' and resolution = 'AUTO'")) === 1, "ao validar o ano a ocorrência se resolve sozinha");

  // ---- 9. Destinatários inativos ----
  await userAdmin.deactivate(admin, "iso-pmo", "Ensaio: PMO inativo.");
  await userAdmin.deactivate(admin, "iso-pmo2", "Ensaio: segundo PMO inativo.");
  // A cópia do banco tem outros PMO: desativa todos (só neste banco isolado) para provar o caso "sem destinatário ativo".
  await q(`update "user" set is_active = false, deactivated_at = now() where role = 'PMO'`);
  await runNotificationGenerator(deps, { mode: "ACTIVE", origin: "CLI", actorId: null, now: at("2026-12-10T12:00:00-03:00") });
  const noRecipient = await q(`select dedupe_key from notification_issues where resolved_at is null order by 1`);
  ok(noRecipient.some((row) => row.dedupe_key === "NO_RECIPIENT:OVERDUE") && noRecipient.some((row) => row.dedupe_key === "NO_RECIPIENT:PREVENTIVE"), `sem PMO ativo: ocorrências ${noRecipient.map((r) => r.dedupe_key).join(", ")}`);
  ok((await count("notification_deliveries", "user_id in ('iso-pmo','iso-pmo2') and delivered_at > '2026-11-28'")) === 0, "inativos não recebem novas notificações");
  ok((await count("notification_deliveries", "user_id = 'iso-pmo'")) >= 2, "notificações já recebidas por usuário inativo permanecem no histórico");
  ok(/próprio usuário/.test((await failureOf(() => userAdmin.deactivate(admin, "iso-admin", "Autodesativação."))) ?? ""), "não desativa a si mesmo");
  await q(`update "user" set is_active = false, deactivated_at = now() where role = 'ADMIN' and id not in ('iso-admin', 'iso-admin2')`);
  await userAdmin.deactivate({ ...admin, id: "iso-admin2" }, "iso-admin", "Ensaio: passagem de função.");
  ok(/último ADMIN/i.test((await failureOf(() => userAdmin.deactivate(admin, "iso-admin2", "Último."))) ?? ""), "não desativa o último ADMIN ativo");
  ok(/imutável/.test((await failure(`update user_activation_changes set reason = 'x'`)) ?? ""), "histórico de ativação de usuários imutável");
  await userAdmin.activate({ ...admin, id: "iso-admin2" }, "iso-admin", "Ensaio: retorno.");
  await userAdmin.activate({ ...admin, id: "iso-admin2" }, "iso-pmo", "Ensaio: retorno.");

  // ---- 10. Desativação volta a bloquear tudo ----
  await useCases.deactivate(admin, { justification: "Fim do ensaio." });
  const lastRun = await failureOf(() => runNotificationGenerator(deps, { mode: "ACTIVE", origin: "CLI", actorId: null, now: at("2026-12-20T10:00:00-03:00") }));
  ok(/desativadas/.test(lastRun ?? ""), "depois de desativar, a geração real volta a ser recusada");
  ok(/desativadas/.test((await failure(direct("OVERDUE").replace("direct-1", "direct-2"))) ?? ""), "e o banco volta a recusar INSERT direto");
  ok((await count("notification_settings_changes", "action in ('ACTIVATE','DEACTIVATE')")) === 2, "ativação e desativação auditadas com justificativa");

  console.log(log.join("\n"));
  console.log(`\nTOTAL: ${log.filter((l) => l.startsWith("OK")).length} OK, ${log.filter((l) => l.startsWith("FALHA")).length} FALHA`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.log(log.join("\n"));
    console.error("ERRO NO ENSAIO:", error instanceof Error ? error.message : error);
    process.exit(1);
  });

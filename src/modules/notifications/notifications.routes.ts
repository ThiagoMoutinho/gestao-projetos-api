import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

import type { Database } from "../../db/types";
import { getAuthUser, requireAuth } from "../../lib/session";
import { DrizzleCalendarRepository } from "../business-calendar/business-calendar.repository";
import { loadBusinessCalendar, validatedYears } from "../business-calendar/business-calendar.use-cases";
import { makeEapRepos } from "../eap/factories/make-eap-controller";
import {
  activateBodySchema,
  changeListSchema,
  deactivateBodySchema,
  deliveryParamsSchema,
  deliveryReadSchema,
  dryRunBodySchema,
  inboxQuerySchema,
  inboxSchema,
  issueListQuerySchema,
  issueListSchema,
  issueParamsSchema,
  issueSchema,
  notificationErrorResponses,
  notificationDetailSchema,
  notificationListQuerySchema,
  notificationListSchema,
  notificationParamsSchema,
  resolveIssueBodySchema,
  ruleListSchema,
  ruleParamsSchema,
  ruleSchema,
  runListSchema,
  runSchema,
  schedulerHealthSchema,
  settingsSchema,
  createRuleBodySchema,
  updateRuleBodySchema,
} from "./notifications.schema";
import { DrizzleNotificationRepository } from "./notifications.repository";
import { DrizzleSchedulerRepository } from "./scheduler.repository";
import { makeNotificationUseCases, type NotificationUseCases } from "./notifications.use-cases";

const tags = ["Notificações do acompanhamento"];
const security = [{ cookieAuth: [] }];

/** Dependências reais do gerador (também usadas pelo script de linha de comando). */
export function makeNotificationDeps(database: Database) {
  const calendar = new DrizzleCalendarRepository(database);
  return {
    notifications: new DrizzleNotificationRepository(database),
    scheduler: new DrizzleSchedulerRepository(database),
    eap: makeEapRepos(database),
    loadCalendar: (from: string, to: string) => loadBusinessCalendar(calendar, from, to),
    validatedCalendarYears: () => validatedYears(calendar),
  };
}

export function makeNotificationsModule(database: Database) {
  return makeNotificationUseCases(makeNotificationDeps(database));
}

/**
 * Notificações internas do acompanhamento semanal. ADMIN gerencia (ativação, regras, ocorrências); PMO consulta; cada
 * usuário lê só a própria caixa de entrada. A autorização é conferida nos casos de uso.
 */
export function makeNotificationsRoutes(useCases: NotificationUseCases): FastifyPluginAsyncZod {
  return async (app) => {
    app.addHook("preHandler", requireAuth);

    app.get(
      "/notifications/inbox",
      {
        schema: {
          operationId: "listMyNotifications",
          tags,
          summary: "Minha caixa de entrada de notificações",
          security,
          querystring: inboxQuerySchema,
          response: { 200: inboxSchema, ...notificationErrorResponses },
        },
      },
      (request) =>
        useCases.listInbox(getAuthUser(request), {
          read: request.query.read === undefined ? undefined : request.query.read === "true",
          unread: request.query.unread === undefined ? undefined : request.query.unread === "true",
          kind: request.query.kind,
          projectId: request.query.projectId,
          resolved: request.query.resolved === undefined ? undefined : request.query.resolved === "true",
          cursor: request.query.cursor,
          limit: request.query.limit,
        }),
    );

    app.post(
      "/notifications/deliveries/:id/read",
      {
        schema: {
          operationId: "markNotificationRead",
          tags,
          summary: "Marcar minha notificação como lida (a resolução da pendência é registrada à parte)",
          security,
          params: deliveryParamsSchema,
          response: { 200: deliveryReadSchema, ...notificationErrorResponses },
        },
      },
      (request) => useCases.markRead(getAuthUser(request), request.params.id),
    );

    app.get(
      "/notifications",
      {
        schema: {
          operationId: "listNotifications",
          tags,
          summary: "Notificações de todos os projetos (ADMIN e PMO)",
          security,
          querystring: notificationListQuerySchema,
          response: { 200: notificationListSchema, ...notificationErrorResponses },
        },
      },
      (request) =>
        useCases.listNotifications(getAuthUser(request), {
          kind: request.query.kind,
          projectId: request.query.projectId,
          resolved: request.query.resolved === undefined ? undefined : request.query.resolved === "true",
          unread: request.query.unread === undefined ? undefined : request.query.unread === "true",
          cursor: request.query.cursor,
          limit: request.query.limit,
        }),
    );

    app.get(
      "/notifications/:id",
      {
        schema: {
          operationId: "getNotification",
          tags,
          summary: "Detalhe de uma notificação com cada destinatário e a leitura dele (ADMIN e PMO)",
          security,
          params: notificationParamsSchema,
          response: { 200: notificationDetailSchema, ...notificationErrorResponses },
        },
      },
      (request) => useCases.getNotification(getAuthUser(request), request.params.id),
    );

    app.get(
      "/notifications/settings",
      {
        schema: {
          operationId: "getNotificationSettings",
          tags,
          summary: "Situação da ativação das notificações (ADMIN e PMO)",
          security,
          response: { 200: settingsSchema, ...notificationErrorResponses },
        },
      },
      (request) => useCases.getSettings(getAuthUser(request)),
    );

    app.get(
      "/notifications/settings/changes",
      {
        schema: {
          operationId: "listNotificationSettingsChanges",
          tags,
          summary: "Histórico de ativação, desativação e regras (ADMIN)",
          security,
          response: { 200: changeListSchema, ...notificationErrorResponses },
        },
      },
      (request) => useCases.listSettingsChanges(getAuthUser(request)),
    );

    app.post(
      "/notifications/settings/activation",
      {
        schema: {
          operationId: "activateNotifications",
          tags,
          summary: "Ativar as notificações com corte numa quinta-feira (ADMIN, com justificativa e confirmação)",
          security,
          body: activateBodySchema,
          response: { 200: settingsSchema, ...notificationErrorResponses },
        },
      },
      (request) => useCases.activate(getAuthUser(request), request.body),
    );

    app.post(
      "/notifications/settings/deactivation",
      {
        schema: {
          operationId: "deactivateNotifications",
          tags,
          summary: "Desativar as notificações (ADMIN, com justificativa)",
          security,
          body: deactivateBodySchema,
          response: { 200: settingsSchema, ...notificationErrorResponses },
        },
      },
      (request) => useCases.deactivate(getAuthUser(request), request.body),
    );

    app.get(
      "/notifications/rules",
      {
        schema: {
          operationId: "listNotificationRules",
          tags,
          summary: "Regras de destinatários (ADMIN e PMO)",
          security,
          response: { 200: ruleListSchema, ...notificationErrorResponses },
        },
      },
      (request) => useCases.listRules(getAuthUser(request)),
    );

    app.post(
      "/notifications/rules",
      {
        schema: {
          operationId: "createNotificationRule",
          tags,
          summary: "Cadastrar regra de destinatário (ADMIN)",
          security,
          body: createRuleBodySchema,
          response: { 201: ruleSchema, ...notificationErrorResponses },
        },
      },
      async (request, reply) => reply.status(201).send(await useCases.createRule(getAuthUser(request), request.body)),
    );

    app.patch(
      "/notifications/rules/:id",
      {
        schema: {
          operationId: "updateNotificationRule",
          tags,
          summary: "Ativar, desativar ou mudar a visibilidade de uma regra (ADMIN)",
          security,
          params: ruleParamsSchema,
          body: updateRuleBodySchema,
          response: { 200: ruleSchema, ...notificationErrorResponses },
        },
      },
      (request) => useCases.updateRule(getAuthUser(request), request.params.id, request.body),
    );

    app.get(
      "/notifications/issues",
      {
        schema: {
          operationId: "listNotificationIssues",
          tags,
          summary: "Ocorrências administrativas (ADMIN e PMO)",
          security,
          querystring: issueListQuerySchema,
          response: { 200: issueListSchema, ...notificationErrorResponses },
        },
      },
      (request) =>
        useCases.listIssues(getAuthUser(request), {
          open: request.query.open === undefined ? undefined : request.query.open === "true",
          limit: request.query.limit,
        }),
    );

    app.post(
      "/notifications/issues/:id/resolution",
      {
        schema: {
          operationId: "resolveNotificationIssue",
          tags,
          summary: "Resolver manualmente uma ocorrência administrativa (ADMIN, com nota)",
          security,
          params: issueParamsSchema,
          body: resolveIssueBodySchema,
          response: { 200: issueSchema, ...notificationErrorResponses },
        },
      },
      (request) => useCases.resolveIssue(getAuthUser(request), request.params.id, request.body.note),
    );

    app.get(
      "/notifications/scheduler",
      {
        schema: {
          operationId: "getNotificationSchedulerHealth",
          tags,
          summary: "Saúde do agendador: estado técnico e estado operacional separados (ADMIN e PMO)",
          security,
          response: { 200: schedulerHealthSchema, ...notificationErrorResponses },
        },
      },
      (request) => useCases.getSchedulerHealth(getAuthUser(request)),
    );

    app.get(
      "/notifications/runs",
      {
        schema: {
          operationId: "listNotificationRuns",
          tags,
          summary: "Execuções do gerador (ADMIN e PMO)",
          security,
          response: { 200: runListSchema, ...notificationErrorResponses },
        },
      },
      (request) => useCases.listRuns(getAuthUser(request)),
    );

    app.post(
      "/notifications/runs/dry-run",
      {
        schema: {
          operationId: "dryRunNotifications",
          tags,
          summary: "Simular a geração (ADMIN): não cria avisos, entregas nem ocorrências",
          security,
          body: dryRunBodySchema,
          response: { 200: runSchema, ...notificationErrorResponses },
        },
      },
      (request) => useCases.dryRun(getAuthUser(request), request.body),
    );
  };
}

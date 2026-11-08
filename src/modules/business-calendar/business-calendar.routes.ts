import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import type { Database } from "../../db/types";
import { getAuthUser, requireAuth } from "../../lib/session";
import { DrizzleCalendarRepository } from "./business-calendar.repository";
import {
  calendarChangeListSchema,
  calendarDayParamsSchema,
  calendarDaySchema,
  calendarErrorResponses,
  calendarYearDetailSchema,
  calendarYearListSchema,
  calendarYearParamsSchema,
  calendarYearSchema,
  createCalendarDayBodySchema,
  nationalSuggestionsSchema,
  readinessQuerySchema,
  readinessSchema,
  updateCalendarDayBodySchema,
  validateCalendarYearBodySchema,
} from "./business-calendar.schema";
import { makeBusinessCalendarUseCases, type BusinessCalendarUseCases } from "./business-calendar.use-cases";

const tags = ["Calendário institucional"];
const security = [{ cookieAuth: [] }];

export function makeBusinessCalendarModule(database: Database) {
  return makeBusinessCalendarUseCases(new DrizzleCalendarRepository(database));
}

/**
 * Calendário institucional de dias úteis. O ADMIN cadastra, altera e valida; o PMO apenas consulta. Todas as rotas
 * exigem sessão e a autorização é conferida nos casos de uso.
 */
export function makeBusinessCalendarRoutes(useCases: BusinessCalendarUseCases): FastifyPluginAsyncZod {
  return async (app) => {
    app.addHook("preHandler", requireAuth);

    app.get(
      "/business-calendar/years",
      {
        schema: {
          operationId: "listBusinessCalendarYears",
          tags,
          summary: "Anos do calendário institucional e a situação de validação",
          security,
          response: { 200: calendarYearListSchema, ...calendarErrorResponses },
        },
      },
      (request) => useCases.listYears(getAuthUser(request)),
    );

    app.get(
      "/business-calendar/years/:year",
      {
        schema: {
          operationId: "getBusinessCalendarYear",
          tags,
          summary: "Dias cadastrados e situação de validação de um ano",
          security,
          params: calendarYearParamsSchema,
          response: { 200: calendarYearDetailSchema, ...calendarErrorResponses },
        },
      },
      (request) => useCases.getYear(getAuthUser(request), request.params.year),
    );

    app.post(
      "/business-calendar/years/:year/days",
      {
        schema: {
          operationId: "createBusinessCalendarDay",
          tags,
          summary: "Cadastrar feriado, ponto facultativo, dia não útil ou exceção de expediente (ADMIN)",
          security,
          params: calendarYearParamsSchema,
          body: createCalendarDayBodySchema,
          response: { 201: calendarDaySchema, ...calendarErrorResponses },
        },
      },
      async (request, reply) => {
        const created = await useCases.createDay(getAuthUser(request), request.params.year, request.body);
        return reply.status(201).send(created);
      },
    );

    app.patch(
      "/business-calendar/days/:id",
      {
        schema: {
          operationId: "updateBusinessCalendarDay",
          tags,
          summary: "Alterar um dia do calendário (ADMIN); um ano validado volta a rascunho",
          security,
          params: calendarDayParamsSchema,
          body: updateCalendarDayBodySchema,
          response: { 200: calendarDaySchema, ...calendarErrorResponses },
        },
      },
      (request) => useCases.updateDay(getAuthUser(request), request.params.id, request.body),
    );

    app.delete(
      "/business-calendar/days/:id",
      {
        schema: {
          operationId: "deleteBusinessCalendarDay",
          tags,
          summary: "Excluir um dia do calendário (ADMIN); o histórico da alteração é preservado",
          security,
          params: calendarDayParamsSchema,
          response: { 204: z.null(), ...calendarErrorResponses },
        },
      },
      async (request, reply) => {
        await useCases.deleteDay(getAuthUser(request), request.params.id);
        return reply.status(204).send(null);
      },
    );

    app.get(
      "/business-calendar/years/:year/national-holidays",
      {
        schema: {
          operationId: "suggestBusinessCalendarNationalHolidays",
          tags,
          summary: "Feriados nacionais sugeridos para o ano (não grava nada)",
          security,
          params: calendarYearParamsSchema,
          response: { 200: nationalSuggestionsSchema, ...calendarErrorResponses },
        },
      },
      (request) => useCases.suggestNational(getAuthUser(request), request.params.year),
    );

    app.post(
      "/business-calendar/years/:year/national-holidays",
      {
        schema: {
          operationId: "applyBusinessCalendarNationalHolidays",
          tags,
          summary: "Cadastrar os feriados nacionais sugeridos que ainda faltam (ação explícita do ADMIN)",
          security,
          params: calendarYearParamsSchema,
          response: { 201: z.object({ data: z.array(calendarDaySchema) }), ...calendarErrorResponses },
        },
      },
      async (request, reply) => {
        const created = await useCases.applyNational(getAuthUser(request), request.params.year);
        return reply.status(201).send(created);
      },
    );

    app.post(
      "/business-calendar/years/:year/validation",
      {
        schema: {
          operationId: "validateBusinessCalendarYear",
          tags,
          summary: "Validar o calendário do ano (somente ADMIN)",
          description:
            "Exige a conferência declarada dos feriados nacionais, do Pará e de Belém, a fonte consultada e os feriados nacionais obrigatórios cadastrados.",
          security,
          params: calendarYearParamsSchema,
          body: validateCalendarYearBodySchema,
          response: { 200: calendarYearSchema, ...calendarErrorResponses },
        },
      },
      (request) => useCases.validateYear(getAuthUser(request), request.params.year, request.body),
    );

    app.get(
      "/business-calendar/years/:year/changes",
      {
        schema: {
          operationId: "listBusinessCalendarChanges",
          tags,
          summary: "Histórico de alterações do calendário do ano (ADMIN)",
          security,
          params: calendarYearParamsSchema,
          response: { 200: calendarChangeListSchema, ...calendarErrorResponses },
        },
      },
      (request) => useCases.listChanges(getAuthUser(request), request.params.year),
    );

    app.get(
      "/business-calendar/readiness",
      {
        schema: {
          operationId: "getBusinessCalendarReadiness",
          tags,
          summary: "Anos do intervalo cujo calendário ainda não está validado",
          security,
          querystring: readinessQuerySchema,
          response: { 200: readinessSchema, ...calendarErrorResponses },
        },
      },
      (request) => useCases.readiness(getAuthUser(request), request.query.from, request.query.to),
    );
  };
}

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../lib/http-error";
import type { AuthUser } from "../../lib/session";
import { InMemoryCalendarRepository } from "./business-calendar.in-memory";
import { createCalendarDayBodySchema, updateCalendarDayBodySchema, validateCalendarYearBodySchema } from "./business-calendar.schema";
import { loadBusinessCalendar, makeBusinessCalendarUseCases } from "./business-calendar.use-cases";
import { CalendarIncompleteError } from "./business-days";

const user = (role: AuthUser["role"], id: string): AuthUser => ({ id, name: id, email: `${id}@igepps.test`, role });
const admin = user("ADMIN", "admin-1");
const pmo = user("PMO", "pmo-1");
const others = [user("COORDENADOR", "coord-1"), user("GESTOR", "gestor-1"), user("FORNECEDOR", "forn-1"), user("COLABORADOR", "col-1")];

const rejects = (status: number, code?: string) => (error: unknown) =>
  error instanceof HttpError && error.statusCode === status && (code === undefined || error.code === code);

function setup() {
  const repository = new InMemoryCalendarRepository();
  repository.users.set("admin-1", "Admin");
  return { repository, calendar: makeBusinessCalendarUseCases(repository) };
}

const validation = { nationalChecked: true, stateChecked: true, municipalChecked: true, sourceNote: "Decreto estadual e portaria municipal conferidos." } as const;
const belemAnniversary = { day: "2026-01-12", scope: "MUNICIPAL_BELEM", kind: "FERIADO", description: "Aniversário de Belém", legalBasis: "Lei municipal (exemplo de teste)" } as const;

async function validatedYear(ctx: ReturnType<typeof setup>, year: number) {
  await ctx.calendar.applyNational(admin, year);
  return ctx.calendar.validateYear(admin, year, validation);
}

describe("Calendário institucional: permissões", () => {
  it("o ADMIN gerencia, o PMO só consulta e os demais perfis não acessam", async () => {
    const ctx = setup();
    await ctx.calendar.createDay(admin, 2026, belemAnniversary);

    assert.equal((await ctx.calendar.getYear(pmo, 2026)).days.length, 1);
    assert.equal((await ctx.calendar.getYear(pmo, 2026)).canManage, false);
    assert.equal((await ctx.calendar.getYear(admin, 2026)).canManage, true);
    assert.deepEqual((await ctx.calendar.listYears(pmo)).data.map((row) => row.year), [2026]);
    assert.equal((await ctx.calendar.readiness(pmo, "2026-03-01", "2026-03-31")).ready, false);

    const day = (await ctx.calendar.getYear(admin, 2026)).days[0];
    await assert.rejects(() => ctx.calendar.createDay(pmo, 2026, { ...belemAnniversary, day: "2026-08-15" }), rejects(403, "CALENDAR_FORBIDDEN"));
    await assert.rejects(() => ctx.calendar.updateDay(pmo, day.id, { description: "Outro nome" }), rejects(403));
    await assert.rejects(() => ctx.calendar.deleteDay(pmo, day.id), rejects(403));
    await assert.rejects(() => ctx.calendar.applyNational(pmo, 2026), rejects(403));
    await assert.rejects(() => ctx.calendar.suggestNational(pmo, 2026), rejects(403));
    await assert.rejects(() => ctx.calendar.validateYear(pmo, 2026, validation), rejects(403));
    await assert.rejects(() => ctx.calendar.listChanges(pmo, 2026), rejects(403));
    assert.equal((await ctx.calendar.getYear(admin, 2026)).days.length, 1, "nada mudou pelas tentativas do PMO");

    for (const actor of others) {
      await assert.rejects(() => ctx.calendar.getYear(actor, 2026), rejects(403), actor.role);
      await assert.rejects(() => ctx.calendar.listYears(actor), rejects(403), actor.role);
      await assert.rejects(() => ctx.calendar.readiness(actor, "2026-01-01", "2026-01-31"), rejects(403), actor.role);
      await assert.rejects(() => ctx.calendar.createDay(actor, 2026, belemAnniversary), rejects(403), actor.role);
    }
  });
});

describe("Calendário institucional: cadastro dos dias", () => {
  it("aplica os padrões: ponto facultativo não é dia não útil sozinho; feriado e dia institucional são", async () => {
    const ctx = setup();
    const optional = await ctx.calendar.createDay(admin, 2026, { day: "2026-06-04", scope: "NACIONAL", kind: "PONTO_FACULTATIVO", description: "Corpus Christi" });
    const holiday = await ctx.calendar.createDay(admin, 2026, belemAnniversary);
    const institutional = await ctx.calendar.createDay(admin, 2026, { day: "2026-09-04", scope: "INSTITUCIONAL", kind: "NAO_UTIL_INSTITUCIONAL", description: "Recesso", legalBasis: "Portaria interna (exemplo)" });
    const exception = await ctx.calendar.createDay(admin, 2026, { day: "2026-09-05", scope: "INSTITUCIONAL", kind: "EXPEDIENTE_EXCECAO", description: "Sábado com expediente", legalBasis: "Portaria interna (exemplo)" });
    assert.equal(optional.observed, false);
    assert.equal(holiday.observed, true);
    assert.equal(institutional.observed, true);
    assert.equal(exception.observed, true);
    // O ADMIN pode decidir observar o ponto facultativo.
    assert.equal((await ctx.calendar.updateDay(admin, optional.id, { observed: true })).observed, true);
  });

  it("valida coerência: ano, base legal, escopo institucional e duplicidade", async () => {
    const ctx = setup();
    await assert.rejects(() => ctx.calendar.createDay(admin, 2027, belemAnniversary), rejects(400, "CALENDAR_INVALID_DAY"));
    await assert.rejects(() => ctx.calendar.createDay(admin, 2026, { ...belemAnniversary, legalBasis: undefined }), rejects(400));
    await assert.rejects(() => ctx.calendar.createDay(admin, 2026, { day: "2026-09-04", scope: "NACIONAL", kind: "NAO_UTIL_INSTITUCIONAL", description: "Recesso" }), rejects(400));
    await assert.rejects(() => ctx.calendar.createDay(admin, 2026, { day: "2026-09-04", scope: "INSTITUCIONAL", kind: "FERIADO", description: "Feriado", legalBasis: "x ato" }), rejects(400));
    await ctx.calendar.createDay(admin, 2026, belemAnniversary);
    await assert.rejects(() => ctx.calendar.createDay(admin, 2026, belemAnniversary), rejects(409, "CALENDAR_DAY_CONFLICT"));
    // O mesmo dia pode ter outro escopo (ex.: nacional e municipal).
    await ctx.calendar.createDay(admin, 2026, { ...belemAnniversary, scope: "NACIONAL", legalBasis: undefined });

    const created = (await ctx.calendar.getYear(admin, 2026)).days[0];
    await assert.rejects(() => ctx.calendar.updateDay(admin, created.id, { day: "2027-01-12" }), rejects(400));
    await assert.rejects(() => ctx.calendar.updateDay(admin, created.id, { legalBasis: null }), rejects(400));
    await assert.rejects(() => ctx.calendar.updateDay(admin, "inexistente", { description: "Algo" }), rejects(404));
    await assert.rejects(() => ctx.calendar.deleteDay(admin, "inexistente"), rejects(404));
  });

  it("valida os corpos no esquema (data real, enums, campos extras e declarações)", () => {
    const valid = { day: "2026-01-12", scope: "MUNICIPAL_BELEM", kind: "FERIADO", description: "Aniversário de Belém", legalBasis: "Lei (exemplo)" };
    assert.equal(createCalendarDayBodySchema.safeParse(valid).success, true);
    assert.equal(createCalendarDayBodySchema.safeParse({ ...valid, day: "2026-02-30" }).success, false);
    assert.equal(createCalendarDayBodySchema.safeParse({ ...valid, day: "12/01/2026" }).success, false);
    assert.equal(createCalendarDayBodySchema.safeParse({ ...valid, scope: "FEDERAL" }).success, false);
    assert.equal(createCalendarDayBodySchema.safeParse({ ...valid, extra: 1 }).success, false);
    assert.equal(updateCalendarDayBodySchema.safeParse({}).success, false);
    assert.equal(validateCalendarYearBodySchema.safeParse({ ...validation, stateChecked: false }).success, false);
    assert.equal(validateCalendarYearBodySchema.safeParse({ ...validation, sourceNote: "curta" }).success, false);
    assert.equal(validateCalendarYearBodySchema.safeParse(validation).success, true);
  });
});

describe("Calendário institucional: auditoria", () => {
  it("registra criação, alteração e exclusão com antes e depois, e preserva o registro do dia excluído", async () => {
    const ctx = setup();
    const created = await ctx.calendar.createDay(admin, 2026, belemAnniversary);
    await ctx.calendar.updateDay(admin, created.id, { description: "Aniversário da cidade de Belém" });
    await ctx.calendar.deleteDay(admin, created.id);

    const changes = (await ctx.calendar.listChanges(admin, 2026)).data;
    assert.deepEqual(changes.map((row) => row.action).reverse(), ["DAY_CREATE", "DAY_UPDATE", "DAY_DELETE"]);
    const update = changes.find((row) => row.action === "DAY_UPDATE");
    assert.equal(update?.before?.description, "Aniversário de Belém");
    assert.equal(update?.after?.description, "Aniversário da cidade de Belém");
    assert.equal(changes.find((row) => row.action === "DAY_DELETE")?.before?.day, "2026-01-12");
    assert.ok(changes.every((row) => row.actorId === "admin-1" && row.actorName === "Admin"));
    assert.equal((await ctx.calendar.getYear(admin, 2026)).days.length, 0);
  });

  it("desfaz a alteração inteira quando a auditoria falha (mesma transação)", async () => {
    const ctx = setup();
    ctx.repository.appendChange = async () => {
      throw new Error("falha forçada");
    };
    await assert.rejects(() => ctx.calendar.createDay(admin, 2026, belemAnniversary));
    assert.equal(ctx.repository.days.length, 0);
  });
});

describe("Calendário institucional: validação anual", () => {
  it("o ano só valida com os feriados nacionais obrigatórios, as declarações e a fonte; só o ADMIN valida", async () => {
    const ctx = setup();
    await assert.rejects(() => ctx.calendar.validateYear(admin, 2026, validation), rejects(409, "CALENDAR_YEAR_INCOMPLETE"));
    assert.equal((await ctx.calendar.getYear(admin, 2026)).status, "DRAFT");

    const suggestions = (await ctx.calendar.suggestNational(admin, 2026)).data;
    assert.equal(suggestions.length, 10);
    assert.ok(suggestions.every((item) => item.exists === false));
    const applied = await ctx.calendar.applyNational(admin, 2026);
    assert.equal(applied.data.length, 10);
    assert.equal((await ctx.calendar.applyNational(admin, 2026)).data.length, 0, "aplicar de novo não duplica");
    assert.ok((await ctx.calendar.suggestNational(admin, 2026)).data.every((item) => item.exists));

    const result = await ctx.calendar.validateYear(admin, 2026, validation);
    assert.equal(result.status, "VALIDATED");
    assert.equal(result.validatedBy, "admin-1");
    assert.equal(result.sourceNote, validation.sourceNote);
    await assert.rejects(() => ctx.calendar.validateYear(admin, 2026, validation), rejects(409, "CALENDAR_YEAR_ALREADY_VALIDATED"));
    const actions = (await ctx.calendar.listChanges(admin, 2026)).data.map((row) => row.action);
    assert.ok(actions.includes("YEAR_VALIDATE"));
    assert.deepEqual((await ctx.calendar.readiness(pmo, "2026-03-01", "2026-12-31")), { ready: true, missingYears: [] });
    assert.deepEqual((await ctx.calendar.readiness(pmo, "2026-12-20", "2027-01-10")), { ready: false, missingYears: [2027] });
  });

  it("qualquer alteração em um ano validado o devolve a rascunho e registra a reversão", async () => {
    for (const change of ["create", "update", "delete"] as const) {
      const ctx = setup();
      const seeded = await ctx.calendar.createDay(admin, 2026, belemAnniversary);
      await validatedYear(ctx, 2026);
      assert.equal((await ctx.calendar.getYear(admin, 2026)).status, "VALIDATED");

      if (change === "create") await ctx.calendar.createDay(admin, 2026, { day: "2026-08-15", scope: "ESTADUAL_PA", kind: "FERIADO", description: "Adesão do Pará", legalBasis: "Lei estadual (exemplo)" });
      if (change === "update") await ctx.calendar.updateDay(admin, seeded.id, { observed: false });
      if (change === "delete") await ctx.calendar.deleteDay(admin, seeded.id);

      const year = await ctx.calendar.getYear(admin, 2026);
      assert.equal(year.status, "DRAFT", change);
      assert.equal(year.validatedBy, null);
      assert.equal(year.nationalChecked, false);
      assert.ok((await ctx.calendar.listChanges(admin, 2026)).data.some((row) => row.action === "YEAR_REVERT_TO_DRAFT"), change);
      assert.equal((await ctx.calendar.readiness(pmo, "2026-03-01", "2026-03-31")).ready, false);
    }
  });
});

describe("Calendário institucional: integração com o cálculo de dias úteis", () => {
  it("carrega o calendário do banco e calcula o escalonamento; ano não validado recusa o cálculo", async () => {
    const ctx = setup();
    await ctx.calendar.createDay(admin, 2026, belemAnniversary);
    await validatedYear(ctx, 2026);
    await ctx.calendar.applyNational(admin, 2027);
    await ctx.calendar.validateYear(admin, 2027, validation);

    const calendar = await loadBusinessCalendar(ctx.repository, "2025-12-25", "2026-01-15");
    // O ano anterior não foi validado: o cálculo que consulta um dia dele recusa.
    assert.throws(() => calendar.isBusinessDay("2025-12-25"), (error: unknown) => error instanceof CalendarIncompleteError && error.years.join() === "2025");
    // Já o cálculo que só depende de 2026 (validado) funciona.
    assert.equal(calendar.firstBusinessDayAfter("2025-12-31"), "2026-01-02");

    await ctx.calendar.applyNational(admin, 2025);
    await ctx.calendar.validateYear(admin, 2025, validation);
    const full = await loadBusinessCalendar(ctx.repository, "2025-12-25", "2026-01-15");
    // Segunda 12/01/2026 é feriado cadastrado: o escalonamento de 10/01 vai para a terça 13/01.
    assert.equal(full.firstBusinessDayAfter("2026-01-10"), "2026-01-13");
    assert.equal(full.isBusinessDay("2025-12-25"), false, "Natal (nacional, cadastrado)");
    assert.equal(full.onOrAfterBusinessDay("2026-01-01"), "2026-01-02");
  });
});

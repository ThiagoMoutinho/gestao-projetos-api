import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthUser } from "../../../lib/session";
import { createBusinessCalendar } from "../../business-calendar/business-days";
import { createEapInMemoryStore, makeEapInMemoryRepos, makeEapInMemoryTransactionRunner, makeMember, makeProject, makeUser } from "../test/in-memory";
import { computeExecutiveFollowUp, escalationOf, type FollowUpInput, type ProjectStatusEvent } from "./executive-follow-up";
import { makeCreatePhaseUseCase } from "./create-phase";
import { makeGetExecutiveSummaryUseCase } from "./get-executive-summary";
import { makeValidateExecutiveSummaryUseCase } from "./executive-summary-validations";

// Calendário de referência (2026): quinta 01/10, 08/10, 15/10, 22/10, 29/10, 05/11, 12/11 abrem ciclos.
const at = (value: string) => new Date(value);
const event = (when: string, from: string | null, to: string): ProjectStatusEvent => ({ at: at(when), from, to });

const NOW = at("2026-11-12T10:00:00-03:00"); // quinta 12/11: ciclo atual 12/11 a 18/11; anterior 05/11 a 11/11
const START_EVENT = event("2026-09-01T10:00:00-03:00", "NAO_INICIADO", "EM_EXECUCAO");

function input(overrides: Partial<FollowUpInput> = {}): FollowUpInput {
  return {
    now: NOW,
    projectStatus: "EM_EXECUCAO",
    projectEvents: [START_EVENT],
    firstActivityAt: null,
    regularCycleStarts: new Set(["2026-10-15"]), // ciclo anterior a 22/10 validado: a sequência começa em 22/10
    activationCutoff: "2026-01-01",
    ...overrides,
  };
}

const starts = (core: ReturnType<typeof computeExecutiveFollowUp>) => core.unvalidatedSequence?.cycles.map((cycle) => cycle.start);

describe("acompanhamento semanal: estados e sequência", () => {
  it("início comprovado por auditoria: ciclo aberto não conta e a sequência vai até o ciclo encerrado", () => {
    const core = computeExecutiveFollowUp(input());
    assert.equal(core.currentCycle.start, "2026-11-12");
    assert.equal(core.state, "AGUARDANDO_VALIDACAO");
    assert.deepEqual(core.previousCycle, { start: "2026-11-05", end: "2026-11-11", state: "ENCERRADO_SEM_VALIDACAO", reason: null });
    assert.deepEqual(starts(core), ["2026-10-22", "2026-10-29", "2026-11-05"]);
    assert.equal(core.unvalidatedSequence?.length, 3);
    assert.equal(core.unvalidatedSequence?.firstCycleStart, "2026-10-22");
  });

  it("na quarta-feira o ciclo ainda aberto não é vencido; na quinta ele passa a ser contado", () => {
    const wed = computeExecutiveFollowUp(input({ now: at("2026-11-11T10:00:00-03:00") }));
    assert.equal(wed.currentCycle.start, "2026-11-05");
    assert.deepEqual(starts(wed), ["2026-10-22", "2026-10-29"]);
    const lastSecond = computeExecutiveFollowUp(input({ now: at("2026-11-11T23:59:59-03:00") }));
    assert.equal(lastSecond.currentCycle.start, "2026-11-05");
    assert.equal(lastSecond.unvalidatedSequence?.length, 2);
    const thursday = computeExecutiveFollowUp(input({ now: at("2026-11-12T00:00:00-03:00") }));
    assert.equal(thursday.currentCycle.start, "2026-11-12");
    assert.equal(thursday.unvalidatedSequence?.length, 3);
  });

  it("usa o fuso America/Belem: 23h30 de quarta em Belém ainda pertence ao ciclo que termina nessa quarta", () => {
    const core = computeExecutiveFollowUp(input({ now: at("2026-11-12T02:30:00.000Z") }));
    assert.equal(core.currentCycle.start, "2026-11-05");
    assert.equal(core.currentCycle.end, "2026-11-11");
  });

  it("validação regular encerra a sequência; o histórico dos ciclos anteriores sem validação não é apagado", () => {
    const core = computeExecutiveFollowUp(input({ regularCycleStarts: new Set(["2026-10-15", "2026-10-29"]) }));
    assert.deepEqual(starts(core), ["2026-11-05"]);
    const all = computeExecutiveFollowUp(input({ regularCycleStarts: new Set(["2026-11-05"]) }));
    assert.equal(all.previousCycle.state, "VALIDADO");
    assert.equal(all.unvalidatedSequence, null);
    // O ciclo 22/10 continua "encerrado sem validação" se consultado depois de uma validação posterior.
    const sequenceBefore = computeExecutiveFollowUp(input({ now: at("2026-10-29T10:00:00-03:00") }));
    assert.deepEqual(starts(sequenceBefore), ["2026-10-22"]);
  });

  it("validação do ciclo atual: estado VALIDADO", () => {
    const core = computeExecutiveFollowUp(input({ regularCycleStarts: new Set(["2026-10-15", "2026-11-12"]) }));
    assert.equal(core.state, "VALIDADO");
  });

  it("sem evento de início nem andamento auditado: INDETERMINADO, sem sequência nem cobrança", () => {
    const core = computeExecutiveFollowUp(input({ projectEvents: [], firstActivityAt: null }));
    assert.equal(core.state, "INDETERMINADO");
    assert.equal(core.reason, "INICIO_NAO_COMPROVADO");
    assert.equal(core.unvalidatedSequence, null);
    assert.equal(escalationOf(core, NOW, null).status, "NAO_APLICAVEL");
  });

  it("criado diretamente em execução: o registro inicial não prova o início; o primeiro andamento auditado prova", () => {
    const created = event("2026-09-01T10:00:00-03:00", null, "EM_EXECUCAO");
    const unproven = computeExecutiveFollowUp(input({ projectEvents: [created] }));
    assert.equal(unproven.state, "INDETERMINADO");
    assert.equal(unproven.reason, "INICIO_NAO_COMPROVADO");
    assert.equal(unproven.unvalidatedSequence, null);

    const proven = computeExecutiveFollowUp(input({ projectEvents: [created], firstActivityAt: at("2026-10-02T09:00:00-03:00") }));
    // O primeiro andamento foi na sexta 02/10: o primeiro ciclo completo é o de 08/10; 15/10 está validado.
    assert.deepEqual(starts(proven), ["2026-10-22", "2026-10-29", "2026-11-05"]);
    const noValidations = computeExecutiveFollowUp(input({ projectEvents: [created], firstActivityAt: at("2026-10-02T09:00:00-03:00"), regularCycleStarts: new Set() }));
    assert.equal(noValidations.unvalidatedSequence?.firstCycleStart, "2026-10-08");
  });

  it("criado suspenso não iniciou execução; ao reativar, cobra só a partir do primeiro ciclo completo", () => {
    const created = event("2026-09-01T10:00:00-03:00", null, "SUSPENSO");
    const suspended = computeExecutiveFollowUp(input({ projectStatus: "SUSPENSO", projectEvents: [created], firstActivityAt: null }));
    assert.equal(suspended.state, "FORA_DO_ACOMPANHAMENTO");
    assert.equal(suspended.reason, "SUSPENSO");
    assert.equal(suspended.unvalidatedSequence, null);

    // Reativado na terça 20/10: o ciclo 15/10 é parcial; o primeiro cobrável é 22/10.
    const reactivated = computeExecutiveFollowUp(
      input({ projectEvents: [created, event("2026-10-20T10:00:00-03:00", "SUSPENSO", "EM_EXECUCAO")], regularCycleStarts: new Set() }),
    );
    assert.deepEqual(starts(reactivated), ["2026-10-22", "2026-10-29", "2026-11-05"]);
  });

  it("início ou reativação numa quinta-feira: esse ciclo não é cobrado", () => {
    const now = at("2026-10-08T10:00:00-03:00");
    const thursdayStart = computeExecutiveFollowUp(
      input({ now, regularCycleStarts: new Set(), projectEvents: [event("2026-10-01T10:00:00-03:00", "NAO_INICIADO", "EM_EXECUCAO")] }),
    );
    assert.deepEqual(thursdayStart.previousCycle, { start: "2026-10-01", end: "2026-10-07", state: "FORA_DO_ACOMPANHAMENTO", reason: "CICLO_PARCIAL" });
    const wednesdayStart = computeExecutiveFollowUp(
      input({ now, regularCycleStarts: new Set(), projectEvents: [event("2026-09-30T10:00:00-03:00", "NAO_INICIADO", "EM_EXECUCAO")] }),
    );
    assert.equal(wednesdayStart.previousCycle.state, "ENCERRADO_SEM_VALIDACAO");
    // Fronteira em Belém: 23h59 de quarta ainda é quarta; meia-noite já é quinta.
    const justBefore = computeExecutiveFollowUp(
      input({ now, regularCycleStarts: new Set(), projectEvents: [event("2026-10-01T02:59:59.000Z", "NAO_INICIADO", "EM_EXECUCAO")] }),
    );
    assert.equal(justBefore.previousCycle.state, "ENCERRADO_SEM_VALIDACAO");
    const atMidnight = computeExecutiveFollowUp(
      input({ now, regularCycleStarts: new Set(), projectEvents: [event("2026-10-01T03:00:00.000Z", "NAO_INICIADO", "EM_EXECUCAO")] }),
    );
    assert.equal(atMidnight.previousCycle.reason, "CICLO_PARCIAL");
  });

  it("reativação numa quinta-feira (horário real em Belém): o ciclo da reativação não é cobrado", () => {
    const now = at("2026-10-29T10:00:00-03:00"); // ciclo anterior: 22/10 a 28/10
    const base = (when: string) =>
      input({ now, regularCycleStarts: new Set(), projectEvents: [event("2026-09-01T10:00:00-03:00", null, "SUSPENSO"), event(when, "SUSPENSO", "EM_EXECUCAO")], projectStatus: "EM_EXECUCAO", firstActivityAt: null });
    const wednesdayNight = computeExecutiveFollowUp(base("2026-10-22T02:59:59.000Z")); // quarta 21/10 23:59:59 em Belém
    assert.equal(wednesdayNight.previousCycle.state, "ENCERRADO_SEM_VALIDACAO");
    const thursdayMidnight = computeExecutiveFollowUp(base("2026-10-22T03:00:00.000Z")); // quinta 22/10 00:00:00 em Belém
    assert.deepEqual([thursdayMidnight.previousCycle.state, thursdayMidnight.previousCycle.reason], ["FORA_DO_ACOMPANHAMENTO", "CICLO_PARCIAL"]);
    const thursdayMorning = computeExecutiveFollowUp(base("2026-10-22T11:00:00.000Z"));
    assert.equal(thursdayMorning.previousCycle.reason, "CICLO_PARCIAL");
  });

  it("múltiplas suspensões e reativações: ciclos parcialmente suspensos ficam fora e interrompem a sequência", () => {
    const events = [
      START_EVENT,
      event("2026-10-10T10:00:00-03:00", "EM_EXECUCAO", "SUSPENSO"),
      event("2026-10-20T10:00:00-03:00", "SUSPENSO", "EM_EXECUCAO"),
      event("2026-10-31T10:00:00-03:00", "EM_EXECUCAO", "SUSPENSO"),
      event("2026-11-04T10:00:00-03:00", "SUSPENSO", "EM_ATENCAO"),
    ];
    const core = computeExecutiveFollowUp(input({ projectStatus: "EM_ATENCAO", projectEvents: events, regularCycleStarts: new Set() }));
    // 29/10 a 04/11 teve suspensão; 22/10 também seria cobrável, mas a sequência para no ciclo suspenso.
    assert.deepEqual(starts(core), ["2026-11-05"]);
    const suspendedNow = computeExecutiveFollowUp(
      input({ projectStatus: "SUSPENSO", projectEvents: events.slice(0, 4), regularCycleStarts: new Set() }),
    );
    assert.equal(suspendedNow.state, "FORA_DO_ACOMPANHAMENTO");
    assert.equal(suspendedNow.reason, "SUSPENSO");
    assert.equal(suspendedNow.unvalidatedSequence, null);
  });

  it("conclusão encerra o acompanhamento futuro, sem apagar os ciclos anteriores", () => {
    const events = [START_EVENT, event("2026-11-02T10:00:00-03:00", "EM_EXECUCAO", "CONCLUIDO")];
    const core = computeExecutiveFollowUp(input({ projectStatus: "CONCLUIDO", projectEvents: events, regularCycleStarts: new Set() }));
    assert.equal(core.state, "FORA_DO_ACOMPANHAMENTO");
    assert.equal(core.reason, "CONCLUIDO");
    assert.equal(core.unvalidatedSequence, null);
    const before = computeExecutiveFollowUp(input({ now: at("2026-11-02T08:00:00-03:00"), projectStatus: "EM_EXECUCAO", projectEvents: [START_EVENT], regularCycleStarts: new Set() }));
    assert.equal(before.previousCycle.state, "ENCERRADO_SEM_VALIDACAO");
  });

  it("divergência entre a situação gravada e o histórico: INDETERMINADO com STATUS_SEM_HISTORICO", () => {
    for (const divergent of [
      input({ projectStatus: "SUSPENSO", projectEvents: [] }),
      input({ projectStatus: "CONCLUIDO", projectEvents: [] }),
      input({ projectStatus: "EM_EXECUCAO", projectEvents: [START_EVENT, event("2026-10-10T10:00:00-03:00", "EM_EXECUCAO", "SUSPENSO")] }),
      input({ projectEvents: [START_EVENT, event("2026-10-10T10:00:00-03:00", "SUSPENSO", "EM_EXECUCAO")] }),
    ]) {
      const core = computeExecutiveFollowUp(divergent);
      assert.equal(core.state, "INDETERMINADO");
      assert.equal(core.reason, "STATUS_SEM_HISTORICO");
      assert.equal(core.previousCycle.state, "INDETERMINADO");
      assert.equal(core.unvalidatedSequence, null);
    }
  });

  it("projeto não iniciado fica fora do acompanhamento", () => {
    const core = computeExecutiveFollowUp(input({ projectStatus: "NAO_INICIADO", projectEvents: [] }));
    assert.equal(core.state, "FORA_DO_ACOMPANHAMENTO");
    assert.equal(core.reason, "NAO_INICIADO");
  });

  it("ciclos anteriores não são julgados pela situação atual: suspensão recente não torna ciclos passados suspensos", () => {
    const events = [START_EVENT, event("2026-11-10T10:00:00-03:00", "EM_EXECUCAO", "SUSPENSO")];
    const core = computeExecutiveFollowUp(input({ projectStatus: "SUSPENSO", projectEvents: events, regularCycleStarts: new Set() }));
    assert.equal(core.state, "FORA_DO_ACOMPANHAMENTO");
    // Quem consultar antes da suspensão ainda enxerga a pendência dos ciclos anteriores.
    const earlier = computeExecutiveFollowUp(input({ now: at("2026-11-09T10:00:00-03:00"), projectEvents: [START_EVENT], regularCycleStarts: new Set() }));
    assert.equal(earlier.previousCycle.state, "ENCERRADO_SEM_VALIDACAO");
  });
});

describe("acompanhamento semanal: corte de ativação e escalonamento", () => {
  it("corte desabilitado: modo informativo, estados descritivos visíveis e escalonamento não aplicável", () => {
    const core = computeExecutiveFollowUp(input({ activationCutoff: null }));
    assert.equal(core.operational, false);
    assert.equal(core.unvalidatedSequence?.length, 3);
    const calendar = createBusinessCalendar([], new Set([2026]));
    assert.deepEqual(escalationOf(core, NOW, calendar), { status: "NAO_APLICAVEL", eligibleAt: null, calendarPendingYears: [] });
  });

  it("corte habilitado: ciclos encerrados antes do corte ficam fora", () => {
    const core = computeExecutiveFollowUp(input({ activationCutoff: "2026-11-01" }));
    assert.equal(core.operational, true);
    assert.deepEqual(starts(core), ["2026-10-29", "2026-11-05"]);
  });

  it("escalonamento: 9h do primeiro dia útil depois de 10 dias corridos do fim do primeiro ciclo da sequência", () => {
    const core = computeExecutiveFollowUp(input());
    const calendar = createBusinessCalendar([], new Set([2026]));
    // 1º ciclo termina em 28/10; +10 = sábado 07/11; primeiro dia útil depois: segunda 09/11.
    const early = escalationOf(core, at("2026-11-09T08:59:00-03:00"), calendar);
    assert.equal(early.status, "AINDA_NAO_ELEGIVEL");
    assert.equal(early.eligibleAt, "2026-11-09T12:00:00.000Z");
    assert.equal(escalationOf(core, at("2026-11-09T09:00:00-03:00"), calendar).status, "ELEGIVEL");
    const holiday = createBusinessCalendar([{ day: "2026-11-09", kind: "FERIADO", observed: true }], new Set([2026]));
    assert.equal(escalationOf(core, NOW, holiday).eligibleAt, "2026-11-10T12:00:00.000Z");
  });

  it("calendário não validado ou indisponível: INDETERMINADO, sem escalonar", () => {
    const core = computeExecutiveFollowUp(input());
    assert.deepEqual(escalationOf(core, NOW, createBusinessCalendar([], new Set())), {
      status: "INDETERMINADO",
      eligibleAt: null,
      calendarPendingYears: [2026],
    });
    assert.equal(escalationOf(core, NOW, null).status, "INDETERMINADO");
  });
});

describe("acompanhamento no resumo executivo (endpoint)", () => {
  const pmo: AuthUser = { id: "pmo-1", name: "PMO", email: "pmo@igepps.test", role: "PMO" };
  const forn: AuthUser = { id: "forn-1", name: "Forn", email: "forn@igepps.test", role: "FORNECEDOR" };

  async function setup(status: string) {
    const store = createEapInMemoryStore({
      users: [makeUser({ id: "pmo-1", role: "PMO" }), makeUser({ id: "owner-1", role: "GESTOR" }), makeUser({ id: "forn-1", role: "FORNECEDOR" })],
      projects: [makeProject({ id: "project-1", ownerId: "owner-1", status: status as never })],
      members: [makeMember({ id: "m-forn", projectId: "project-1", userId: "forn-1", role: "FORNECEDOR" })],
    });
    const repos = makeEapInMemoryRepos(store);
    const deps = { repos, runInTransaction: makeEapInMemoryTransactionRunner(repos, store) };
    await makeCreatePhaseUseCase(deps)(pmo, "project-1", { name: "Fase" });
    const calendar = createBusinessCalendar([], new Set([2026]));
    store.auditLogs.push({
      id: "ev-1",
      projectId: "project-1",
      entityType: "PROJECT",
      entityId: "project-1",
      action: "STATUS_CHANGE",
      summary: "início",
      payload: { automatic: false, from: "NAO_INICIADO", to: "EM_EXECUCAO" },
      actorId: "pmo-1",
      createdAt: at("2026-09-01T10:00:00-03:00"),
    } as never);
    return {
      store,
      summary: makeGetExecutiveSummaryUseCase({ ...deps, loadCalendar: async () => calendar }),
      validate: makeValidateExecutiveSummaryUseCase(deps),
    };
  }

  it("expõe o bloco followUp em modo informativo, sem alterar os campos existentes", async () => {
    const ctx = await setup("EM_EXECUCAO");
    const dto = await ctx.summary(pmo, "project-1", NOW);
    assert.equal(dto.governance.followUp.operational, false);
    assert.equal(dto.governance.followUp.state, "AGUARDANDO_VALIDACAO");
    assert.equal(dto.governance.followUp.unvalidatedSequence?.firstCycleStart, "2026-09-03");
    assert.equal(dto.governance.followUp.escalation.status, "NAO_APLICAVEL");
    assert.equal(dto.governance.periodic, true);
    assert.equal(dto.governance.currentCycleRegularValidated, false);
  });

  it("projeto com situação sem histórico auditado: INDETERMINADO / STATUS_SEM_HISTORICO", async () => {
    const ctx = await setup("SUSPENSO");
    const dto = await ctx.summary(pmo, "project-1", NOW);
    // Há evento de início, mas a situação gravada é SUSPENSO: diverge do histórico.
    assert.equal(dto.governance.followUp.state, "INDETERMINADO");
    assert.equal(dto.governance.followUp.reason, "STATUS_SEM_HISTORICO");
  });

  it("validação extraordinária não substitui a regular; a regular interrompe a sequência", async () => {
    const ctx = await setup("EM_EXECUCAO");
    const lastWeek = at("2026-11-09T10:00:00-03:00"); // ciclo 05/11 a 11/11
    const before = await ctx.summary(pmo, "project-1", lastWeek);
    await ctx.validate(pmo, "project-1", { fingerprint: before.governance.fingerprint, extraordinary: true, observation: "Reunião extra." }, lastWeek);
    const afterExtra = await ctx.summary(pmo, "project-1", NOW);
    assert.equal(afterExtra.governance.followUp.previousCycle.state, "ENCERRADO_SEM_VALIDACAO");

    const again = await ctx.summary(pmo, "project-1", lastWeek);
    await ctx.validate(pmo, "project-1", { fingerprint: again.governance.fingerprint }, lastWeek);
    const afterRegular = await ctx.summary(pmo, "project-1", NOW);
    assert.equal(afterRegular.governance.followUp.previousCycle.state, "VALIDADO");
    assert.equal(afterRegular.governance.followUp.unvalidatedSequence, null);
  });

  it("não depende do perfil para o estado, mas os detalhes de escalonamento ficam com quem vê a governança", async () => {
    const ctx = await setup("EM_EXECUCAO");
    const dto = await ctx.summary(forn, "project-1", NOW);
    assert.equal(dto.governance.followUp.state, "AGUARDANDO_VALIDACAO");
    assert.equal(dto.governance.followUp.escalation.status, "NAO_APLICAVEL");
  });
});

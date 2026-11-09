import { CalendarIncompleteError, type BusinessCalendar } from "../../business-calendar/business-days";
import { addCivilDays, belemDayStartIso, cycleFromStart, executiveCycleOf, type ExecutiveCycle } from "./executive-cycle";

/**
 * Acompanhamento semanal do resumo executivo (somente cálculo, sem gravar nem notificar).
 *
 * Cada ciclo (quinta a quarta, America/Belem) é avaliado só com os eventos auditados até o fim dele. A situação atual
 * do projeto nunca é usada para presumir a situação de ciclos passados. Quando o histórico não basta, o resultado é
 * INDETERMINADO com o motivo, e nada é cobrado.
 */

export type FollowUpState =
  | "AGUARDANDO_VALIDACAO"
  | "VALIDADO"
  | "ENCERRADO_SEM_VALIDACAO"
  | "FORA_DO_ACOMPANHAMENTO"
  | "INDETERMINADO";

export type FollowUpReason =
  | "NAO_INICIADO"
  | "SUSPENSO"
  | "CONCLUIDO"
  | "CICLO_PARCIAL"
  | "ANTES_DO_CORTE"
  | "STATUS_SEM_HISTORICO"
  | "INICIO_NAO_COMPROVADO";

/** Evento de situação do projeto (auditoria `STATUS_CHANGE` da entidade PROJECT, não automático). */
export type ProjectStatusEvent = { at: Date; from: string | null; to: string };

export type FollowUpInput = {
  now: Date;
  /** Situação gravada hoje no projeto (`projects.status`). */
  projectStatus: string;
  projectEvents: ReadonlyArray<ProjectStatusEvent>;
  /** Primeiro registro auditado de andamento (fase/tarefa que saiu de "não iniciada" ou entrega de marco). */
  firstActivityAt: Date | null;
  /** Inícios (`cycleStart`) com validação REGULAR. Validações extraordinárias não entram aqui. */
  regularCycleStarts: ReadonlySet<string>;
  /** Corte de ativação (AAAA-MM-DD). `null` = desabilitado: o acompanhamento é só informativo. */
  activationCutoff: string | null;
};

type Category = "NONE" | "NOT_STARTED" | "ACTIVE" | "SUSPENDED" | "CONCLUDED" | "UNKNOWN";

const ACTIVE_STATUSES = new Set(["EM_EXECUCAO", "EM_ATENCAO", "CRITICO", "EM_VALIDACAO"]);

function categoryOf(status: string): Category {
  if (status === "NAO_INICIADO") return "NOT_STARTED";
  if (status === "SUSPENSO") return "SUSPENDED";
  if (status === "CONCLUIDO") return "CONCLUDED";
  return ACTIVE_STATUSES.has(status) ? "ACTIVE" : "UNKNOWN";
}

/** Quantos ciclos para trás a sequência é examinada (dois anos). */
const MAX_LOOKBACK_CYCLES = 104;
const ESCALATION_DAYS = 10;
const ESCALATION_HOUR = "09:00:00.000-03:00";

type CycleVerdict = { state: FollowUpState; reason: FollowUpReason | null };

const fora = (reason: FollowUpReason): CycleVerdict => ({ state: "FORA_DO_ACOMPANHAMENTO", reason });
const indeterminado = (reason: FollowUpReason): CycleVerdict => ({ state: "INDETERMINADO", reason });

/** A trilha é coerente com a situação gravada? Sem eventos, só situações sem decisão formal são aceitas. */
function historyIsConsistent(input: FollowUpInput, events: ReadonlyArray<ProjectStatusEvent>) {
  if (categoryOf(input.projectStatus) === "UNKNOWN") return false;
  if (events.length === 0) {
    const category = categoryOf(input.projectStatus);
    return category !== "SUSPENDED" && category !== "CONCLUDED";
  }
  for (let index = 1; index < events.length; index += 1) {
    if (events[index].from !== null && events[index].from !== events[index - 1].to) return false;
  }
  return events[events.length - 1].to === input.projectStatus;
}

function sortedEvents(events: ReadonlyArray<ProjectStatusEvent>) {
  return [...events].sort((left, right) => left.at.getTime() - right.at.getTime());
}

export function computeExecutiveFollowUp(input: FollowUpInput) {
  const events = sortedEvents(input.projectEvents);
  const consistent = historyIsConsistent(input, events);
  const nowMs = input.now.getTime();

  // Início comprovado: entrada em execução registrada (saindo de "não iniciado" ou de suspenso) ou o primeiro andamento auditado.
  const enteringActive = events.filter((event) => categoryOf(event.to) === "ACTIVE" && event.from !== null && categoryOf(event.from) !== "ACTIVE");
  const proofCandidates = [...enteringActive.map((event) => event.at.getTime()), ...(input.firstActivityAt ? [input.firstActivityAt.getTime()] : [])];
  const proofAt = proofCandidates.length > 0 ? Math.min(...proofCandidates) : null;

  function categoryBefore(instantMs: number): Category {
    const before = events.filter((event) => event.at.getTime() < instantMs);
    if (before.length > 0) return categoryOf(before[before.length - 1].to);
    if (events.length === 0) return categoryOf(input.projectStatus);
    const first = events[0];
    // Antes do primeiro evento: a situação anterior registrada nele; criação (sem anterior) = o projeto ainda não existia.
    return first.from === null ? "NONE" : categoryOf(first.from);
  }

  function judge(cycle: ExecutiveCycle): CycleVerdict {
    if (!consistent) return indeterminado("STATUS_SEM_HISTORICO");

    const startMs = new Date(belemDayStartIso(cycle.start)).getTime();
    const endMs = new Date(cycle.deadlineAt).getTime();
    const opening = categoryBefore(startMs);
    const inside = events.filter((event) => event.at.getTime() >= startMs && event.at.getTime() <= endMs).map((event) => categoryOf(event.to));

    // Reativado durante o ciclo (e não suspenso de novo): ciclo parcial, fora da cobrança.
    if (opening === "SUSPENDED" && inside.includes("ACTIVE") && !inside.includes("SUSPENDED") && !inside.includes("CONCLUDED")) {
      return fora("CICLO_PARCIAL");
    }
    if (opening === "SUSPENDED" || inside.includes("SUSPENDED")) return fora("SUSPENSO");
    if (opening === "CONCLUDED" || inside.includes("CONCLUDED")) return fora("CONCLUIDO");
    if (opening === "NONE") return inside.length > 0 ? fora("CICLO_PARCIAL") : fora("NAO_INICIADO");
    if (opening === "NOT_STARTED") return inside.includes("ACTIVE") ? fora("CICLO_PARCIAL") : fora("NAO_INICIADO");
    if (opening !== "ACTIVE") return indeterminado("STATUS_SEM_HISTORICO");

    // Em execução na abertura do ciclo: o início precisa estar comprovado por evento anterior ao ciclo.
    if (proofAt === null || proofAt > endMs) return indeterminado("INICIO_NAO_COMPROVADO");
    if (proofAt >= startMs) return fora("CICLO_PARCIAL");

    if (input.activationCutoff !== null && cycle.end < input.activationCutoff) return fora("ANTES_DO_CORTE");
    if (input.regularCycleStarts.has(cycle.start)) return { state: "VALIDADO", reason: null };
    return { state: nowMs > endMs ? "ENCERRADO_SEM_VALIDACAO" : "AGUARDANDO_VALIDACAO", reason: null };
  }

  const currentCycle = executiveCycleOf(input.now);
  const current = judge(currentCycle);
  const previousStart = addCivilDays(currentCycle.start, -7);
  const previous = judge(cycleFromStart(previousStart));

  // Sequência contínua de ciclos encerrados, elegíveis e sem validação regular, do mais recente para trás.
  const sequence: ExecutiveCycle[] = [];
  for (let step = 1; step <= MAX_LOOKBACK_CYCLES; step += 1) {
    const cycle = cycleFromStart(addCivilDays(currentCycle.start, -7 * step));
    if (judge(cycle).state !== "ENCERRADO_SEM_VALIDACAO") break;
    sequence.unshift(cycle);
  }

  const operational = input.activationCutoff !== null;
  return {
    operational,
    state: current.state,
    reason: current.reason,
    currentCycle,
    previousCycle: { start: previousStart, end: addCivilDays(previousStart, 6), state: previous.state, reason: previous.reason },
    unvalidatedSequence:
      sequence.length === 0
        ? null
        : {
            length: sequence.length,
            firstCycleStart: sequence[0].start,
            lastCycleStart: sequence[sequence.length - 1].start,
            cycles: sequence.map((cycle) => ({ start: cycle.start, end: cycle.end })),
          },
  };
}

export type ExecutiveFollowUpCore = ReturnType<typeof computeExecutiveFollowUp>;

export type FollowUpEscalation = {
  status: "NAO_APLICAVEL" | "AINDA_NAO_ELEGIVEL" | "ELEGIVEL" | "INDETERMINADO";
  eligibleAt: string | null;
  /** Anos do calendário institucional ainda sem validação do ADMIN (quando o cálculo depende deles). */
  calendarPendingYears: number[];
};

const NOT_APPLICABLE: FollowUpEscalation = { status: "NAO_APLICAVEL", eligibleAt: null, calendarPendingYears: [] };

/** Dia (AAAA-MM-DD) cujo dia útil seguinte define o escalonamento: 10 dias corridos depois do fim do 1º ciclo da sequência. */
export function escalationDueDay(core: ExecutiveFollowUpCore) {
  if (!core.operational || core.unvalidatedSequence === null) return null;
  return addCivilDays(core.unvalidatedSequence.cycles[0].end, ESCALATION_DAYS);
}

/**
 * Escalonamento: 9h do primeiro dia útil depois de (fim do primeiro ciclo da sequência + 10 dias corridos).
 * Sem calendário validado para os anos envolvidos, não calcula (INDETERMINADO) e nada é escalonado.
 */
export function escalationOf(core: ExecutiveFollowUpCore, now: Date, calendar: BusinessCalendar | null): FollowUpEscalation {
  const due = escalationDueDay(core);
  if (due === null) return NOT_APPLICABLE;
  if (calendar === null) return { status: "INDETERMINADO", eligibleAt: null, calendarPendingYears: [] };
  try {
    const day = calendar.firstBusinessDayAfter(due);
    const eligibleAt = new Date(`${day}T${ESCALATION_HOUR}`);
    return { status: now.getTime() >= eligibleAt.getTime() ? "ELEGIVEL" : "AINDA_NAO_ELEGIVEL", eligibleAt: eligibleAt.toISOString(), calendarPendingYears: [] };
  } catch (error) {
    if (error instanceof CalendarIncompleteError) {
      return { status: "INDETERMINADO", eligibleAt: null, calendarPendingYears: error.years };
    }
    throw error;
  }
}

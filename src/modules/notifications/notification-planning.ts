import { CalendarIncompleteError, type BusinessCalendar } from "../business-calendar/business-days";
import { addCivilDays, belemDayStartIso } from "../eap/use-cases/executive-cycle";
import { escalationDueDay, escalationOf, type ExecutiveFollowUpCore } from "../eap/use-cases/executive-follow-up";

/**
 * Regras puras das notificações do acompanhamento semanal (sem banco e sem relógio próprio): quais avisos são devidos,
 * quando, para quem e quando uma pendência se resolve. O motor de estados é o da Etapa 3.2; aqui só se decide o aviso.
 */
export type NotificationKind = "PREVENTIVE" | "OVERDUE" | "ESCALATION";
export type ResolutionReason = "VALIDATED" | "PROJECT_SUSPENDED" | "PROJECT_CONCLUDED" | "CYCLE_EXPIRED";

export const NOTIFICATION_KINDS: ReadonlyArray<NotificationKind> = ["PREVENTIVE", "OVERDUE", "ESCALATION"];

/** Aviso preventivo: terça-feira do ciclo (5 dias depois da quinta-feira de início), às 9h de Belém. */
const PREVENTIVE_OFFSET_DAYS = 5;
const SEND_HOUR = "09:00:00.000-03:00";

export type PlannedNotification = {
  kind: NotificationKind;
  cycleStart: string;
  sequenceStart: string | null;
  /** Vencimento original (não muda quando o envio é adiado para um dia útil). */
  dueDate: string;
  scheduledFor: Date;
  dedupeKey: string;
  title: string;
  body: string;
};

export type CalendarGap = { years: number[]; kind: NotificationKind };

export type PlanResult = {
  planned: PlannedNotification | null;
  /** Aviso devido, mas agendado antes da ativação: não é gerado (sem cobrança retroativa). */
  skippedBeforeActivation: boolean;
  /** Anos do calendário que impedem calcular o aviso. */
  calendarGap: CalendarGap | null;
};

const NONE: PlanResult = { planned: null, skippedBeforeActivation: false, calendarGap: null };

const at9h = (day: string) => new Date(`${day}T${SEND_HOUR}`);

function brDate(day: string) {
  const [year, month, date] = day.split("-");
  return `${date}/${month}/${year}`;
}

function viaCalendar<T>(kind: NotificationKind, compute: () => T): { value: T } | { gap: CalendarGap } {
  try {
    return { value: compute() };
  } catch (error) {
    if (error instanceof CalendarIncompleteError) {
      return { gap: { years: error.years, kind } };
    }
    throw error;
  }
}

/**
 * Aviso devido a um projeto agora, por tipo. `core` vem da Etapa 3.2 (com o corte de ativação). Só há aviso quando o
 * acompanhamento é operacional (corte definido) e o estado é determinado.
 */
export function planNotification(input: {
  kind: NotificationKind;
  projectId: string;
  projectName: string;
  core: ExecutiveFollowUpCore;
  now: Date;
  activatedAt: Date;
  calendar: BusinessCalendar;
}): PlanResult {
  const { kind, projectId, projectName, core, now, activatedAt, calendar } = input;
  if (!core.operational) return NONE;
  const nowMs = now.getTime();

  if (kind === "PREVENTIVE") {
    if (core.state !== "AGUARDANDO_VALIDACAO") return NONE;
    const cycle = core.currentCycle;
    const tuesday = addCivilDays(cycle.start, PREVENTIVE_OFFSET_DAYS);
    const day = viaCalendar(kind, () => calendar.onOrBeforeBusinessDay(tuesday));
    if ("gap" in day) return { ...NONE, calendarGap: day.gap };
    const scheduledFor = at9h(day.value);
    if (nowMs < scheduledFor.getTime() || nowMs > new Date(cycle.deadlineAt).getTime()) return NONE;
    if (scheduledFor < activatedAt) return { ...NONE, skippedBeforeActivation: true };
    return {
      ...NONE,
      planned: {
        kind,
        cycleStart: cycle.start,
        sequenceStart: null,
        dueDate: cycle.end,
        scheduledFor,
        dedupeKey: `PREVENTIVE:${projectId}:${cycle.start}`,
        title: "Validação semanal do resumo executivo vence na quarta-feira",
        body: `O resumo executivo do projeto "${projectName}" ainda não recebeu a validação regular do PMO no ciclo de ${brDate(cycle.start)} a ${brDate(cycle.end)}. O prazo termina na quarta-feira, ${brDate(cycle.end)}.`,
      },
    };
  }

  // Quem já validou o ciclo atual está em dia: não se cobra atraso nem escalonamento neste momento.
  if (core.state === "VALIDADO") return NONE;

  if (kind === "OVERDUE") {
    const previous = core.previousCycle;
    if (previous.state !== "ENCERRADO_SEM_VALIDACAO") return NONE;
    const thursday = addCivilDays(previous.end, 1);
    const day = viaCalendar(kind, () => calendar.onOrAfterBusinessDay(thursday));
    if ("gap" in day) return { ...NONE, calendarGap: day.gap };
    const scheduledFor = at9h(day.value);
    if (nowMs < scheduledFor.getTime()) return NONE;
    if (scheduledFor < activatedAt) return { ...NONE, skippedBeforeActivation: true };
    return {
      ...NONE,
      planned: {
        kind,
        cycleStart: previous.start,
        sequenceStart: null,
        dueDate: previous.end,
        scheduledFor,
        dedupeKey: `OVERDUE:${projectId}:${previous.start}`,
        title: "Resumo executivo sem validação no ciclo encerrado",
        body: `O ciclo de ${brDate(previous.start)} a ${brDate(previous.end)} do projeto "${projectName}" encerrou sem validação regular do PMO. A ausência de validação não indica falta de atualização do projeto.`,
      },
    };
  }

  const sequence = core.unvalidatedSequence;
  if (sequence === null || escalationDueDay(core) === null) return NONE;
  const escalation = escalationOf(core, now, calendar);
  if (escalation.status === "INDETERMINADO") {
    return { ...NONE, calendarGap: escalation.calendarPendingYears.length > 0 ? { years: escalation.calendarPendingYears, kind } : null };
  }
  if (escalation.status !== "ELEGIVEL" || escalation.eligibleAt === null) return NONE;
  const scheduledFor = new Date(escalation.eligibleAt);
  if (scheduledFor < activatedAt) return { ...NONE, skippedBeforeActivation: true };
  return {
    ...NONE,
    planned: {
      kind,
      cycleStart: sequence.firstCycleStart,
      sequenceStart: sequence.firstCycleStart,
      dueDate: escalationDueDay(core) as string,
      scheduledFor,
      dedupeKey: `ESCALATION:${projectId}:${sequence.firstCycleStart}`,
      title: `Escalonamento: resumo executivo sem validação há ${sequence.length} ciclo${sequence.length > 1 ? "s" : ""} consecutivo${sequence.length > 1 ? "s" : ""}`,
      body: `O projeto "${projectName}" está sem validação regular do PMO desde o ciclo iniciado em ${brDate(sequence.firstCycleStart)} (${sequence.length} ciclo${sequence.length > 1 ? "s" : ""} encerrado${sequence.length > 1 ? "s" : ""} sem validação). Passaram-se 10 dias corridos do fim do primeiro ciclo.`,
    },
  };
}

export type RecipientUser = { id: string; name: string; email: string; role: string; isActive: boolean };
export type RecipientRule = { id: string; kind: string; source: string; role: string | null; userId: string | null; visibility: string; enabled: boolean };
export type ConfigIssue = {
  kind: "NO_RECIPIENT" | "RECIPIENT_INACTIVE" | "RULE_MISSING";
  dedupeKey: string;
  details: Record<string, unknown>;
};

/**
 * Destinatários de um tipo de aviso, sem usuários fixos no código: só as regras cadastradas pelo ADMIN. Inativos e
 * inexistentes são ignorados e geram ocorrência. Sem destinatário em TO, não há aviso.
 */
export function resolveRecipients(kind: NotificationKind, rules: ReadonlyArray<RecipientRule>, users: ReadonlyMap<string, RecipientUser>) {
  const issues: ConfigIssue[] = [];
  const enabled = rules.filter((rule) => rule.kind === kind && rule.enabled);
  if (!enabled.some((rule) => rule.visibility === "TO")) {
    issues.push({ kind: "RULE_MISSING", dedupeKey: `RULE_MISSING:${kind}`, details: { notificationKind: kind } });
  }
  const to = new Map<string, RecipientUser>();
  const cc = new Map<string, RecipientUser>();
  for (const rule of enabled) {
    let matched: RecipientUser[] = [];
    if (rule.source === "ROLE") {
      matched = [...users.values()].filter((candidate) => candidate.role === rule.role && candidate.isActive);
    } else if (rule.userId) {
      const target = users.get(rule.userId);
      if (!target || !target.isActive) {
        issues.push({
          kind: "RECIPIENT_INACTIVE",
          dedupeKey: `RECIPIENT_INACTIVE:${rule.userId}`,
          details: { notificationKind: kind, userId: rule.userId, reason: target ? "INACTIVE" : "NOT_FOUND" },
        });
      } else if (kind === "ESCALATION" && rule.visibility === "TO" && target.role !== "COORDENADOR") {
        issues.push({
          kind: "RECIPIENT_INACTIVE",
          dedupeKey: `RECIPIENT_INACTIVE:${rule.userId}`,
          details: { notificationKind: kind, userId: rule.userId, reason: "NOT_COORDINATOR" },
        });
      } else {
        matched = [target];
      }
    }
    for (const candidate of matched) {
      (rule.visibility === "TO" ? to : cc).set(candidate.id, candidate);
    }
  }
  for (const id of to.keys()) cc.delete(id);
  if (to.size === 0 && enabled.some((rule) => rule.visibility === "TO")) {
    issues.push({ kind: "NO_RECIPIENT", dedupeKey: `NO_RECIPIENT:${kind}`, details: { notificationKind: kind } });
  }
  return { to: [...to.values()], cc: [...cc.values()], issues };
}

export type OpenNotification = { id: string; projectId: string; kind: NotificationKind; cycleStart: string; sequenceStart: string | null; dueDate: string };
export type RegularValidation = { id: string; cycleStart: string };

/**
 * Como uma pendência já notificada se resolve. A notificação nunca é apagada nem reescrita e o histórico dos ciclos não
 * muda: resolver é só registrar o motivo. Uma validação regular vale para o ciclo em que acontece, então um ciclo vencido
 * continua "encerrado sem validação" mesmo depois de a pendência ser resolvida.
 */
export function resolutionFor(
  notification: OpenNotification,
  input: { core: ExecutiveFollowUpCore; validations: ReadonlyArray<RegularValidation>; now: Date },
): { reason: ResolutionReason; validationId: string | null } | null {
  const regular = [...input.validations].sort((a, b) => a.cycleStart.localeCompare(b.cycleStart));
  if (notification.kind === "PREVENTIVE") {
    const own = regular.find((item) => item.cycleStart === notification.cycleStart);
    if (own) return { reason: "VALIDATED", validationId: own.id };
  } else {
    const anchor = notification.sequenceStart ?? notification.cycleStart;
    const later = regular.find((item) => item.cycleStart > anchor);
    if (later) return { reason: "VALIDATED", validationId: later.id };
  }
  const { core } = input;
  if (core.state === "FORA_DO_ACOMPANHAMENTO" && core.reason === "SUSPENSO") return { reason: "PROJECT_SUSPENDED", validationId: null };
  if (core.state === "FORA_DO_ACOMPANHAMENTO" && core.reason === "CONCLUIDO") return { reason: "PROJECT_CONCLUDED", validationId: null };
  if (notification.kind === "PREVENTIVE" && input.now.getTime() >= new Date(belemDayStartIso(addCivilDays(notification.dueDate, 1))).getTime()) {
    return { reason: "CYCLE_EXPIRED", validationId: null };
  }
  return null;
}

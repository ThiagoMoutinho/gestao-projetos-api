import { HttpError } from "../../lib/http-error";
import type { BusinessCalendar } from "../business-calendar/business-days";
import { addCivilDays, belemDayStartIso, civilDay } from "../eap/use-cases/executive-cycle";
import { computeExecutiveFollowUp, type ExecutiveFollowUpCore } from "../eap/use-cases/executive-follow-up";
import { loadFollowUpEvidence } from "../eap/use-cases/get-executive-summary";
import type { EapRepos } from "../eap/repositories/contracts";
import { deliveryWindowAt, type DeliveryWindow } from "./delivery-window";
import {
  NOTIFICATION_KINDS,
  planNotification,
  resolutionFor,
  resolveRecipients,
  type ConfigIssue,
  type NotificationKind,
  type RecipientUser,
  type RegularValidation,
} from "./notification-planning";
import { LeaseLostError, type Fence, type NewDelivery, type NotificationRepository } from "./notifications.repository";

/** Quantas validações do projeto são lidas para saber os ciclos com validação regular. */
const VALIDATION_WINDOW = 500;
/** Itens listados no resumo técnico de uma simulação. */
const SUMMARY_LIMIT = 200;
/** Margem à frente de hoje para carregar o calendário (o envio é adiado, no máximo, para o próximo dia útil). */
const CALENDAR_AHEAD_DAYS = 30;

export type GeneratorDeps = {
  notifications: NotificationRepository;
  eap: EapRepos;
  loadCalendar: (from: string, to: string) => Promise<BusinessCalendar>;
  validatedCalendarYears: () => Promise<Set<number>>;
};

export type GeneratorOptions = {
  /** DRY_RUN calcula e descreve o que faria; ACTIVE grava (exige a ativação ligada). */
  mode: "DRY_RUN" | "ACTIVE";
  origin: "CLI" | "API" | "SCHEDULER";
  actorId: string | null;
  now: Date;
  /** Corte (quinta-feira) usado numa simulação enquanto a ativação estiver desligada. */
  simulatedCutoff?: string | null;
  /**
   * Entrega só em dia útil, de 9h00 a 17h59 (Belém). Padrão: ligado na geração real. Fora da janela o processamento
   * técnico continua (conciliação, ocorrências), mas nenhum aviso é criado: eles ficam adiados.
   */
  applyDeliveryWindow?: boolean;
  /** Falso para uma simulação silenciosa (planejamento do agendador): não grava nem a linha técnica da execução. */
  persistRun?: boolean;
  /** Registrar uma linha quando a trava global estiver ocupada (padrão: sim; o agendador não registra). */
  recordSkipped?: boolean;
  /** Cancelamento cooperativo: se a reserva do agendador for perdida, a execução para antes da próxima gravação. */
  signal?: AbortSignal;
  /** Barreira de gravação: o token da reserva é conferido na própria transação de cada gravação. */
  fence?: Fence;
};

export type GeneratorSummary = {
  live: boolean;
  evaluatedProjects: number;
  cutoff: string | null;
  activatedAt: string;
  deliveryWindow: { open: boolean; reason: string };
  wouldCreate: Array<{ projectId: string; kind: NotificationKind; dedupeKey: string; scheduledFor: string; recipients: number }>;
  created: number;
  duplicates: number;
  /** Avisos devidos mas adiados porque a janela de entrega está fechada. */
  deferredDelivery: number;
  skippedBeforeActivation: number;
  blockedNoRecipient: number;
  blockedCalendar: number;
  resolved: Array<{ notificationId: string; reason: string }>;
  issues: Array<{ kind: string; dedupeKey: string }>;
  /** Ocorrências que seriam abertas ou resolvidas (trabalho técnico pendente). */
  issueChanges: number;
  note: string | null;
};

export type GeneratorResult = { runId: string | null; status: "COMPLETED" | "SKIPPED_LOCKED"; summary: GeneratorSummary | null };

function snapshotOf(core: ExecutiveFollowUpCore, projectStatus: string): Record<string, unknown> {
  return {
    projectStatus,
    state: core.state,
    reason: core.reason,
    currentCycle: core.currentCycle,
    previousCycle: core.previousCycle,
    unvalidatedSequence: core.unvalidatedSequence,
  };
}

/** Ocorrências do agendador são abertas e resolvidas por ele; a conciliação comum nunca as resolve. */
const SCHEDULER_ISSUE_KINDS = new Set(["SCHEDULER_FAILURE"]);

/**
 * Gera (ou simula) os avisos do acompanhamento semanal. Idempotente: a chave de duplicidade, a trava por aviso e a trava
 * global impedem avisos repetidos, inclusive com execuções concorrentes. Nunca altera validações nem o estado dos ciclos.
 *
 * A trava global (pg_try_advisory_xact_lock) é transacional e o laço inteiro roda DENTRO da transação que a mantém: ela só
 * é liberada quando a execução termina, falha ou o processo cai (a conexão se fecha). A linha da execução só é gravada
 * depois de obter a trava, para que uma execução que apenas espera nunca seja confundida com uma abandonada.
 */
export async function runNotificationGenerator(deps: GeneratorDeps, options: GeneratorOptions): Promise<GeneratorResult> {
  const { notifications: repo, eap } = deps;
  const { now, mode, fence } = options;
  const settings = await repo.getSettings();
  if (mode === "ACTIVE" && !settings.activationEnabled) {
    throw new HttpError(409, "As notificações estão desativadas: só a simulação pode ser executada.", "NOTIFICATIONS_DISABLED");
  }
  const live = settings.activationEnabled;
  const cutoff = live ? settings.activationCutoff : (options.simulatedCutoff ?? null);
  // Simulação com a ativação desligada: considera a ativação no início do corte (senão tudo já devido seria "anterior à ativação").
  const activatedAt = live && settings.activatedAt ? settings.activatedAt : cutoff ? new Date(belemDayStartIso(cutoff)) : now;
  const applyWindow = options.applyDeliveryWindow ?? mode === "ACTIVE";

  const checkAbort = () => {
    if (options.signal?.aborted) {
      throw new LeaseLostError(typeof options.signal.reason === "string" ? options.signal.reason : "Execução cancelada: reserva perdida.");
    }
  };

  const newRun = () =>
    repo.insertRun({
      id: crypto.randomUUID(),
      mode,
      origin: options.origin,
      actorId: options.actorId,
      asOf: now,
      simulatedCutoff: live ? null : (options.simulatedCutoff ?? null),
    });

  const execute = async (runId: string): Promise<GeneratorSummary> => {
    const summary: GeneratorSummary = {
      live,
      evaluatedProjects: 0,
      cutoff,
      activatedAt: activatedAt.toISOString(),
      deliveryWindow: { open: true, reason: "NOT_APPLIED" },
      wouldCreate: [],
      created: 0,
      duplicates: 0,
      deferredDelivery: 0,
      skippedBeforeActivation: 0,
      blockedNoRecipient: 0,
      blockedCalendar: 0,
      resolved: [],
      issues: [],
      issueChanges: 0,
      note: cutoff === null ? "Sem corte de ativação: nenhum aviso é calculado." : live ? null : "Simulação: considera a ativação no início do corte informado.",
    };
    const issueMap = new Map<string, { kind: ConfigIssue["kind"] | "CALENDAR_NOT_VALIDATED"; year: number | null; details: Record<string, unknown> }>();
    const addIssue = (key: string, kind: ConfigIssue["kind"] | "CALENDAR_NOT_VALIDATED", year: number | null, details: Record<string, unknown>) => {
      if (!issueMap.has(key)) issueMap.set(key, { kind, year, details });
    };

    const [rules, userList, projects] = await Promise.all([repo.listRules(), repo.listUsers(), repo.listProjects()]);
    const users = new Map<string, RecipientUser>(userList.map((item) => [item.id, item]));

    // Saúde da configuração (a cada execução): regras ausentes, destinatários inativos e sem destinatário.
    const recipients = new Map<NotificationKind, ReturnType<typeof resolveRecipients>>();
    for (const kind of NOTIFICATION_KINDS) {
      const resolved = resolveRecipients(kind, rules, users);
      recipients.set(kind, resolved);
      for (const issue of resolved.issues) addIssue(issue.dedupeKey, issue.kind, null, issue.details);
    }

    const today = civilDay(now);
    const calendar = cutoff === null ? null : await deps.loadCalendar(cutoff < today ? cutoff : today, addCivilDays(today, CALENDAR_AHEAD_DAYS));
    let window: DeliveryWindow = { open: true, reason: "OPEN" };
    if (applyWindow && calendar !== null) {
      window = deliveryWindowAt(now, calendar);
      summary.deliveryWindow = { open: window.open, reason: window.reason };
      if (window.reason === "CALENDAR_NOT_VALIDATED") {
        for (const year of window.calendarYears) {
          addIssue(`CALENDAR_NOT_VALIDATED:${year}`, "CALENDAR_NOT_VALIDATED", year, { year, affectedKinds: ["DELIVERY_WINDOW"] });
        }
      }
    } else if (applyWindow) {
      summary.deliveryWindow = { open: false, reason: "NO_CUTOFF" };
    }
    const perProject = new Map<string, { core: ExecutiveFollowUpCore; validations: RegularValidation[] }>();

    const evaluate = async (project: { id: string; status: string }) => {
      const cached = perProject.get(project.id);
      if (cached) return cached;
      const [evidence, rows] = await Promise.all([loadFollowUpEvidence(eap, project.id), eap.executiveSummaries.listByProject(project.id, VALIDATION_WINDOW)]);
      const validations = rows.filter((row) => row.kind === "REGULAR").map((row) => ({ id: row.id, cycleStart: row.cycleStart }));
      const core = computeExecutiveFollowUp({
        now,
        projectStatus: project.status,
        ...evidence,
        regularCycleStarts: new Set(validations.map((item) => item.cycleStart)),
        activationCutoff: cutoff,
      });
      const entry = { core, validations };
      perProject.set(project.id, entry);
      return entry;
    };

    for (const project of projects) {
      checkAbort();
      const { core } = await evaluate(project);
      if (calendar === null || !core.operational) continue;
      for (const kind of NOTIFICATION_KINDS) {
        const plan = planNotification({ kind, projectId: project.id, projectName: project.name, core, now, activatedAt, calendar });
        if (plan.calendarGap) {
          summary.blockedCalendar += 1;
          for (const year of plan.calendarGap.years) {
            addIssue(`CALENDAR_NOT_VALIDATED:${year}`, "CALENDAR_NOT_VALIDATED", year, { year, affectedKinds: [plan.calendarGap.kind] });
          }
        }
        if (plan.skippedBeforeActivation) summary.skippedBeforeActivation += 1;
        const planned = plan.planned;
        if (!planned) continue;
        const group = recipients.get(kind)!;
        if (group.to.length === 0) {
          summary.blockedNoRecipient += 1;
          continue;
        }
        if (await repo.findNotificationByKey(planned.dedupeKey)) {
          summary.duplicates += 1;
          continue;
        }
        // Fora da janela de entrega o aviso fica adiado: será entregue no primeiro processamento dentro da janela.
        if (!window.open) {
          summary.deferredDelivery += 1;
          continue;
        }
        if (mode === "DRY_RUN") {
          if (summary.wouldCreate.length < SUMMARY_LIMIT) {
            summary.wouldCreate.push({
              projectId: project.id,
              kind,
              dedupeKey: planned.dedupeKey,
              scheduledFor: planned.scheduledFor.toISOString(),
              recipients: group.to.length + group.cc.length,
            });
          }
          continue;
        }
        const deliveries: NewDelivery[] = [
          ...group.to.map((item) => ({ item, visibility: "TO" as const })),
          ...group.cc.map((item) => ({ item, visibility: "CC" as const })),
        ].map(({ item, visibility }) => ({
          id: crypto.randomUUID(),
          userId: item.id,
          recipientName: item.name,
          recipientEmail: item.email,
          recipientRole: item.role,
          visibility,
        }));
        checkAbort();
        const created = await repo.createNotification(
          {
            id: crypto.randomUUID(),
            projectId: project.id,
            kind,
            cycleStart: planned.cycleStart,
            sequenceStart: planned.sequenceStart,
            dueDate: planned.dueDate,
            scheduledFor: planned.scheduledFor,
            dedupeKey: planned.dedupeKey,
            title: planned.title,
            body: planned.body,
            followupSnapshot: snapshotOf(core, project.status),
            runId,
          },
          deliveries,
          fence,
        );
        if (created) summary.created += 1;
        else summary.duplicates += 1;
      }
    }
    summary.evaluatedProjects = perProject.size;

    // Conciliação: resolve pendências já notificadas (só registra o motivo; nada é apagado nem reescrito).
    if (cutoff !== null) {
      const statusByProject = new Map(projects.map((item) => [item.id, item]));
      for (const open of await repo.listOpenNotifications()) {
        checkAbort();
        const project = statusByProject.get(open.projectId);
        if (!project) continue;
        const { core, validations } = await evaluate(project);
        const decision = resolutionFor(open, { core, validations, now });
        if (!decision) continue;
        summary.resolved.push({ notificationId: open.id, reason: decision.reason });
        if (mode === "ACTIVE") {
          await repo.resolveNotification(open.id, { reason: decision.reason, validationId: decision.validationId, runId, at: now }, fence);
        }
      }
    }

    summary.issues = [...issueMap.entries()].map(([dedupeKey, value]) => ({ kind: value.kind, dedupeKey }));
    // Ocorrências que deixaram de existir: calendário quando o ano foi validado; configuração quando não é mais reportada.
    // As do agendador (SCHEDULER_FAILURE) ficam de fora: só o próprio agendador as resolve, após a recuperação efetiva.
    const validated = await deps.validatedCalendarYears();
    const openIssues = (await repo.listIssues({ open: true, limit: 1000 })).filter((item) => !SCHEDULER_ISSUE_KINDS.has(item.kind));
    const openKeys = new Set(openIssues.map((item) => item.dedupeKey));
    const gone = (open: (typeof openIssues)[number]) =>
      open.kind === "CALENDAR_NOT_VALIDATED" ? open.year !== null && validated.has(open.year) : !issueMap.has(open.dedupeKey);
    summary.issueChanges = [...issueMap.keys()].filter((key) => !openKeys.has(key)).length + openIssues.filter(gone).length;

    if (mode === "ACTIVE") {
      for (const [dedupeKey, value] of issueMap) {
        checkAbort();
        await repo.upsertIssue({ id: crypto.randomUUID(), kind: value.kind, dedupeKey, year: value.year, details: value.details }, now, fence);
      }
      for (const open of openIssues) {
        if (gone(open)) {
          checkAbort();
          await repo.resolveIssue(open.id, { resolution: "AUTO", resolvedBy: null, note: null, at: now }, fence);
        }
      }
    }
    return summary;
  };

  const persist = options.persistRun !== false;

  if (mode === "DRY_RUN") {
    const run = persist ? await newRun() : null;
    try {
      const summary = await execute(run?.id ?? "dry-run");
      if (run) await finish(repo, run.id, summary);
      return { runId: run?.id ?? null, status: "COMPLETED", summary };
    } catch (error) {
      if (run) await failRun(repo, run.id, error);
      throw error;
    }
  }

  // Geração real: a linha da execução e a conciliação de órfãs só acontecem com a trava global em mãos.
  let runId: string | null = null;
  try {
    const locked = await repo.withGlobalLock(async () => {
      const run = await newRun();
      runId = run.id;
      await repo.failOrphanRuns(run.id, now);
      const summary = await execute(run.id);
      await finish(repo, run.id, summary);
      return summary;
    });
    if (!locked.acquired) {
      if (options.recordSkipped === false) return { runId: null, status: "SKIPPED_LOCKED", summary: null };
      const skipped = await newRun();
      await repo.updateRun(skipped.id, { status: "SKIPPED_LOCKED", finishedAt: new Date(), summary: { note: "Outra execução em andamento." } });
      return { runId: skipped.id, status: "SKIPPED_LOCKED", summary: null };
    }
    return { runId, status: "COMPLETED", summary: locked.value };
  } catch (error) {
    if (runId) await failRun(repo, runId, error);
    throw error;
  }
}

async function failRun(repo: NotificationRepository, runId: string, error: unknown) {
  const message = error instanceof LeaseLostError ? `ABORTADA: ${error.message}` : String(error instanceof Error ? error.message : error);
  try {
    await repo.updateRun(runId, { status: "FAILED", finishedAt: new Date(), error: message.slice(0, 500) });
  } catch {
    // Banco indisponível: o erro original segue para quem chamou (e para o log).
  }
}

async function finish(repo: NotificationRepository, runId: string, summary: GeneratorSummary) {
  await repo.updateRun(runId, {
    status: "COMPLETED",
    finishedAt: new Date(),
    createdNotifications: summary.created,
    resolvedNotifications: summary.resolved.length,
    issuesSeen: summary.issues.length,
    evaluatedProjects: summary.evaluatedProjects,
    summary: summary as unknown as Record<string, unknown>,
  });
}

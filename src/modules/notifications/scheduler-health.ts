import type { SchedulerSnapshot } from "./scheduler.repository";

/**
 * Saúde do agendador, derivada só de batimentos e resultados gravados (nunca de uma configuração "habilitada").
 * Estado técnico (o agendador) e estado operacional (as notificações) são independentes:
 * batimentos saudáveis com notificações desativadas = FUNCIONANDO com operação DESATIVADA.
 */
export type TechnicalState = "FUNCIONANDO" | "EM_FALHA" | "SEM_SINAL" | "DESLIGADO" | "DESCONHECIDO";
export type OperationalState = "ATIVADAS" | "DESATIVADAS";

/** Uma instância sem batimento há mais que isto é considerada sem sinal (o batimento é enviado a cada 60 s). */
export const LIVE_SECONDS = 300;
/** Sem tick bem-sucedido por tantos intervalos, o agendador está travado. */
export const STALL_INTERVALS = 3;

export type SchedulerHealth = {
  technicalState: TechnicalState;
  operationalState: OperationalState;
  reasons: string[];
};

export function deriveSchedulerHealth(snapshot: SchedulerSnapshot | null): SchedulerHealth {
  if (snapshot === null) {
    return { technicalState: "DESCONHECIDO", operationalState: "DESATIVADAS", reasons: ["NO_DATA"] };
  }
  const operationalState: OperationalState = snapshot.activationEnabled ? "ATIVADAS" : "DESATIVADAS";
  const live = snapshot.instances.filter((item) => item.stoppedAgeSeconds === null && item.lastSeenAgeSeconds <= LIVE_SECONDS);
  const state = snapshot.state;

  if (live.length > 0) {
    const interval = Math.max(...live.map((item) => item.intervalSeconds));
    const staleLimit = STALL_INTERVALS * interval;
    const reasons: string[] = [];
    if (state && (state.consecutiveFailures > 0 || state.lastStatus === "FAILED")) reasons.push("TICK_FAILING");
    const sinceLastSuccess = state?.lastSuccessAgeSeconds ?? null;
    if (sinceLastSuccess === null) {
      const youngest = Math.min(...live.map((item) => item.startedAgeSeconds));
      if (youngest > staleLimit) reasons.push("NO_SUCCESSFUL_TICK");
    } else if (sinceLastSuccess > staleLimit) {
      reasons.push("TICK_STALLED");
    }
    if (reasons.length > 0) return { technicalState: "EM_FALHA", operationalState, reasons };
    return { technicalState: "FUNCIONANDO", operationalState, reasons: sinceLastSuccess === null ? ["WAITING_FIRST_TICK"] : [] };
  }

  const seen = snapshot.instances[0];
  if (!seen) {
    return state?.lastSuccessAgeSeconds != null
      ? { technicalState: "SEM_SINAL", operationalState, reasons: ["NO_HEARTBEAT"] }
      : { technicalState: "DESCONHECIDO", operationalState, reasons: ["NO_DATA"] };
  }
  const gracefulStop = seen.stoppedAgeSeconds !== null;
  if (gracefulStop && !snapshot.activationEnabled) {
    return { technicalState: "DESLIGADO", operationalState, reasons: ["GRACEFUL_STOP"] };
  }
  return { technicalState: "SEM_SINAL", operationalState, reasons: [gracefulStop ? "STOPPED_WHILE_ACTIVE" : "NO_HEARTBEAT"] };
}

import type { EapMilestoneDeliveryRow } from "../dtos/eap-milestone-deliveries.dto";
import type { EapMilestoneRow } from "../dtos/eap-milestones.dto";
import type { EapPhaseRow } from "../dtos/eap-phases.dto";
import type { EapTaskRow } from "../dtos/eap-tasks.dto";
import { calculatedTaskStatus, civilDayKey } from "./eap-status";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Diferença em dias corridos entre duas datas civis (`YYYY-MM-DD`). */
export function dayDiff(laterKey: string, earlierKey: string) {
  return Math.round((Date.parse(`${laterKey}T00:00:00Z`) - Date.parse(`${earlierKey}T00:00:00Z`)) / DAY_MS);
}

/**
 * Data da entrega em análise: a rodada mais recente; em marcos legados, a data efetiva gravada no envio.
 * Fonte única da data de entrega de um marco já entregue.
 */
export function latestDelivery(
  milestone: Pick<EapMilestoneRow, "id" | "actualAt">,
  deliveries: ReadonlyArray<Pick<EapMilestoneDeliveryRow, "milestoneId" | "submittedAt">>,
) {
  const submitted = deliveries
    .filter((delivery) => delivery.milestoneId === milestone.id && delivery.submittedAt)
    .map((delivery) => delivery.submittedAt as Date)
    .sort((left, right) => right.getTime() - left.getTime())[0];
  return submitted ?? milestone.actualAt ?? null;
}

export type DelayedItem = {
  entityType: "TASK" | "MILESTONE";
  entityId: string;
  /** Dias corridos de atraso: até hoje (item aberto) ou até a entrega (marco entregue fora do prazo). */
  days: number;
  /** OPEN_OVERDUE: ainda depende da execução e o prazo vigente passou. DELIVERED_LATE: marco entregue depois do prazo. */
  reason: "OPEN_OVERDUE" | "DELIVERED_LATE";
};

export type EapDelays = {
  /** Itens executáveis em atraso (tarefas e marcos), na ordem da EAP. Fases nunca entram. */
  items: DelayedItem[];
  /** Maior atraso, em dias corridos (0 sem atraso). */
  delayDays: number;
  /** Marcos entregues sem data de entrega conhecida: não dá para julgar o prazo, então ficam de fora e sinalizados. */
  undatedDeliveries: number;
  /** Se o item é contado como atraso de execução pela regra única. */
  isDelayed: (entityType: "TASK" | "MILESTONE", entityId: string) => boolean;
};

/**
 * REGRA ÚNICA DE ATRASO. Todo número de "itens em atraso" do sistema (Situação atual, status do projeto, Resumo
 * executivo, Planejamento e monitoramento de prazos) vem desta função.
 *
 * Contam como atraso de execução, sobre o prazo vigente:
 * - tarefa aberta (não concluída nem cancelada) com o prazo vencido;
 * - marco pendente, rejeitado ou com ajustes solicitados, com o prazo vencido;
 * - marco entregue somente quando a entrega ocorreu depois do prazo vigente (conta o atraso até a entrega).
 *
 * Não contam: marco entregue dentro do prazo e aguardando homologação (fica no indicador de homologações pendentes),
 * marco aprovado, itens sem prazo, itens de fase suspensa e as fases em si. O atraso de uma fase é o de seus itens
 * executáveis; contar a fase e os itens ao mesmo tempo duplicaria o indicador.
 */
export function eapDelays(input: {
  phases: ReadonlyArray<Pick<EapPhaseRow, "id" | "status">>;
  tasks: ReadonlyArray<EapTaskRow>;
  milestones: ReadonlyArray<EapMilestoneRow>;
  deliveries: ReadonlyArray<Pick<EapMilestoneDeliveryRow, "milestoneId" | "submittedAt">>;
  now?: Date;
}): EapDelays {
  const today = civilDayKey(input.now ?? new Date());
  const suspendedPhases = new Set(input.phases.filter((phase) => phase.status === "SUSPENSA").map((phase) => phase.id));
  const items: DelayedItem[] = [];
  let undatedDeliveries = 0;

  for (const task of input.tasks) {
    const status = calculatedTaskStatus(task);
    if (suspendedPhases.has(task.phaseId) || status === "CONCLUIDA" || status === "CANCELADA" || !task.plannedEndAt) {
      continue;
    }
    const days = dayDiff(today, civilDayKey(task.plannedEndAt));
    if (days > 0) {
      items.push({ entityType: "TASK", entityId: task.id, days, reason: "OPEN_OVERDUE" });
    }
  }

  for (const milestone of input.milestones) {
    if (suspendedPhases.has(milestone.phaseId) || milestone.status === "APROVADO" || !milestone.plannedAt) {
      continue;
    }
    const planned = civilDayKey(milestone.plannedAt);
    if (milestone.status === "ENTREGUE") {
      const delivered = latestDelivery(milestone, input.deliveries);
      if (!delivered) {
        undatedDeliveries += 1;
        continue;
      }
      const days = dayDiff(civilDayKey(delivered), planned);
      if (days > 0) {
        items.push({ entityType: "MILESTONE", entityId: milestone.id, days, reason: "DELIVERED_LATE" });
      }
      continue;
    }
    // Pendente, rejeitado ou com ajustes solicitados: a entrega (ou a correção) cabe à execução.
    const days = dayDiff(today, planned);
    if (days > 0) {
      items.push({ entityType: "MILESTONE", entityId: milestone.id, days, reason: "OPEN_OVERDUE" });
    }
  }

  const delayed = new Set(items.map((item) => `${item.entityType}:${item.entityId}`));
  return {
    items,
    delayDays: items.reduce((largest, item) => Math.max(largest, item.days), 0),
    undatedDeliveries,
    isDelayed: (entityType, entityId) => delayed.has(`${entityType}:${entityId}`),
  };
}

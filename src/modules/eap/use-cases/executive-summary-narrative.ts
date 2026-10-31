import type { EapAuditEntryDto } from "../dtos/eap-audit.dto";
import type { EapScheduleMonitoringDto } from "../dtos/eap-schedule.dto";
import type { ExecutiveSummaryDto } from "../schemas/eap-executive-summary.schema";

type SituationStatus = ExecutiveSummaryDto["situation"]["status"];

/** Mesmos rótulos exibidos na tela (project-status.ts do frontend). */
export const SITUATION_LABEL: Record<SituationStatus, string> = {
  NAO_INICIADO: "Não iniciado",
  EM_EXECUCAO: "Em execução",
  EM_ATENCAO: "Em atenção",
  CRITICO: "Crítico",
  EM_VALIDACAO: "Em validação",
  CONCLUIDO: "Concluído",
  SUSPENSO: "Suspenso",
};

/** Quantas próximas entregas e movimentações o resumo traz. */
export const NEXT_DELIVERIES_LIMIT = 3;
export const MOVEMENTS_LIMIT = 5;

/**
 * Movimentações que contam para a leitura executiva: mudanças de situação, conclusão, impedimentos, entregas,
 * homologação, reprogramação e troca de responsável. Ajustes de andamento, edições e criações ficam de fora.
 */
const RELEVANT_KINDS = new Set<string>([
  "CANCELLATION",
  "REACTIVATION",
  "STATUS",
  "COMPLETION",
  "REOPENING",
  "IMPEDIMENT_OPENED",
  "IMPEDIMENT_RESOLVED",
  "DELIVERY",
  "ACCEPTANCE",
  "ADJUSTMENTS_REQUESTED",
  "REJECTION",
  "RESCHEDULE",
  "PLANNING_DEFINED",
  "OWNER_TRANSFERRED",
]);

export function relevantMovements(entries: ReadonlyArray<EapAuditEntryDto>) {
  return entries
    .filter((entry) => RELEVANT_KINDS.has(entry.details.kind))
    .slice(0, MOVEMENTS_LIMIT)
    .map((entry) => ({
      id: entry.id,
      at: entry.createdAt,
      actorName: entry.actorName,
      kind: entry.details.kind,
      automatic: entry.details.automatic,
      summary: entry.summary,
    }));
}

/**
 * Próximas entregas: marcos ainda a entregar (pendentes ou devolvidos), do prazo mais próximo ao mais distante. É a
 * mesma regra do indicador "Próxima entrega" (nextDeliveryFrom, no frontend), estendida a mais de um marco.
 */
export function nextDeliveriesFrom(
  items: ReadonlyArray<EapScheduleMonitoringDto["items"][number]>,
  phaseNames: ReadonlyMap<string, string>,
) {
  return items
    .filter((item) => item.entityType === "MILESTONE" && item.status !== "APROVADO" && item.status !== "ENTREGUE" && item.plannedEndAt)
    .sort((left, right) => (left.plannedEndAt as string).localeCompare(right.plannedEndAt as string))
    .slice(0, NEXT_DELIVERIES_LIMIT)
    .map((item) => ({
      id: item.entityId,
      title: item.title,
      plannedAt: item.plannedEndAt as string,
      overdue: item.overdue,
      corrections: item.status === "REJEITADO" || item.status === "AJUSTES_SOLICITADOS",
      phaseId: item.phaseId,
      phaseName: phaseNames.get(item.phaseId) ?? null,
    }));
}

function plural(count: number, one: string, many: string) {
  return count === 1 ? one : many;
}

/** Data civil no fuso de Belém, como no restante da aplicação. */
export function formatCivilDate(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Belem", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
}

function formatPercent(basisPoints: number) {
  return `${(Math.round(basisPoints / 10) / 10).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

/**
 * Narrativa objetiva: uma frase por indicador, com modelos fixos. Só repete números e datas já calculados;
 * não explica causas, riscos nem impactos.
 */
export function buildNarrative(summary: Omit<ExecutiveSummaryDto, "narrative">) {
  if (!summary.hasData) {
    return [
      {
        key: "no-data",
        text: "O projeto ainda não tem fases com tarefas ou marcos cadastrados; não há dados suficientes para gerar a síntese.",
      },
    ];
  }

  const lines: Array<{ key: string; text: string }> = [];
  const { situation, progress, overdue, homologation, reschedules } = summary;

  lines.push({
    key: "situation",
    text:
      situation.delayDays > 0 && (situation.status === "EM_ATENCAO" || situation.status === "CRITICO")
        ? `Situação atual: ${SITUATION_LABEL[situation.status]}, com o maior atraso em ${situation.delayDays} ${plural(situation.delayDays, "dia", "dias")}.`
        : `Situação atual: ${SITUATION_LABEL[situation.status]}.`,
  });

  lines.push({
    key: "progress",
    text:
      progress.basisPoints === null
        ? "Progresso consolidado: indisponível, pois nenhuma fase tem itens elegíveis para o cálculo."
        : `Progresso consolidado: ${formatPercent(progress.basisPoints)} (${progress.phasesCalculated} de ${progress.phasesTotal} ${plural(progress.phasesTotal, "fase calculada", "fases calculadas")}).`,
  });

  lines.push({
    key: "overdue",
    text:
      overdue.total === 0
        ? "Nenhum item em atraso."
        : `${overdue.total} ${plural(overdue.total, "item em atraso", "itens em atraso")}: ${overdue.phases} ${plural(overdue.phases, "fase", "fases")}, ${overdue.tasks} ${plural(overdue.tasks, "tarefa", "tarefas")} e ${overdue.milestones} ${plural(overdue.milestones, "marco", "marcos")}.`,
  });

  lines.push({
    key: "impediments",
    text:
      summary.impediments === 0
        ? "Nenhum impedimento registrado."
        : `${summary.impediments} ${plural(summary.impediments, "tarefa com impedimento registrado", "tarefas com impedimento registrado")}.`,
  });

  lines.push({
    key: "reschedules",
    text:
      reschedules.total === 0
        ? "Nenhuma reprogramação registrada."
        : `${reschedules.total} ${plural(reschedules.total, "reprogramação registrada", "reprogramações registradas")}${
            reschedules.escalated > 0 ? `, ${reschedules.escalated} ${plural(reschedules.escalated, "escalonada", "escalonadas")} ao PMO` : ""
          }.`,
  });

  const pendingHomologation = homologation.awaiting + homologation.inCorrections;
  lines.push({
    key: "homologation",
    text:
      pendingHomologation === 0
        ? "Nenhuma entrega aguardando homologação."
        : `${homologation.awaiting} ${plural(homologation.awaiting, "entrega aguardando homologação", "entregas aguardando homologação")}${
            homologation.inCorrections > 0
              ? ` e ${homologation.inCorrections} ${plural(homologation.inCorrections, "em correção", "em correção")}`
              : ""
          }.`,
  });

  const [next] = summary.nextDeliveries;
  lines.push({
    key: "next-delivery",
    text: next
      ? `Próxima entrega: ${next.title}, prevista para ${formatCivilDate(next.plannedAt)}${next.overdue ? " (prazo vencido)" : ""}.`
      : "Nenhuma entrega futura prevista.",
  });

  return lines;
}

import { createHash } from "node:crypto";

import type { ExecutiveSummarySnapshotDto } from "../schemas/eap-executive-summary.schema";

/** JSON com chaves em ordem fixa: o mesmo conteúdo sempre gera o mesmo texto. */
function stable(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stable).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Impressão digital do conteúdo relevante do resumo. Ignora o que é volátil (hora de geração e a narrativa, que é
 * derivada dos mesmos números) e considera os indicadores, as próximas entregas e as movimentações relevantes.
 */
export function executiveSummaryFingerprint(summary: Omit<ExecutiveSummarySnapshotDto, "narrative" | "generatedAt">) {
  const content = {
    hasData: summary.hasData,
    situation: summary.situation,
    progress: summary.progress,
    overdue: summary.overdue,
    impediments: summary.impediments,
    reschedules: summary.reschedules,
    homologation: summary.homologation,
    nextDeliveries: summary.nextDeliveries.map((item) => ({
      id: item.id,
      plannedAt: item.plannedAt,
      overdue: item.overdue,
      corrections: item.corrections,
    })),
    movements: summary.movements.map((item) => item.id),
  };
  return createHash("sha256").update(stable(content)).digest("hex");
}

import type { DeliveryItemStatus } from "../repositories/delivery-compliance.contract";

type ConformityItem = { id: string; title: string; required: boolean; status: DeliveryItemStatus };

export type DeliveryConformity = {
  total: number;
  required: number;
  approved: number;
  dispensed: number;
  /** Itens enviados que ainda aguardam a validação. */
  awaitingValidation: number;
  pending: number;
  rejected: number;
  /** Todos os documentos obrigatórios estão aprovados ou formalmente dispensados. */
  conforming: boolean;
  /** Obrigatórios que impedem a conformidade: pendentes, enviados sem validação ou rejeitados. */
  blockingItems: Array<{ id: string; title: string; status: DeliveryItemStatus }>;
};

/**
 * Conformidade documental de uma versão de entrega. Regra única, usada pela consulta, pela homologação e pelo encerramento:
 * a versão está conforme quando todo documento OBRIGATÓRIO está aprovado ou dispensado. Pendente, enviado (ainda sem validação)
 * e rejeitado bloqueiam. Itens opcionais não bloqueiam, mesmo pendentes ou rejeitados.
 */
export function computeConformity(items: ReadonlyArray<ConformityItem>): DeliveryConformity {
  const count = (status: DeliveryItemStatus) => items.filter((item) => item.status === status).length;
  const blocking = items.filter((item) => item.required && item.status !== "APROVADO" && item.status !== "DISPENSADO");
  return {
    total: items.length,
    required: items.filter((item) => item.required).length,
    approved: count("APROVADO"),
    dispensed: count("DISPENSADO"),
    awaitingValidation: count("ENVIADO"),
    pending: count("PENDENTE"),
    rejected: count("REJEITADO"),
    conforming: blocking.length === 0,
    blockingItems: blocking.map((item) => ({ id: item.id, title: item.title, status: item.status })),
  };
}

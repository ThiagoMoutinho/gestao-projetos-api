/**
 * Contrato do repositório da Conformidade de Entrega (modelos de checklist, versões de entrega, itens e histórico).
 * As rodadas de avaliação do marco continuam em `eap_milestone_deliveries`; aqui só há o vínculo com a versão.
 */

export const DELIVERY_NATURES = ["SISTEMAS", "INFRAESTRUTURA", "PROCESSOS"] as const;
export type DeliveryNature = (typeof DELIVERY_NATURES)[number];

export type ChecklistTemplateRow = { id: string; nature: DeliveryNature; name: string };

export type ChecklistTemplateItemRow = {
  id: string;
  revisionId: string;
  position: number;
  documentType: string;
  title: string;
  description: string | null;
  required: boolean;
};

export type ChecklistRevisionRow = {
  id: string;
  templateId: string;
  nature: DeliveryNature;
  revision: number;
  status: "RASCUNHO" | "PUBLICADA";
  /** Proposta sujeita à validação da CTIN. */
  isProposal: boolean;
  sourceNote: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: Date;
  publishedBy: string | null;
  publishedAt: Date | null;
};

export type ChecklistRevisionWithItems = ChecklistRevisionRow & { items: ChecklistTemplateItemRow[] };

export type ChecklistItemInput = {
  documentType: string;
  title: string;
  description: string | null;
  required: boolean;
};

export type SaveChecklistDraftInput = {
  nature: DeliveryNature;
  actorId: string;
  notes: string | null;
  isProposal: boolean;
  sourceNote: string | null;
  items: ChecklistItemInput[];
  now: Date;
};

export interface DeliveryComplianceRepository {
  listTemplates(): Promise<ChecklistTemplateRow[]>;
  /** Revisões do modelo, da mais nova para a mais antiga (sem os itens). */
  listRevisions(nature: DeliveryNature): Promise<ChecklistRevisionRow[]>;
  getRevision(revisionId: string): Promise<ChecklistRevisionWithItems | null>;
  getLatestPublished(nature: DeliveryNature): Promise<ChecklistRevisionWithItems | null>;
  getDraft(nature: DeliveryNature): Promise<ChecklistRevisionWithItems | null>;
  /** Cria o rascunho do modelo ou substitui o conteúdo do rascunho existente (revisão publicada nunca é alterada). */
  saveDraft(input: SaveChecklistDraftInput): Promise<ChecklistRevisionWithItems>;
  /** Publica o rascunho (somente se existir); a revisão publicada passa a ser imutável. */
  publishDraft(nature: DeliveryNature, actorId: string, now: Date): Promise<ChecklistRevisionWithItems | null>;
}

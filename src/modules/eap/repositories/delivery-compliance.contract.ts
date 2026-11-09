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

export const DELIVERY_ITEM_STATUSES = ["PENDENTE", "ENVIADO", "APROVADO", "REJEITADO", "DISPENSADO"] as const;
export type DeliveryItemStatus = (typeof DELIVERY_ITEM_STATUSES)[number];

export const DELIVERY_EVIDENCE_KINDS = ["SHAREPOINT", "GITLAB_TAG", "GITLAB_RELEASE", "OUTRO"] as const;
export type DeliveryEvidenceKind = (typeof DELIVERY_EVIDENCE_KINDS)[number];

/** Versão lógica do produto ou solução (1.0, 1.1, 2.0); não é a rodada de avaliação do marco. */
export type DeliveryVersionRow = {
  id: string;
  projectId: string;
  versionLabel: string;
  nature: DeliveryNature;
  templateRevisionId: string;
  notes: string | null;
  createdBy: string;
  createdAt: Date;
};

export type DeliveryVersionItemRow = {
  id: string;
  versionId: string;
  templateItemId: string | null;
  position: number;
  documentType: string;
  title: string;
  description: string | null;
  required: boolean;
  status: DeliveryItemStatus;
  evidenceKind: DeliveryEvidenceKind | null;
  evidenceRef: string | null;
  submittedBy: string | null;
  submittedAt: Date | null;
  validatorId: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
};

export type CreateDeliveryVersionInput = {
  projectId: string;
  versionLabel: string;
  nature: DeliveryNature;
  /** Revisão publicada do modelo cujos itens são copiados para a versão. */
  revision: ChecklistRevisionWithItems;
  notes: string | null;
  createdBy: string;
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

  /** Versões de entrega do projeto, da mais recente para a mais antiga. */
  listVersions(projectId: string): Promise<DeliveryVersionRow[]>;
  getVersion(versionId: string): Promise<DeliveryVersionRow | null>;
  findVersionByLabel(projectId: string, versionLabel: string): Promise<DeliveryVersionRow | null>;
  /** Cria a versão e copia para ela os itens da revisão do modelo (a cópia é independente do modelo). */
  createVersion(input: CreateDeliveryVersionInput): Promise<{ version: DeliveryVersionRow; items: DeliveryVersionItemRow[] }>;
  listItems(versionIds: string[]): Promise<DeliveryVersionItemRow[]>;
  /** Quantidade de rodadas de avaliação (eap_milestone_deliveries) ligadas a cada versão. */
  countRoundsByVersion(versionIds: string[]): Promise<Record<string, number>>;
}

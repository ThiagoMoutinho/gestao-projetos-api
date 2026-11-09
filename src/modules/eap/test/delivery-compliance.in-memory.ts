import type {
  ChecklistRevisionRow,
  ChecklistRevisionWithItems,
  ChecklistTemplateItemRow,
  ChecklistTemplateRow,
  CreateDeliveryVersionInput,
  DecideDeliveryItemInput,
  DeliveryComplianceRepository,
  DeliveryItemEventRow,
  DeliveryNature,
  DeliveryVersionItemRow,
  DeliveryVersionRow,
  SaveChecklistDraftInput,
  SubmitDeliveryItemInput,
} from "../repositories/delivery-compliance.contract";

/** Estado em memória da Conformidade de Entrega, usado pelos testes (com os modelos iniciais já publicados). */
export type DeliveryComplianceState = {
  templates: ChecklistTemplateRow[];
  revisions: ChecklistRevisionRow[];
  items: ChecklistTemplateItemRow[];
  versions: DeliveryVersionRow[];
  versionItems: DeliveryVersionItemRow[];
  itemEvents: DeliveryItemEventRow[];
  /** Rodadas ligadas a versões (deliveryVersionId); preenchido pelos testes de homologação. */
  roundsByVersion: Record<string, number>;
};

const NAMES: Record<DeliveryNature, string> = {
  SISTEMAS: "Sistemas e desenvolvimento de software",
  INFRAESTRUTURA: "Infraestrutura e tecnologia",
  PROCESSOS: "Processos e serviços",
};

/** Modelos publicados (revisão 1) com poucos itens: três obrigatórios e um opcional por natureza. */
export function createDeliveryComplianceState(seed?: Partial<DeliveryComplianceState>): DeliveryComplianceState {
  if (seed?.templates) {
    return {
      templates: seed.templates,
      revisions: seed.revisions ?? [],
      items: seed.items ?? [],
      versions: seed.versions ?? [],
      versionItems: seed.versionItems ?? [],
      itemEvents: seed.itemEvents ?? [],
      roundsByVersion: seed.roundsByVersion ?? {},
    };
  }
  const state: DeliveryComplianceState = { templates: [], revisions: [], items: [], versions: [], versionItems: [], itemEvents: [], roundsByVersion: {} };
  for (const nature of Object.keys(NAMES) as DeliveryNature[]) {
    const key = nature.toLowerCase();
    state.templates.push({ id: `tpl-${key}`, nature, name: NAMES[nature] });
    state.revisions.push({
      id: `rev-${key}-1`,
      templateId: `tpl-${key}`,
      nature,
      revision: 1,
      status: "PUBLICADA",
      isProposal: nature !== "SISTEMAS",
      sourceNote: null,
      notes: "Revisão inicial.",
      createdBy: null,
      createdAt: new Date("2026-01-01T12:00:00.000Z"),
      publishedBy: null,
      publishedAt: new Date("2026-01-01T12:00:00.000Z"),
    });
    const docs: Array<[string, string, boolean]> = [
      ["ESCOPO_CRITERIOS", "Escopo e critérios de aceite", true],
      ["PLANO_TESTES", "Plano de testes", true],
      ["DOCUMENTACAO", "Documentação pertinente", true],
      ["INTEGRACOES_DEPENDENCIAS", "Integrações e dependências", false],
    ];
    docs.forEach(([documentType, title, required], index) =>
      state.items.push({ id: `tpli-${key}-${index + 1}`, revisionId: `rev-${key}-1`, position: index + 1, documentType, title, description: null, required }),
    );
  }
  return state;
}

export function cloneDeliveryComplianceState(state: DeliveryComplianceState): DeliveryComplianceState {
  return {
    templates: state.templates.map((row) => ({ ...row })),
    revisions: state.revisions.map((row) => ({ ...row })),
    items: state.items.map((row) => ({ ...row })),
    versions: state.versions.map((row) => ({ ...row })),
    versionItems: state.versionItems.map((row) => ({ ...row })),
    itemEvents: state.itemEvents.map((row) => ({ ...row })),
    roundsByVersion: { ...state.roundsByVersion },
  };
}

export function restoreDeliveryComplianceState(target: DeliveryComplianceState, snapshot: DeliveryComplianceState) {
  target.templates.splice(0, target.templates.length, ...snapshot.templates);
  target.revisions.splice(0, target.revisions.length, ...snapshot.revisions);
  target.items.splice(0, target.items.length, ...snapshot.items);
  target.versions.splice(0, target.versions.length, ...snapshot.versions);
  target.versionItems.splice(0, target.versionItems.length, ...snapshot.versionItems);
  target.itemEvents.splice(0, target.itemEvents.length, ...snapshot.itemEvents);
  target.roundsByVersion = { ...snapshot.roundsByVersion };
}

export class InMemoryDeliveryComplianceRepository implements DeliveryComplianceRepository {
  constructor(
    private readonly state: DeliveryComplianceState,
    /** Rodadas reais (eap_milestone_deliveries) ligadas a cada versão. */
    private readonly countLinkedRounds: (versionId: string) => number = () => 0,
  ) {}

  async listTemplates() {
    return [...this.state.templates].sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
  }

  async listRevisions(nature: DeliveryNature) {
    return this.state.revisions.filter((row) => row.nature === nature).sort((left, right) => right.revision - left.revision);
  }

  private withItems(revision: ChecklistRevisionRow | undefined): ChecklistRevisionWithItems | null {
    if (!revision) return null;
    const items = this.state.items.filter((item) => item.revisionId === revision.id).sort((left, right) => left.position - right.position);
    return { ...revision, items: items.map((item) => ({ ...item })) };
  }

  async getRevision(revisionId: string) {
    return this.withItems(this.state.revisions.find((row) => row.id === revisionId));
  }

  async getLatestPublished(nature: DeliveryNature) {
    return this.withItems((await this.listRevisions(nature)).find((row) => row.status === "PUBLICADA"));
  }

  async getDraft(nature: DeliveryNature) {
    return this.withItems(this.state.revisions.find((row) => row.nature === nature && row.status === "RASCUNHO"));
  }

  async saveDraft(input: SaveChecklistDraftInput) {
    const template = this.state.templates.find((row) => row.nature === input.nature);
    if (!template) throw new Error(`Modelo de checklist inexistente: ${input.nature}`);
    let draft = this.state.revisions.find((row) => row.nature === input.nature && row.status === "RASCUNHO");
    if (draft) {
      draft.notes = input.notes;
      draft.isProposal = input.isProposal;
      draft.sourceNote = input.sourceNote;
      this.state.items = this.state.items.filter((item) => item.revisionId !== draft?.id);
      // `items` é reatribuído: mantém a mesma referência de array para quem já a guardou.
    } else {
      const latest = Math.max(0, ...this.state.revisions.filter((row) => row.nature === input.nature).map((row) => row.revision));
      draft = {
        id: crypto.randomUUID(),
        templateId: template.id,
        nature: input.nature,
        revision: latest + 1,
        status: "RASCUNHO",
        isProposal: input.isProposal,
        sourceNote: input.sourceNote,
        notes: input.notes,
        createdBy: input.actorId,
        createdAt: input.now,
        publishedBy: null,
        publishedAt: null,
      };
      this.state.revisions.push(draft);
    }
    const revisionId = draft.id;
    input.items.forEach((item, index) =>
      this.state.items.push({ id: crypto.randomUUID(), revisionId, position: index + 1, documentType: item.documentType, title: item.title, description: item.description, required: item.required }),
    );
    return this.withItems(draft) as ChecklistRevisionWithItems;
  }

  async publishDraft(nature: DeliveryNature, actorId: string, now: Date) {
    const draft = this.state.revisions.find((row) => row.nature === nature && row.status === "RASCUNHO");
    if (!draft) return null;
    draft.status = "PUBLICADA";
    draft.publishedBy = actorId;
    draft.publishedAt = now;
    return this.withItems(draft);
  }

  async listVersions(projectId: string) {
    return this.state.versions
      .filter((row) => row.projectId === projectId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.versionLabel.localeCompare(left.versionLabel));
  }

  async getVersion(versionId: string) {
    return this.state.versions.find((row) => row.id === versionId) ?? null;
  }

  async findVersionByLabel(projectId: string, versionLabel: string) {
    return this.state.versions.find((row) => row.projectId === projectId && row.versionLabel === versionLabel) ?? null;
  }

  async createVersion(input: CreateDeliveryVersionInput) {
    const version: DeliveryVersionRow = {
      id: crypto.randomUUID(),
      projectId: input.projectId,
      versionLabel: input.versionLabel,
      nature: input.nature,
      templateRevisionId: input.revision.id,
      notes: input.notes,
      createdBy: input.createdBy,
      createdAt: input.now,
    };
    this.state.versions.push(version);
    const items: DeliveryVersionItemRow[] = input.revision.items.map((item) => ({
      id: crypto.randomUUID(),
      versionId: version.id,
      templateItemId: item.id,
      position: item.position,
      documentType: item.documentType,
      title: item.title,
      description: item.description,
      required: item.required,
      status: "PENDENTE",
      evidenceKind: null,
      evidenceRef: null,
      submittedBy: null,
      submittedAt: null,
      validatorId: null,
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
    }));
    this.state.versionItems.push(...items);
    return { version, items: items.map((item) => ({ ...item })) };
  }

  async listItems(versionIds: string[]) {
    return this.state.versionItems
      .filter((item) => versionIds.includes(item.versionId))
      .sort((left, right) => left.versionId.localeCompare(right.versionId) || left.position - right.position)
      .map((item) => ({ ...item }));
  }

  async countRoundsByVersion(versionIds: string[]) {
    return Object.fromEntries(versionIds.map((id) => [id, (this.state.roundsByVersion[id] ?? 0) + this.countLinkedRounds(id)]));
  }

  async getItem(itemId: string) {
    const item = this.state.versionItems.find((row) => row.id === itemId);
    return item ? { ...item } : null;
  }

  async submitItem(itemId: string, data: SubmitDeliveryItemInput) {
    const item = this.state.versionItems.find((row) => row.id === itemId);
    if (!item || (item.status !== "PENDENTE" && item.status !== "REJEITADO")) return null;
    Object.assign(item, {
      status: "ENVIADO",
      evidenceKind: data.evidenceKind,
      evidenceRef: data.evidenceRef,
      submittedBy: data.submittedBy,
      submittedAt: data.submittedAt,
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
    });
    return { ...item };
  }

  async decideItem(itemId: string, data: DecideDeliveryItemInput) {
    const item = this.state.versionItems.find((row) => row.id === itemId);
    const allowed = data.status === "DISPENSADO" ? ["PENDENTE", "ENVIADO", "REJEITADO"] : ["ENVIADO"];
    if (!item || !allowed.includes(item.status)) return null;
    // Espelha as restrições do banco: quem enviou não valida o próprio envio.
    if (data.status === "APROVADO" && item.submittedBy === data.decidedBy) {
      throw new Error("delivery_item_self_approval_chk");
    }
    Object.assign(item, { status: data.status, decidedBy: data.decidedBy, decidedAt: data.decidedAt, decisionNote: data.decisionNote });
    return { ...item };
  }

  async setItemValidator(itemId: string, validatorId: string | null) {
    const item = this.state.versionItems.find((row) => row.id === itemId);
    if (!item) return null;
    item.validatorId = validatorId;
    return { ...item };
  }

  async addItemEvent(event: DeliveryItemEventRow) {
    this.state.itemEvents.push({ ...event });
  }

  async listItemEvents(itemId: string) {
    return this.state.itemEvents
      .filter((event) => event.itemId === itemId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map((event) => ({ ...event }));
  }
}

/**
 * Registra uma versão de entrega já conforme (todos os itens obrigatórios aprovados ou dispensados) para testes que precisam
 * homologar ou encerrar um projeto com fornecedor sem percorrer todo o fluxo documental.
 */
export function seedConformingVersion(state: DeliveryComplianceState, projectId: string, versionLabel = "1.0", createdAt = new Date("2026-02-01T12:00:00.000Z")) {
  const version: DeliveryVersionRow = {
    id: `ver-${projectId}-${versionLabel}`,
    projectId,
    versionLabel,
    nature: "SISTEMAS",
    templateRevisionId: "rev-sistemas-1",
    notes: null,
    createdBy: "seed",
    createdAt,
  };
  state.versions.push(version);
  state.items
    .filter((item) => item.revisionId === "rev-sistemas-1")
    .forEach((item) =>
      state.versionItems.push({
        id: `${version.id}-${item.position}`,
        versionId: version.id,
        templateItemId: item.id,
        position: item.position,
        documentType: item.documentType,
        title: item.title,
        description: item.description,
        required: item.required,
        status: item.required ? "APROVADO" : "PENDENTE",
        evidenceKind: item.required ? "SHAREPOINT" : null,
        evidenceRef: item.required ? "https://igepps.sharepoint.com/sites/ctin/documento" : null,
        submittedBy: item.required ? "seed-sender" : null,
        submittedAt: item.required ? createdAt : null,
        validatorId: null,
        decidedBy: item.required ? "seed-validator" : null,
        decidedAt: item.required ? createdAt : null,
        decisionNote: null,
      }),
    );
  return version;
}

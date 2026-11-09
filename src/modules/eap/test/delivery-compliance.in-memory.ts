import type {
  ChecklistRevisionRow,
  ChecklistRevisionWithItems,
  ChecklistTemplateItemRow,
  ChecklistTemplateRow,
  DeliveryComplianceRepository,
  DeliveryNature,
  SaveChecklistDraftInput,
} from "../repositories/delivery-compliance.contract";

/** Estado em memória da Conformidade de Entrega, usado pelos testes (com os modelos iniciais já publicados). */
export type DeliveryComplianceState = {
  templates: ChecklistTemplateRow[];
  revisions: ChecklistRevisionRow[];
  items: ChecklistTemplateItemRow[];
};

const NAMES: Record<DeliveryNature, string> = {
  SISTEMAS: "Sistemas e desenvolvimento de software",
  INFRAESTRUTURA: "Infraestrutura e tecnologia",
  PROCESSOS: "Processos e serviços",
};

/** Modelos publicados (revisão 1) com poucos itens: três obrigatórios e um opcional por natureza. */
export function createDeliveryComplianceState(seed?: Partial<DeliveryComplianceState>): DeliveryComplianceState {
  if (seed?.templates) {
    return { templates: seed.templates, revisions: seed.revisions ?? [], items: seed.items ?? [] };
  }
  const state: DeliveryComplianceState = { templates: [], revisions: [], items: [] };
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
  };
}

export function restoreDeliveryComplianceState(target: DeliveryComplianceState, snapshot: DeliveryComplianceState) {
  target.templates.splice(0, target.templates.length, ...snapshot.templates);
  target.revisions.splice(0, target.revisions.length, ...snapshot.revisions);
  target.items.splice(0, target.items.length, ...snapshot.items);
}

export class InMemoryDeliveryComplianceRepository implements DeliveryComplianceRepository {
  constructor(private readonly state: DeliveryComplianceState) {}

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
}

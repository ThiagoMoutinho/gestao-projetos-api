import {
  makeInMemoryRepos,
  type InMemoryStore,
} from "../../projects/test/in-memory";
import type { NewEapEvidenceRecord } from "../../eap/repositories/contracts";
import type {
  EvolutionRow,
  HighlightRow,
  InstitutionalRepos,
  InstitutionalRepository,
  InstitutionalTransactionRunner,
  ProfileField,
  ProfileFieldRow,
  ResultContent,
  ResultLinkRow,
  ResultRow,
  ResultType,
} from "../repositories/contracts";

export type MilestoneSeed = EvolutionRow & { projectId: string };

export type InstitutionalStore = {
  fields: ProfileFieldRow[];
  results: ResultRow[];
  highlights: HighlightRow[];
  milestones: MilestoneSeed[];
  evidences: Array<{ id: string; projectId: string | null; title: string; url: string; projectResultId?: string | null }>;
  links: ResultLinkRow[];
};

export function createInstitutionalStore(seed?: Partial<InstitutionalStore>): InstitutionalStore {
  return {
    fields: seed?.fields ?? [],
    results: seed?.results ?? [],
    highlights: seed?.highlights ?? [],
    milestones: seed?.milestones ?? [],
    evidences: seed?.evidences ?? [],
    links: seed?.links ?? [],
  };
}

const clearResultDraft = {
  draftText: null,
  draftResultDate: null,
  draftMilestoneId: null,
  draftDetails: null,
  draftBy: null,
  draftAt: null,
};

const clearCorrection = { correctionReason: null, correctionBy: null, correctionAt: null };

/** Espelha as regras do banco: promoção só com rascunho e validador diferente do autor. */
class InMemoryInstitutionalRepository implements InstitutionalRepository {
  constructor(private readonly store: InstitutionalStore) {}

  async listProfileFields(projectId: string) {
    return this.store.fields.filter((row) => row.projectId === projectId);
  }

  async findProfileField(projectId: string, field: ProfileField) {
    return this.store.fields.find((row) => row.projectId === projectId && row.field === field) ?? null;
  }

  async saveProfileDraft(data: { id: string; projectId: string; field: ProfileField; value: string; actorId: string; at: Date }) {
    const existing = await this.findProfileField(data.projectId, data.field);
    if (existing) {
      existing.draftValue = data.value;
      existing.draftBy = data.actorId;
      existing.draftAt = data.at;
      return existing;
    }
    const row: ProfileFieldRow = {
      id: data.id,
      projectId: data.projectId,
      field: data.field,
      publishedValue: null,
      publishedBy: null,
      publishedAt: null,
      validatedBy: null,
      validatedAt: null,
      draftValue: data.value,
      draftBy: data.actorId,
      draftAt: data.at,
    };
    this.store.fields.push(row);
    return row;
  }

  async publishProfileDirect(data: { id: string; projectId: string; field: ProfileField; value: string; actorId: string; at: Date }) {
    const published = {
      publishedValue: data.value,
      publishedBy: data.actorId,
      publishedAt: data.at,
      validatedBy: null,
      validatedAt: null,
      draftValue: null,
      draftBy: null,
      draftAt: null,
    };
    const existing = await this.findProfileField(data.projectId, data.field);
    if (existing) {
      return Object.assign(existing, published);
    }
    const row: ProfileFieldRow = { id: data.id, projectId: data.projectId, field: data.field, ...published };
    this.store.fields.push(row);
    return row;
  }

  async publishProfileDraft(row: ProfileFieldRow, validatorId: string, at: Date) {
    const current = this.store.fields.find((item) => item.id === row.id);
    if (!current || current.draftValue === null || current.draftBy === validatorId) {
      return null;
    }
    Object.assign(current, {
      publishedValue: current.draftValue,
      publishedBy: current.draftBy,
      publishedAt: current.draftAt,
      validatedBy: validatorId,
      validatedAt: at,
      draftValue: null,
      draftBy: null,
      draftAt: null,
    });
    return current;
  }

  async discardProfileDraft(row: ProfileFieldRow) {
    const current = this.store.fields.find((item) => item.id === row.id);
    if (!current) {
      return;
    }
    if (current.publishedValue === null) {
      this.store.fields.splice(this.store.fields.indexOf(current), 1);
      return;
    }
    Object.assign(current, { draftValue: null, draftBy: null, draftAt: null });
  }

  async listResults(projectId: string) {
    return this.store.results.filter((row) => row.projectId === projectId && row.archivedAt === null);
  }

  async findResult(projectId: string, resultId: string) {
    return this.store.results.find((row) => row.id === resultId && row.projectId === projectId) ?? null;
  }

  async createResult(data: {
    id: string;
    projectId: string;
    type: ResultType;
    content: ResultContent;
    direct: boolean;
    unforeseen: boolean;
    actorId: string;
    at: Date;
  }) {
    const published = data.direct
      ? {
          publishedText: data.content.text,
          publishedResultDate: data.content.resultDate,
          publishedMilestoneId: data.content.milestoneId,
          publishedDetails: data.content.details,
          publishedBy: data.actorId,
          publishedAt: data.at,
        }
      : {
          publishedText: null,
          publishedResultDate: null,
          publishedMilestoneId: null,
          publishedDetails: null,
          publishedBy: null,
          publishedAt: null,
        };
    const draft = data.direct
      ? clearResultDraft
      : {
          draftText: data.content.text,
          draftResultDate: data.content.resultDate,
          draftMilestoneId: data.content.milestoneId,
          draftDetails: data.content.details,
          draftBy: data.actorId,
          draftAt: data.at,
        };
    const row: ResultRow = {
      id: data.id,
      projectId: data.projectId,
      type: data.type,
      createdBy: data.actorId,
      createdAt: data.at,
      ...published,
      validatedBy: null,
      validatedAt: null,
      ...draft,
      unforeseen: data.unforeseen,
      ...clearCorrection,
      archivedBy: null,
      archivedAt: null,
    };
    this.store.results.push(row);
    return row;
  }

  async saveResultDraft(resultId: string, content: ResultContent, actorId: string, at: Date) {
    const row = this.store.results.find((item) => item.id === resultId && item.archivedAt === null);
    if (!row) {
      return null;
    }
    Object.assign(row, {
      draftText: content.text,
      draftResultDate: content.resultDate,
      draftMilestoneId: content.milestoneId,
      draftDetails: content.details,
      draftBy: actorId,
      draftAt: at,
      ...clearCorrection,
    });
    return row;
  }

  async publishResultDirect(resultId: string, content: ResultContent, actorId: string, at: Date) {
    const row = this.store.results.find((item) => item.id === resultId && item.archivedAt === null);
    if (!row) {
      return null;
    }
    Object.assign(row, {
      publishedText: content.text,
      publishedResultDate: content.resultDate,
      publishedMilestoneId: content.milestoneId,
      publishedDetails: content.details,
      publishedBy: actorId,
      publishedAt: at,
      validatedBy: null,
      validatedAt: null,
      ...clearResultDraft,
    });
    return row;
  }

  async publishResultDraft(row: ResultRow, validatorId: string, at: Date) {
    const current = this.store.results.find((item) => item.id === row.id);
    if (!current || current.archivedAt || current.draftText === null || current.draftBy === validatorId) {
      return null;
    }
    Object.assign(current, {
      publishedText: current.draftText,
      publishedResultDate: current.draftResultDate,
      publishedMilestoneId: current.draftMilestoneId,
      publishedDetails: current.draftDetails,
      publishedBy: current.draftBy,
      publishedAt: current.draftAt,
      validatedBy: validatorId,
      validatedAt: at,
      ...clearResultDraft,
      ...clearCorrection,
    });
    return current;
  }

  async requestResultCorrections(resultId: string, reason: string, actorId: string, at: Date) {
    const row = this.store.results.find((item) => item.id === resultId && item.archivedAt === null && item.draftText !== null);
    if (!row) {
      return null;
    }
    Object.assign(row, { correctionReason: reason, correctionBy: actorId, correctionAt: at });
    return row;
  }

  async setResultUnforeseen(resultId: string, unforeseen: boolean) {
    const row = this.store.results.find((item) => item.id === resultId);
    if (row) {
      row.unforeseen = unforeseen;
    }
  }

  async listResultLinks(projectId: string) {
    const ids = new Set(this.store.results.filter((row) => row.projectId === projectId).map((row) => row.id));
    return this.store.links.filter((link) => ids.has(link.achievedId));
  }

  async replaceResultLinks(achievedId: string, expectedIds: string[], actorId: string, at: Date) {
    this.store.links = this.store.links.filter((link) => link.achievedId !== achievedId);
    for (const expectedId of expectedIds) {
      this.store.links.push({ id: crypto.randomUUID(), achievedId, expectedId, linkedBy: actorId, linkedAt: at });
    }
  }

  async archiveResult(resultId: string, actorId: string, at: Date) {
    const row = this.store.results.find((item) => item.id === resultId && item.archivedAt === null);
    if (!row) {
      return null;
    }
    Object.assign(row, { archivedBy: actorId, archivedAt: at });
    return row;
  }

  async listHighlights(projectId: string) {
    return this.store.highlights.filter((row) => row.projectId === projectId);
  }

  async findHighlight(projectId: string, milestoneId: string) {
    return this.store.highlights.find((row) => row.projectId === projectId && row.milestoneId === milestoneId) ?? null;
  }

  async addHighlight(data: { id: string; projectId: string; milestoneId: string; actorId: string }) {
    const row: HighlightRow = {
      id: data.id,
      projectId: data.projectId,
      milestoneId: data.milestoneId,
      highlightedBy: data.actorId,
      highlightedAt: new Date(),
      sortOrder: this.store.highlights.filter((item) => item.projectId === data.projectId).length,
    };
    this.store.highlights.push(row);
    return row;
  }

  async removeHighlight(projectId: string, milestoneId: string) {
    const index = this.store.highlights.findIndex((row) => row.projectId === projectId && row.milestoneId === milestoneId);
    if (index < 0) {
      return false;
    }
    this.store.highlights.splice(index, 1);
    return true;
  }

  async findMilestoneInProject(projectId: string, milestoneId: string) {
    const milestone = this.store.milestones.find((row) => row.milestoneId === milestoneId && row.projectId === projectId);
    return milestone ? { id: milestone.milestoneId, title: milestone.title, status: milestone.status } : null;
  }

  async listApprovedMilestones(projectId: string) {
    return this.store.milestones.filter((row) => row.projectId === projectId && row.status === "APROVADO");
  }
}

export function makeInstitutionalTestRepos(projectStore: InMemoryStore, store: InstitutionalStore): InstitutionalRepos {
  return {
    ...makeInMemoryRepos(projectStore),
    institutional: new InMemoryInstitutionalRepository(store),
    evidences: {
      async listByProject(projectId: string) {
        const resultIds = new Set(store.results.filter((row) => row.projectId === projectId).map((row) => row.id));
        return store.evidences
          .filter((row) => row.projectId === projectId || (row.projectResultId && resultIds.has(row.projectResultId)))
          .map((row) => ({
            id: row.id,
            phaseId: null,
            taskId: null,
            milestoneId: null,
            scheduleRequestId: null,
            projectId: row.projectId,
            projectResultId: row.projectResultId ?? null,
            title: row.title,
            url: row.url,
            kind: null,
            ticketNumber: null,
            deliveryId: null,
            createdBy: "user",
            createdAt: new Date(),
          }));
      },
      async create(data: NewEapEvidenceRecord) {
        store.evidences.push({
          id: data.id,
          projectId: data.projectId ?? null,
          projectResultId: data.projectResultId ?? null,
          title: data.title,
          url: data.url,
        });
        return {
          id: data.id,
          phaseId: null,
          taskId: null,
          milestoneId: null,
          scheduleRequestId: null,
          projectId: data.projectId ?? null,
          projectResultId: data.projectResultId ?? null,
          title: data.title,
          url: data.url,
          deliveryId: null,
          kind: null,
          ticketNumber: null,
          createdBy: data.createdBy,
          createdAt: new Date(),
        };
      },
    },
  };
}

export function makeInstitutionalTestRunner(repos: InstitutionalRepos): InstitutionalTransactionRunner {
  return (fn) => fn(repos);
}

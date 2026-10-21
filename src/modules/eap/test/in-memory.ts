import { UniqueConstraintError } from "../../../lib/postgres-errors";
import type {
  ProjectMemberRow,
  ProjectRow,
  UserRow,
} from "../../projects/dtos/projects.dto";
import {
  makeInMemoryRepos,
  makeUser,
  type InMemoryStore as ProjectStore,
} from "../../projects/test/in-memory";
import type { EapEvidenceRow } from "../dtos/eap-evidences.dto";
import type { EapAuditLogRow, EapPhaseRow } from "../dtos/eap-phases.dto";
import type { EapMilestoneRow } from "../dtos/eap-milestones.dto";
import type { EapTaskRow } from "../dtos/eap-tasks.dto";
import type {
  EapAuditRepository,
  EapEvidencesRepository,
  EapEvidenceUpdateRecord,
  EapMilestonesRepository,
  EapMilestoneUpdateRecord,
  EapPhasesRepository,
  EapRepos,
  EapScheduleRequestsRepository,
  EapTasksRepository,
  EapTaskUpdateRecord,
  EapTransactionRunner,
  EvidenceParentFilter,
  NewEapAuditLogRecord,
  NewEapEvidenceRecord,
  NewEapMilestoneRecord,
  NewEapPhaseRecord,
  NewEapTaskRecord,
} from "../repositories/contracts";

export type EapScheduleRequestRef = { id: string; projectId: string };

export type EapInMemoryStore = ProjectStore & {
  phases: EapPhaseRow[];
  tasks: EapTaskRow[];
  milestones: EapMilestoneRow[];
  scheduleRequests: EapScheduleRequestRef[];
  evidences: EapEvidenceRow[];
  auditLogs: EapAuditLogRow[];
};

export function createEapInMemoryStore(
  seed?: Partial<EapInMemoryStore>,
): EapInMemoryStore {
  return {
    users: seed?.users ?? [],
    projects: seed?.projects ?? [],
    members: seed?.members ?? [],
    phases: seed?.phases ?? [],
    tasks: seed?.tasks ?? [],
    milestones: seed?.milestones ?? [],
    scheduleRequests: seed?.scheduleRequests ?? [],
    evidences: seed?.evidences ?? [],
    auditLogs: seed?.auditLogs ?? [],
  };
}

class InMemoryEapPhasesRepository implements EapPhasesRepository {
  constructor(private readonly store: EapInMemoryStore) {}

  async listByProject(projectId: string) {
    return this.store.phases
      .filter((row) => row.projectId === projectId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime());
  }

  async findById(phaseId: string) {
    return this.store.phases.find((row) => row.id === phaseId) ?? null;
  }

  async findByIdAndProject(phaseId: string, projectId: string) {
    return (
      this.store.phases.find((row) => row.id === phaseId && row.projectId === projectId) ??
      null
    );
  }

  async findMaxSortOrder(projectId: string) {
    const orders = this.store.phases
      .filter((row) => row.projectId === projectId)
      .map((row) => row.sortOrder);

    return orders.length > 0 ? Math.max(...orders) : null;
  }

  async create(data: NewEapPhaseRecord) {
    const duplicate = this.store.phases.some(
      (row) => row.projectId === data.projectId && row.sortOrder === data.sortOrder,
    );
    if (duplicate) {
      throw new UniqueConstraintError();
    }

    const now = new Date();
    const row: EapPhaseRow = {
      ...data,
      actualStartAt: null,
      actualEndAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.phases.push(row);
    return row;
  }

  async update(phaseId: string, projectId: string, data: { updatedBy: string; updatedAt: Date } & Partial<EapPhaseRow>) {
    const index = this.store.phases.findIndex(
      (row) => row.id === phaseId && row.projectId === projectId,
    );
    if (index < 0) {
      return null;
    }

    if (data.sortOrder !== undefined) {
      const duplicate = this.store.phases.some(
        (row) =>
          row.projectId === projectId &&
          row.sortOrder === data.sortOrder &&
          row.id !== phaseId,
      );
      if (duplicate) {
        throw new UniqueConstraintError();
      }
    }

    const updated: EapPhaseRow = {
      ...this.store.phases[index],
      ...data,
      updatedAt: data.updatedAt,
    };
    this.store.phases[index] = updated;
    return updated;
  }

  async replaceSortOrders(
    projectId: string,
    items: Array<{ phaseId: string; sortOrder: number }>,
    updatedBy: string,
    updatedAt: Date,
  ) {
    const current = await this.listByProject(projectId);
    const maxCurrent = current.reduce((maxValue, phase) => Math.max(maxValue, phase.sortOrder), -1);
    const maxTarget = items.reduce((maxValue, item) => Math.max(maxValue, item.sortOrder), -1);
    const tempBase = Math.max(maxCurrent, maxTarget) + 1;

    for (const [index, item] of items.entries()) {
      await this.update(item.phaseId, projectId, {
        sortOrder: tempBase + index,
        updatedBy,
        updatedAt,
      });
    }

    for (const item of items) {
      await this.update(item.phaseId, projectId, {
        sortOrder: item.sortOrder,
        updatedBy,
        updatedAt,
      });
    }

    return this.listByProject(projectId);
  }
}

class InMemoryEapTasksRepository implements EapTasksRepository {
  constructor(private readonly store: EapInMemoryStore) {}

  async listByPhase(phaseId: string) {
    return this.store.tasks
      .filter((row) => row.phaseId === phaseId)
      .sort(
        (a, b) =>
          a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime(),
      );
  }

  async findById(taskId: string) {
    return this.store.tasks.find((row) => row.id === taskId) ?? null;
  }

  async findByIdAndPhase(taskId: string, phaseId: string) {
    return (
      this.store.tasks.find((row) => row.id === taskId && row.phaseId === phaseId) ?? null
    );
  }

  async findMaxSortOrder(phaseId: string) {
    const orders = this.store.tasks
      .filter((row) => row.phaseId === phaseId)
      .map((row) => row.sortOrder);
    return orders.length === 0 ? null : Math.max(...orders);
  }

  async replaceSortOrders(
    phaseId: string,
    items: Array<{ taskId: string; sortOrder: number }>,
    updatedBy: string,
    updatedAt: Date,
  ) {
    const current = await this.listByPhase(phaseId);
    const maxCurrent = current.reduce((maxValue, task) => Math.max(maxValue, task.sortOrder), -1);
    const maxTarget = items.reduce((maxValue, item) => Math.max(maxValue, item.sortOrder), -1);
    const tempBase = Math.max(maxCurrent, maxTarget) + 1;
    const apply = (taskId: string, sortOrder: number) => {
      const row = this.store.tasks.find((item) => item.id === taskId && item.phaseId === phaseId);
      if (!row) {
        return;
      }
      row.sortOrder = sortOrder;
      row.updatedBy = updatedBy;
      row.updatedAt = updatedAt;
    };

    for (const [index, item] of items.entries()) {
      apply(item.taskId, tempBase + index);
    }
    for (const item of items) {
      apply(item.taskId, item.sortOrder);
    }

    return this.listByPhase(phaseId);
  }

  async create(data: NewEapTaskRecord) {
    const now = new Date();
    const row: EapTaskRow = {
      ...data,
      progressPercent: data.progressPercent,
      actualStartAt: null,
      actualEndAt: null,
      hasImpediment: false,
      createdAt: now,
      updatedAt: now,
    };
    this.store.tasks.push(row);
    return row;
  }

  async update(taskId: string, phaseId: string, data: EapTaskUpdateRecord) {
    const index = this.store.tasks.findIndex(
      (row) => row.id === taskId && row.phaseId === phaseId,
    );
    if (index < 0) {
      return null;
    }

    const updated: EapTaskRow = {
      ...this.store.tasks[index],
      ...data,
      updatedAt: data.updatedAt,
    };
    this.store.tasks[index] = updated;
    return updated;
  }
}

class InMemoryEapMilestonesRepository implements EapMilestonesRepository {
  constructor(private readonly store: EapInMemoryStore) {}

  async listByPhase(phaseId: string) {
    return this.store.milestones
      .filter((row) => row.phaseId === phaseId)
      .sort(
        (a, b) =>
          a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime(),
      );
  }

  async findById(milestoneId: string) {
    return this.store.milestones.find((row) => row.id === milestoneId) ?? null;
  }

  async findByIdAndPhase(milestoneId: string, phaseId: string) {
    return (
      this.store.milestones.find(
        (row) => row.id === milestoneId && row.phaseId === phaseId,
      ) ?? null
    );
  }

  async findMaxSortOrder(phaseId: string) {
    const orders = this.store.milestones
      .filter((row) => row.phaseId === phaseId)
      .map((row) => row.sortOrder);
    return orders.length === 0 ? null : Math.max(...orders);
  }

  async replaceSortOrders(
    phaseId: string,
    items: Array<{ milestoneId: string; sortOrder: number }>,
    updatedBy: string,
    updatedAt: Date,
  ) {
    const current = await this.listByPhase(phaseId);
    const maxCurrent = current.reduce((maxValue, milestone) => Math.max(maxValue, milestone.sortOrder), -1);
    const maxTarget = items.reduce((maxValue, item) => Math.max(maxValue, item.sortOrder), -1);
    const tempBase = Math.max(maxCurrent, maxTarget) + 1;
    const apply = (milestoneId: string, sortOrder: number) => {
      const row = this.store.milestones.find((item) => item.id === milestoneId && item.phaseId === phaseId);
      if (!row) {
        return;
      }
      row.sortOrder = sortOrder;
      row.updatedBy = updatedBy;
      row.updatedAt = updatedAt;
    };

    for (const [index, item] of items.entries()) {
      apply(item.milestoneId, tempBase + index);
    }
    for (const item of items) {
      apply(item.milestoneId, item.sortOrder);
    }

    return this.listByPhase(phaseId);
  }

  async create(data: NewEapMilestoneRecord) {
    const now = new Date();
    const row: EapMilestoneRow = {
      ...data,
      actualAt: null,
      deliveredBy: null,
      validatedBy: null,
      validationNote: null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.milestones.push(row);
    return row;
  }

  async update(milestoneId: string, phaseId: string, data: EapMilestoneUpdateRecord) {
    const index = this.store.milestones.findIndex(
      (row) => row.id === milestoneId && row.phaseId === phaseId,
    );
    if (index < 0) {
      return null;
    }

    const updated: EapMilestoneRow = {
      ...this.store.milestones[index],
      ...data,
      updatedAt: data.updatedAt,
    };
    this.store.milestones[index] = updated;
    return updated;
  }
}

class InMemoryEapScheduleRequestsRepository implements EapScheduleRequestsRepository {
  constructor(private readonly store: EapInMemoryStore) {}

  async findById(id: string) {
    return this.store.scheduleRequests.find((row) => row.id === id) ?? null;
  }
}

class InMemoryEapEvidencesRepository implements EapEvidencesRepository {
  constructor(private readonly store: EapInMemoryStore) {}

  private projectIdOf(row: EapEvidenceRow) {
    if (row.taskId) {
      const task = this.store.tasks.find((item) => item.id === row.taskId);
      const phase = task ? this.store.phases.find((item) => item.id === task.phaseId) : null;
      return phase?.projectId ?? null;
    }
    if (row.milestoneId) {
      const milestone = this.store.milestones.find((item) => item.id === row.milestoneId);
      const phase = milestone
        ? this.store.phases.find((item) => item.id === milestone.phaseId)
        : null;
      return phase?.projectId ?? null;
    }
    if (row.scheduleRequestId) {
      return (
        this.store.scheduleRequests.find((item) => item.id === row.scheduleRequestId)?.projectId ??
        null
      );
    }
    return null;
  }

  private matches(row: EapEvidenceRow, projectId: string, filter: EvidenceParentFilter) {
    if (this.projectIdOf(row) !== projectId) {
      return false;
    }
    if (filter.taskId && row.taskId !== filter.taskId) {
      return false;
    }
    if (filter.milestoneId && row.milestoneId !== filter.milestoneId) {
      return false;
    }
    if (filter.scheduleRequestId && row.scheduleRequestId !== filter.scheduleRequestId) {
      return false;
    }
    return true;
  }

  async listByProject(projectId: string, filter: EvidenceParentFilter) {
    return this.store.evidences
      .filter((row) => this.matches(row, projectId, filter))
      .sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() || a.title.localeCompare(b.title),
      );
  }

  async findByIdAndProject(evidenceId: string, projectId: string) {
    return (
      this.store.evidences.find(
        (row) => row.id === evidenceId && this.projectIdOf(row) === projectId,
      ) ?? null
    );
  }

  async create(data: NewEapEvidenceRecord) {
    const row: EapEvidenceRow = {
      ...data,
      createdAt: new Date(),
    };
    this.store.evidences.push(row);
    return row;
  }

  async update(evidenceId: string, data: EapEvidenceUpdateRecord) {
    const index = this.store.evidences.findIndex((row) => row.id === evidenceId);
    if (index < 0) {
      return null;
    }
    const updated: EapEvidenceRow = {
      ...this.store.evidences[index],
      ...data,
    };
    this.store.evidences[index] = updated;
    return updated;
  }
}

class InMemoryEapAuditRepository implements EapAuditRepository {
  constructor(private readonly store: EapInMemoryStore) {}

  async create(data: NewEapAuditLogRecord) {
    const row: EapAuditLogRow = {
      ...data,
      createdAt: new Date(),
    };
    this.store.auditLogs.push(row);
    return row;
  }

  async findLatestByEntityAction(
    entityType: string,
    entityId: string,
    action: NewEapAuditLogRecord["action"],
  ) {
    const matches = this.store.auditLogs.filter(
      (row) =>
        row.entityType === entityType && row.entityId === entityId && row.action === action,
    );
    return matches.at(-1) ?? null;
  }
}

export function makeEapInMemoryRepos(store: EapInMemoryStore): EapRepos {
  const projectRepos = makeInMemoryRepos(store);

  return {
    projects: projectRepos.projects,
    members: projectRepos.members,
    users: projectRepos.users,
    phases: new InMemoryEapPhasesRepository(store),
    tasks: new InMemoryEapTasksRepository(store),
    milestones: new InMemoryEapMilestonesRepository(store),
    scheduleRequests: new InMemoryEapScheduleRequestsRepository(store),
    evidences: new InMemoryEapEvidencesRepository(store),
    audit: new InMemoryEapAuditRepository(store),
  };
}

function cloneStore(store: EapInMemoryStore): EapInMemoryStore {
  return {
    users: store.users.map((row) => ({ ...row })),
    projects: store.projects.map((row) => ({ ...row })),
    members: store.members.map((row) => ({ ...row })),
    phases: store.phases.map((row) => ({ ...row })),
    tasks: store.tasks.map((row) => ({ ...row })),
    milestones: store.milestones.map((row) => ({ ...row })),
    scheduleRequests: store.scheduleRequests.map((row) => ({ ...row })),
    evidences: store.evidences.map((row) => ({ ...row })),
    auditLogs: store.auditLogs.map((row) => ({ ...row })),
  };
}

function restoreStore(store: EapInMemoryStore, snapshot: EapInMemoryStore) {
  store.users.splice(0, store.users.length, ...snapshot.users);
  store.projects.splice(0, store.projects.length, ...snapshot.projects);
  store.members.splice(0, store.members.length, ...snapshot.members);
  store.phases.splice(0, store.phases.length, ...snapshot.phases);
  store.tasks.splice(0, store.tasks.length, ...snapshot.tasks);
  store.milestones.splice(0, store.milestones.length, ...snapshot.milestones);
  store.scheduleRequests.splice(0, store.scheduleRequests.length, ...snapshot.scheduleRequests);
  store.evidences.splice(0, store.evidences.length, ...snapshot.evidences);
  store.auditLogs.splice(0, store.auditLogs.length, ...snapshot.auditLogs);
}

export function makeEapInMemoryTransactionRunner(
  repos: EapRepos,
  store?: EapInMemoryStore,
): EapTransactionRunner {
  if (!store) {
    return async (fn) => fn(repos);
  }

  return async (fn) => {
    const snapshot = cloneStore(store);
    try {
      return await fn(repos);
    } catch (error) {
      restoreStore(store, snapshot);
      throw error;
    }
  };
}

export function makeProject(
  overrides: Partial<ProjectRow> & Pick<ProjectRow, "id" | "ownerId">,
): ProjectRow {
  const now = new Date();
  return {
    name: overrides.name ?? "Projeto",
    description: overrides.description ?? null,
    glpiTicketId: overrides.glpiTicketId ?? null,
    status: overrides.status ?? "NAO_INICIADO",
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    ...overrides,
  };
}

export function makeMember(
  overrides: Partial<ProjectMemberRow> &
    Pick<ProjectMemberRow, "id" | "projectId" | "userId" | "role">,
): ProjectMemberRow {
  return {
    createdAt: overrides.createdAt ?? new Date(),
    ...overrides,
  };
}

export { makeUser };
export type { UserRow };

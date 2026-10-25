import { UniqueConstraintError } from "../../../lib/postgres-errors";
import type {
  ProjectMemberRow,
  ProjectRow,
  UserRow,
} from "../../projects/dtos/projects.dto";
import {
  makeInMemoryRepos,
  makeUser,
  noPlan,
  type InMemoryStore as ProjectStore,
} from "../../projects/test/in-memory";
import type { EapEvidenceRow } from "../dtos/eap-evidences.dto";
import type { EapImpedimentRow } from "../dtos/eap-impediments.dto";
import type { EapMilestoneDeliveryRow } from "../dtos/eap-milestone-deliveries.dto";
import type { EapAuditLogRow, EapPhaseRow } from "../dtos/eap-phases.dto";
import type { EapMilestoneRow } from "../dtos/eap-milestones.dto";
import type { EapTaskRow } from "../dtos/eap-tasks.dto";
import type {
  EapAuditActionFilter,
  EapAuditEntityFilter,
  EapAuditRepository,
  EapEvidencesRepository,
  EapEvidenceUpdateRecord,
  EapImpedimentsRepository,
  EapImpedimentUpdateRecord,
  EapMilestoneDeliveriesRepository,
  EapMilestoneDeliveryDecisionRecord,
  EapMilestoneDeliveryResubmissionRecord,
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
  NewEapImpedimentRecord,
  NewEapMilestoneDeliveryRecord,
  NewEapMilestoneRecord,
  NewEapPhaseRecord,
  NewEapTaskRecord,
  ScheduleRequestTarget,
} from "../repositories/contracts";

export type EapScheduleRequestRef = {
  id: string;
  projectId: string;
  phaseId?: string | null;
  taskId?: string | null;
  milestoneId?: string | null;
};

export type EapInMemoryStore = ProjectStore & {
  phases: EapPhaseRow[];
  tasks: EapTaskRow[];
  milestones: EapMilestoneRow[];
  deliveries: EapMilestoneDeliveryRow[];
  scheduleRequests: EapScheduleRequestRef[];
  impediments: EapImpedimentRow[];
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
    deliveries: seed?.deliveries ?? [],
    scheduleRequests: seed?.scheduleRequests ?? [],
    impediments: seed?.impediments ?? [],
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

  async lockForUpdate(phaseId: string, projectId: string) {
    return this.findByIdAndProject(phaseId, projectId);
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

  async delete(phaseId: string, projectId: string) {
    const index = this.store.phases.findIndex(
      (row) => row.id === phaseId && row.projectId === projectId,
    );
    if (index < 0) {
      return false;
    }
    this.store.phases.splice(index, 1);
    return true;
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

  async listByProject(projectId: string) {
    const phaseIds = new Set(
      this.store.phases.filter((row) => row.projectId === projectId).map((row) => row.id),
    );
    return this.store.tasks.filter((row) => phaseIds.has(row.phaseId));
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

  async countImpediments(taskId: string) {
    return this.store.impediments.filter((row) => row.taskId === taskId).length;
  }

  async delete(taskId: string, phaseId: string) {
    const index = this.store.tasks.findIndex(
      (row) => row.id === taskId && row.phaseId === phaseId,
    );
    if (index < 0) {
      return false;
    }
    this.store.tasks.splice(index, 1);
    return true;
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

  async listByProject(projectId: string) {
    const phaseIds = new Set(
      this.store.phases.filter((row) => row.projectId === projectId).map((row) => row.id),
    );
    return this.store.milestones.filter((row) => phaseIds.has(row.phaseId));
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
      validatedAt: null,
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

  async delete(milestoneId: string, phaseId: string) {
    const index = this.store.milestones.findIndex(
      (row) => row.id === milestoneId && row.phaseId === phaseId,
    );
    if (index < 0) {
      return false;
    }
    this.store.milestones.splice(index, 1);
    return true;
  }
}

class InMemoryEapMilestoneDeliveriesRepository implements EapMilestoneDeliveriesRepository {
  constructor(private readonly store: EapInMemoryStore) {}

  async listByMilestone(milestoneId: string) {
    const nameOf = (userId: string | null) => this.store.users.find((user) => user.id === userId)?.name ?? null;
    return this.store.deliveries
      .filter((row) => row.milestoneId === milestoneId)
      .sort((a, b) => a.round - b.round)
      .map((row) => ({
        ...row,
        submittedByName: nameOf(row.submittedBy),
        decidedByName: nameOf(row.decidedBy),
        resubmissionAuthorizedByName: nameOf(row.resubmissionAuthorizedBy),
      }));
  }

  async listByProject(projectId: string) {
    const phaseIds = new Set(
      this.store.phases.filter((row) => row.projectId === projectId).map((row) => row.id),
    );
    const milestoneIds = new Set(
      this.store.milestones.filter((row) => phaseIds.has(row.phaseId)).map((row) => row.id),
    );
    return this.store.deliveries
      .filter((row) => milestoneIds.has(row.milestoneId))
      .sort((a, b) => a.milestoneId.localeCompare(b.milestoneId) || a.round - b.round);
  }

  async findLatest(milestoneId: string) {
    return (
      this.store.deliveries
        .filter((row) => row.milestoneId === milestoneId)
        .sort((a, b) => b.round - a.round)[0] ?? null
    );
  }

  async create(data: NewEapMilestoneDeliveryRecord) {
    const duplicated = this.store.deliveries.some(
      (row) =>
        row.milestoneId === data.milestoneId &&
        (row.round === data.round || row.status === "EM_ANALISE"),
    );
    if (duplicated) {
      throw new UniqueConstraintError();
    }
    const row: EapMilestoneDeliveryRow = {
      ...data,
      status: "EM_ANALISE",
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      nonconformities: null,
      adjustments: null,
      resubmissionAuthorizedBy: null,
      resubmissionAuthorizedAt: null,
      resubmissionNote: null,
    };
    this.store.deliveries.push(row);
    return row;
  }

  async decide(deliveryId: string, data: EapMilestoneDeliveryDecisionRecord) {
    const index = this.store.deliveries.findIndex(
      (row) => row.id === deliveryId && row.status === "EM_ANALISE",
    );
    if (index < 0) {
      return null;
    }
    const updated: EapMilestoneDeliveryRow = { ...this.store.deliveries[index], ...data };
    this.store.deliveries[index] = updated;
    return updated;
  }

  async authorizeResubmission(deliveryId: string, data: EapMilestoneDeliveryResubmissionRecord) {
    const index = this.store.deliveries.findIndex(
      (row) => row.id === deliveryId && row.status === "REJEITADA" && !row.resubmissionAuthorizedAt,
    );
    if (index < 0) {
      return null;
    }
    const updated: EapMilestoneDeliveryRow = { ...this.store.deliveries[index], ...data };
    this.store.deliveries[index] = updated;
    return updated;
  }
}

class InMemoryEapScheduleRequestsRepository implements EapScheduleRequestsRepository {
  constructor(private readonly store: EapInMemoryStore) {}

  async findById(id: string) {
    return this.store.scheduleRequests.find((row) => row.id === id) ?? null;
  }

  async countByTarget(target: ScheduleRequestTarget) {
    return this.store.scheduleRequests.filter((row) =>
      "phaseId" in target
        ? row.phaseId === target.phaseId
        : "taskId" in target
          ? row.taskId === target.taskId
          : row.milestoneId === target.milestoneId,
    ).length;
  }
}

class InMemoryEapEvidencesRepository implements EapEvidencesRepository {
  constructor(private readonly store: EapInMemoryStore) {}

  private projectIdOf(row: EapEvidenceRow) {
    if (row.phaseId) {
      return this.store.phases.find((item) => item.id === row.phaseId)?.projectId ?? null;
    }
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
    if (filter.phaseId && row.phaseId !== filter.phaseId) {
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
      deliveryId: data.deliveryId ?? null,
      createdAt: new Date(),
    };
    this.store.evidences.push(row);
    return row;
  }

  async update(evidenceId: string, data: EapEvidenceUpdateRecord) {
    const index = this.store.evidences.findIndex((row) => row.id === evidenceId && !row.deliveryId);
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

  async linkToDelivery(milestoneId: string, deliveryId: string, createdUntil?: Date) {
    const linked: string[] = [];
    this.store.evidences.forEach((row, index) => {
      if (
        row.milestoneId === milestoneId &&
        !row.deliveryId &&
        (!createdUntil || row.createdAt <= createdUntil)
      ) {
        this.store.evidences[index] = { ...row, deliveryId };
        linked.push(row.id);
      }
    });
    return linked;
  }
}

class InMemoryEapImpedimentsRepository implements EapImpedimentsRepository {
  constructor(private readonly store: EapInMemoryStore) {}

  async listByTask(taskId: string) {
    const nameOf = (userId: string | null) => this.store.users.find((user) => user.id === userId)?.name ?? null;
    return this.store.impediments
      .filter((row) => row.taskId === taskId)
      .sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime())
      .map((row) => ({ ...row, openedByName: nameOf(row.openedBy), resolvedByName: nameOf(row.resolvedBy) }));
  }

  async findOpenByTask(taskId: string) {
    return this.store.impediments.find((row) => row.taskId === taskId && !row.resolvedAt) ?? null;
  }

  async create(data: NewEapImpedimentRecord) {
    if (await this.findOpenByTask(data.taskId)) {
      throw new UniqueConstraintError();
    }
    const row: EapImpedimentRow = {
      ...data,
      openedAt: new Date(),
      resolvedBy: null,
      resolvedAt: null,
      resolutionNote: null,
    };
    this.store.impediments.push(row);
    return row;
  }

  async update(impedimentId: string, data: EapImpedimentUpdateRecord) {
    const index = this.store.impediments.findIndex((row) => row.id === impedimentId);
    if (index < 0) {
      return null;
    }
    const updated: EapImpedimentRow = { ...this.store.impediments[index], ...data };
    this.store.impediments[index] = updated;
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

  async listByEntity(filter: EapAuditEntityFilter) {
    const parentKey =
      filter.entityType === "PHASE"
        ? "phaseId"
        : filter.entityType === "TASK"
          ? "taskId"
          : filter.entityType === "MILESTONE"
            ? "milestoneId"
            : null;

    return [...this.store.auditLogs]
      .reverse()
      .filter((row) => {
        if (row.projectId !== filter.projectId) {
          return false;
        }
        if (row.entityType === filter.entityType && row.entityId === filter.entityId) {
          return true;
        }
        if (!filter.includeEvidences || !parentKey || row.entityType !== "EVIDENCE") {
          return false;
        }
        const payload = row.payload as Record<string, unknown> | null;
        return payload?.[parentKey] === filter.entityId;
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, filter.limit)
      .map((row) => ({
        ...row,
        actorName: this.store.users.find((user) => user.id === row.actorId)?.name ?? null,
      }));
  }

  async listByAction(filter: EapAuditActionFilter) {
    return this.store.auditLogs
      .filter(
        (row) =>
          row.projectId === filter.projectId &&
          row.action === filter.action &&
          (!filter.entityType || row.entityType === filter.entityType) &&
          (!filter.entityId || row.entityId === filter.entityId),
      )
      .map((row) => ({
        ...row,
        actorName: this.store.users.find((user) => user.id === row.actorId)?.name ?? null,
      }));
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
    deliveries: new InMemoryEapMilestoneDeliveriesRepository(store),
    scheduleRequests: new InMemoryEapScheduleRequestsRepository(store),
    impediments: new InMemoryEapImpedimentsRepository(store),
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
    deliveries: store.deliveries.map((row) => ({ ...row })),
    scheduleRequests: store.scheduleRequests.map((row) => ({ ...row })),
    impediments: store.impediments.map((row) => ({ ...row })),
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
  store.deliveries.splice(0, store.deliveries.length, ...snapshot.deliveries);
  store.scheduleRequests.splice(0, store.scheduleRequests.length, ...snapshot.scheduleRequests);
  store.impediments.splice(0, store.impediments.length, ...snapshot.impediments);
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
    ...noPlan,
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

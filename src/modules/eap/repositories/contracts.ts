import type { eapAuditActionEnum } from "../../../db/schema";
import type {
  ProjectMembersRepository,
  ProjectsRepository,
  UsersRepository,
} from "../../projects/repositories/contracts";
import type { EapAuditLogRow, EapPhaseRow } from "../dtos/eap-phases.dto";
import type { EapEvidenceRow } from "../dtos/eap-evidences.dto";
import type { EapMilestoneRow } from "../dtos/eap-milestones.dto";
import type { EapTaskRow } from "../dtos/eap-tasks.dto";

export type NewEapPhaseRecord = {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  sortOrder: number;
  status: EapPhaseRow["status"];
  baselineStartAt: Date | null;
  baselineEndAt: Date | null;
  plannedStartAt: Date | null;
  plannedEndAt: Date | null;
  createdBy: string;
  updatedBy: string;
};

export type EapPhaseUpdateRecord = {
  name?: string;
  description?: string | null;
  status?: EapPhaseRow["status"];
  sortOrder?: number;
  updatedBy: string;
  updatedAt: Date;
};

export type NewEapAuditLogRecord = {
  id: string;
  projectId: string;
  entityType: string;
  entityId: string;
  action: (typeof eapAuditActionEnum.enumValues)[number];
  summary: string;
  payload: Record<string, unknown> | null;
  actorId: string;
};

export interface EapPhasesRepository {
  listByProject(projectId: string): Promise<EapPhaseRow[]>;
  findById(phaseId: string): Promise<EapPhaseRow | null>;
  findByIdAndProject(phaseId: string, projectId: string): Promise<EapPhaseRow | null>;
  findMaxSortOrder(projectId: string): Promise<number | null>;
  create(data: NewEapPhaseRecord): Promise<EapPhaseRow>;
  update(
    phaseId: string,
    projectId: string,
    data: EapPhaseUpdateRecord,
  ): Promise<EapPhaseRow | null>;
  replaceSortOrders(
    projectId: string,
    items: Array<{ phaseId: string; sortOrder: number }>,
    updatedBy: string,
    updatedAt: Date,
  ): Promise<EapPhaseRow[]>;
}

export type NewEapTaskRecord = {
  id: string;
  phaseId: string;
  title: string;
  description: string | null;
  sortOrder: number;
  assigneeId: string | null;
  status: EapTaskRow["status"];
  progressPercent: number;
  weight: number;
  baselineStartAt: Date | null;
  baselineEndAt: Date | null;
  plannedStartAt: Date | null;
  plannedEndAt: Date | null;
  createdBy: string;
  updatedBy: string;
};

export type EapTaskUpdateRecord = {
  title?: string;
  description?: string | null;
  assigneeId?: string | null;
  weight?: number;
  status?: EapTaskRow["status"];
  progressPercent?: number;
  actualStartAt?: Date | null;
  actualEndAt?: Date | null;
  hasImpediment?: boolean;
  updatedBy: string;
  updatedAt: Date;
};

export interface EapTasksRepository {
  listByPhase(phaseId: string): Promise<EapTaskRow[]>;
  findById(taskId: string): Promise<EapTaskRow | null>;
  findByIdAndPhase(taskId: string, phaseId: string): Promise<EapTaskRow | null>;
  findMaxSortOrder(phaseId: string): Promise<number | null>;
  create(data: NewEapTaskRecord): Promise<EapTaskRow>;
  replaceSortOrders(
    phaseId: string,
    items: Array<{ taskId: string; sortOrder: number }>,
    updatedBy: string,
    updatedAt: Date,
  ): Promise<EapTaskRow[]>;
  update(taskId: string, phaseId: string, data: EapTaskUpdateRecord): Promise<EapTaskRow | null>;
}

export type NewEapMilestoneRecord = {
  id: string;
  phaseId: string;
  title: string;
  description: string | null;
  sortOrder: number;
  type: EapMilestoneRow["type"];
  status: EapMilestoneRow["status"];
  baselineAt: Date | null;
  plannedAt: Date | null;
  createdBy: string;
  updatedBy: string;
};

export type EapMilestoneUpdateRecord = {
  title?: string;
  description?: string | null;
  status?: EapMilestoneRow["status"];
  actualAt?: Date | null;
  deliveredBy?: string | null;
  validatedBy?: string | null;
  validationNote?: string | null;
  updatedBy: string;
  updatedAt: Date;
};

export interface EapMilestonesRepository {
  listByPhase(phaseId: string): Promise<EapMilestoneRow[]>;
  findById(milestoneId: string): Promise<EapMilestoneRow | null>;
  findByIdAndPhase(milestoneId: string, phaseId: string): Promise<EapMilestoneRow | null>;
  findMaxSortOrder(phaseId: string): Promise<number | null>;
  create(data: NewEapMilestoneRecord): Promise<EapMilestoneRow>;
  replaceSortOrders(
    phaseId: string,
    items: Array<{ milestoneId: string; sortOrder: number }>,
    updatedBy: string,
    updatedAt: Date,
  ): Promise<EapMilestoneRow[]>;
  update(
    milestoneId: string,
    phaseId: string,
    data: EapMilestoneUpdateRecord,
  ): Promise<EapMilestoneRow | null>;
}

export type EvidenceParentFilter = {
  taskId?: string;
  milestoneId?: string;
  scheduleRequestId?: string;
};

export type NewEapEvidenceRecord = {
  id: string;
  taskId: string | null;
  milestoneId: string | null;
  scheduleRequestId: string | null;
  title: string;
  url: string;
  createdBy: string;
};

export type EapEvidenceUpdateRecord = {
  title?: string;
  url?: string;
};

export interface EapEvidencesRepository {
  listByProject(projectId: string, filter: EvidenceParentFilter): Promise<EapEvidenceRow[]>;
  findByIdAndProject(evidenceId: string, projectId: string): Promise<EapEvidenceRow | null>;
  create(data: NewEapEvidenceRecord): Promise<EapEvidenceRow>;
  update(evidenceId: string, data: EapEvidenceUpdateRecord): Promise<EapEvidenceRow | null>;
}

export interface EapScheduleRequestsRepository {
  findById(id: string): Promise<{ id: string; projectId: string } | null>;
}

export interface EapAuditRepository {
  create(data: NewEapAuditLogRecord): Promise<EapAuditLogRow>;
  findLatestByEntityAction(
    entityType: string,
    entityId: string,
    action: NewEapAuditLogRecord["action"],
  ): Promise<EapAuditLogRow | null>;
}

export type EapRepos = {
  projects: ProjectsRepository;
  members: ProjectMembersRepository;
  users: UsersRepository;
  phases: EapPhasesRepository;
  tasks: EapTasksRepository;
  milestones: EapMilestonesRepository;
  scheduleRequests: EapScheduleRequestsRepository;
  evidences: EapEvidencesRepository;
  audit: EapAuditRepository;
};

export type EapTransactionRunner = <T>(fn: (repos: EapRepos) => Promise<T>) => Promise<T>;

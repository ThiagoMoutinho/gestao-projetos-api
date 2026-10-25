import type { eapAuditActionEnum } from "../../../db/schema";
import type {
  ProjectMembersRepository,
  ProjectsRepository,
  UsersRepository,
} from "../../projects/repositories/contracts";
import type { EapAuditLogRow, EapPhaseRow } from "../dtos/eap-phases.dto";
import type { EapEvidenceRow } from "../dtos/eap-evidences.dto";
import type { EapImpedimentEntryRow, EapImpedimentRow } from "../dtos/eap-impediments.dto";
import type {
  EapMilestoneDeliveryEntryRow,
  EapMilestoneDeliveryRow,
} from "../dtos/eap-milestone-deliveries.dto";
import type { EapMilestoneRow } from "../dtos/eap-milestones.dto";
import type { EapTaskRow } from "../dtos/eap-tasks.dto";

export type NewEapPhaseRecord = {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  sortOrder: number;
  status: EapPhaseRow["status"];
  responsibleId: string | null;
  completionCriteria: string | null;
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
  responsibleId?: string | null;
  completionCriteria?: string | null;
  sortOrder?: number;
  baselineStartAt?: Date | null;
  baselineEndAt?: Date | null;
  plannedStartAt?: Date | null;
  plannedEndAt?: Date | null;
  actualStartAt?: Date | null;
  actualEndAt?: Date | null;
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
  /** Trava a linha da fase até o fim da transação para recalcular a situação sem concorrência. */
  lockForUpdate(phaseId: string, projectId: string): Promise<EapPhaseRow | null>;
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
  delete(phaseId: string, projectId: string): Promise<boolean>;
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
  correctiveMilestoneId: string | null;
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
  baselineStartAt?: Date | null;
  baselineEndAt?: Date | null;
  plannedStartAt?: Date | null;
  plannedEndAt?: Date | null;
  actualStartAt?: Date | null;
  actualEndAt?: Date | null;
  hasImpediment?: boolean;
  updatedBy: string;
  updatedAt: Date;
};

export interface EapTasksRepository {
  listByPhase(phaseId: string): Promise<EapTaskRow[]>;
  listByProject(projectId: string): Promise<EapTaskRow[]>;
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
  countImpediments(taskId: string): Promise<number>;
  delete(taskId: string, phaseId: string): Promise<boolean>;
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
  reviewerId: string | null;
  presenterId?: string | null;
  createdBy: string;
  updatedBy: string;
};

export type EapMilestoneUpdateRecord = {
  title?: string;
  description?: string | null;
  reviewerId?: string | null;
  presenterId?: string;
  status?: EapMilestoneRow["status"];
  baselineAt?: Date | null;
  plannedAt?: Date | null;
  actualAt?: Date | null;
  deliveredBy?: string | null;
  validatedBy?: string | null;
  validationNote?: string | null;
  validatedAt?: Date | null;
  updatedBy: string;
  updatedAt: Date;
};

export interface EapMilestonesRepository {
  listByPhase(phaseId: string): Promise<EapMilestoneRow[]>;
  listByProject(projectId: string): Promise<EapMilestoneRow[]>;
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
  delete(milestoneId: string, phaseId: string): Promise<boolean>;
}

export type NewEapMilestoneDeliveryRecord = {
  id: string;
  milestoneId: string;
  round: number;
  legacy: boolean;
  submittedBy: string;
  submittedAt: Date | null;
  note: string | null;
};

export type EapMilestoneDeliveryDecisionRecord = {
  status: Exclude<EapMilestoneDeliveryRow["status"], "EM_ANALISE">;
  decidedBy: string;
  decidedAt: Date;
  decisionNote: string | null;
  nonconformities: string | null;
  adjustments: string | null;
};

export type EapMilestoneDeliveryResubmissionRecord = {
  resubmissionAuthorizedBy: string;
  resubmissionAuthorizedAt: Date;
  resubmissionNote: string;
};

export interface EapMilestoneDeliveriesRepository {
  /** Rodadas do marco em ordem crescente, com os nomes de quem enviou, decidiu e autorizou. */
  listByMilestone(milestoneId: string): Promise<EapMilestoneDeliveryEntryRow[]>;
  listByProject(projectId: string): Promise<EapMilestoneDeliveryRow[]>;
  findLatest(milestoneId: string): Promise<EapMilestoneDeliveryRow | null>;
  create(data: NewEapMilestoneDeliveryRecord): Promise<EapMilestoneDeliveryRow>;
  /** Grava a decisão somente se a rodada ainda estiver em análise. */
  decide(deliveryId: string, data: EapMilestoneDeliveryDecisionRecord): Promise<EapMilestoneDeliveryRow | null>;
  /** Grava a autorização somente se a rodada estiver rejeitada e ainda sem autorização. */
  authorizeResubmission(
    deliveryId: string,
    data: EapMilestoneDeliveryResubmissionRecord,
  ): Promise<EapMilestoneDeliveryRow | null>;
}

export type EvidenceParentFilter = {
  phaseId?: string;
  taskId?: string;
  milestoneId?: string;
  scheduleRequestId?: string;
};

export type NewEapEvidenceRecord = {
  id: string;
  phaseId: string | null;
  taskId: string | null;
  milestoneId: string | null;
  scheduleRequestId: string | null;
  /** Evidência anexada pelo homologador na decisão já nasce vinculada (e travada) à rodada. */
  deliveryId?: string | null;
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
  /**
   * Vincula à rodada as evidências do marco ainda sem rodada; com `createdUntil`, somente as
   * registradas até aquele instante. Devolve os identificadores vinculados.
   */
  linkToDelivery(
    milestoneId: string,
    deliveryId: string,
    createdUntil?: Date,
  ): Promise<string[]>;
}

export type NewEapImpedimentRecord = {
  id: string;
  taskId: string;
  description: string;
  openedBy: string;
};

export type EapImpedimentUpdateRecord = {
  description?: string;
  resolvedBy?: string;
  resolvedAt?: Date;
  resolutionNote?: string;
};

export interface EapImpedimentsRepository {
  listByTask(taskId: string): Promise<EapImpedimentEntryRow[]>;
  findOpenByTask(taskId: string): Promise<EapImpedimentRow | null>;
  create(data: NewEapImpedimentRecord): Promise<EapImpedimentRow>;
  update(impedimentId: string, data: EapImpedimentUpdateRecord): Promise<EapImpedimentRow | null>;
}

export interface EapScheduleRequestsRepository {
  findById(id: string): Promise<{ id: string; projectId: string } | null>;
  countByTarget(target: ScheduleRequestTarget): Promise<number>;
}

export type ScheduleRequestTarget =
  | { phaseId: string }
  | { taskId: string }
  | { milestoneId: string };

export interface EapAuditRepository {
  create(data: NewEapAuditLogRecord): Promise<EapAuditLogRow>;
  findLatestByEntityAction(
    entityType: string,
    entityId: string,
    action: NewEapAuditLogRecord["action"],
  ): Promise<EapAuditLogRow | null>;
  listByEntity(filter: EapAuditEntityFilter): Promise<EapAuditEntryRow[]>;
  /** Registros de uma ação no projeto, em ordem cronológica crescente. */
  listByAction(filter: EapAuditActionFilter): Promise<EapAuditEntryRow[]>;
}

export type EapAuditActionFilter = {
  projectId: string;
  action: NewEapAuditLogRecord["action"];
  entityType?: string;
  entityId?: string;
};

export type EapAuditEntityFilter = {
  projectId: string;
  entityType: string;
  entityId: string;
  includeEvidences: boolean;
  limit: number;
};

export type EapAuditEntryRow = EapAuditLogRow & { actorName: string | null };

export type EapRepos = {
  projects: ProjectsRepository;
  members: ProjectMembersRepository;
  users: UsersRepository;
  phases: EapPhasesRepository;
  tasks: EapTasksRepository;
  milestones: EapMilestonesRepository;
  deliveries: EapMilestoneDeliveriesRepository;
  scheduleRequests: EapScheduleRequestsRepository;
  impediments: EapImpedimentsRepository;
  evidences: EapEvidencesRepository;
  audit: EapAuditRepository;
};

export type EapTransactionRunner = <T>(fn: (repos: EapRepos) => Promise<T>) => Promise<T>;

import type { FastifyReply, FastifyRequest } from "fastify";

import type { AuthUser } from "../../lib/session";
import { getAuthUser } from "../../lib/session";
import type { EapAuditEntryDto, ListAuditQuery } from "./dtos/eap-audit.dto";
import type { EapImportInput, EapImportResultDto } from "./dtos/eap-import.dto";
import type {
  CreatePhaseInput,
  EapPhaseDto,
  EapProjectProgressDto,
  ReorderPhaseItem,
  UpdatePhaseInput,
} from "./dtos/eap-phases.dto";
import type {
  CreateEvidenceInput,
  EapEvidenceDto,
  ListEvidencesQuery,
  UpdateEvidenceInput,
} from "./dtos/eap-evidences.dto";
import type {
  EapImpedimentChangeDto,
  EapImpedimentEntryDto,
  RegisterImpedimentInput,
  ResolveImpedimentInput,
  UpdateImpedimentInput,
} from "./dtos/eap-impediments.dto";
import type {
  AuthorizeResubmissionInput,
  DeliverMilestoneInput,
  EapMilestoneDeliveryDto,
} from "./dtos/eap-milestone-deliveries.dto";
import type {
  CreateMilestoneInput,
  EapMilestoneDto,
  ReviewMilestoneInput,
  UpdateMilestoneInput,
} from "./dtos/eap-milestones.dto";
import type {
  EapScheduleChangeDto,
  EapScheduleMonitoringDto,
  ListScheduleChangesQuery,
  RescheduleMilestoneInput,
  RescheduleRangeInput,
} from "./dtos/eap-schedule.dto";
import type { ReorderMilestoneItem } from "./use-cases/reorder-milestones";
import type { RescheduleTarget } from "./use-cases/reschedule";
import type { ReorderTaskItem } from "./use-cases/reorder-tasks";
import type {
  CreateTaskInput,
  EapTaskDto,
  TaskStatusDecisionInput,
  UpdateTaskInput,
  UpdateTaskProgressInput,
} from "./dtos/eap-tasks.dto";

type EapPhaseUseCases = {
  listPhases: (
    actor: AuthUser,
    projectId: string,
  ) => Promise<{ data: EapPhaseDto[]; summary: EapProjectProgressDto }>;
  getPhase: (actor: AuthUser, projectId: string, phaseId: string) => Promise<EapPhaseDto>;
  createPhase: (
    actor: AuthUser,
    projectId: string,
    input: CreatePhaseInput,
  ) => Promise<EapPhaseDto>;
  updatePhase: (
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    input: UpdatePhaseInput,
  ) => Promise<EapPhaseDto>;
  reorderPhases: (
    actor: AuthUser,
    projectId: string,
    items: ReorderPhaseItem[],
  ) => Promise<{ data: EapPhaseDto[]; summary: EapProjectProgressDto }>;
  importEap: (actor: AuthUser, projectId: string, input: EapImportInput) => Promise<EapImportResultDto>;
  listTasks: (
    actor: AuthUser,
    projectId: string,
    phaseId: string,
  ) => Promise<{ data: EapTaskDto[] }>;
  getTask: (
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    taskId: string,
  ) => Promise<EapTaskDto>;
  createTask: (
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    input: CreateTaskInput,
  ) => Promise<EapTaskDto>;
  updateTask: (
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    taskId: string,
    input: UpdateTaskInput,
  ) => Promise<EapTaskDto>;
  updateTaskProgress: (
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    taskId: string,
    input: UpdateTaskProgressInput,
  ) => Promise<EapTaskDto>;
  cancelTask: (
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    taskId: string,
    input: TaskStatusDecisionInput,
  ) => Promise<EapTaskDto>;
  reactivateTask: (
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    taskId: string,
    input: TaskStatusDecisionInput,
  ) => Promise<EapTaskDto>;
  reorderTasks: (
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    items: ReorderTaskItem[],
  ) => Promise<{ data: EapTaskDto[] }>;
  listImpediments: (
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    taskId: string,
  ) => Promise<{ data: EapImpedimentEntryDto[] }>;
  registerImpediment: (
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    taskId: string,
    input: RegisterImpedimentInput,
  ) => Promise<EapImpedimentChangeDto>;
  updateImpediment: (
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    taskId: string,
    impedimentId: string,
    input: UpdateImpedimentInput,
  ) => Promise<EapImpedimentChangeDto>;
  resolveImpediment: (
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    taskId: string,
    input: ResolveImpedimentInput,
  ) => Promise<EapImpedimentChangeDto>;
  listMilestones: (
    actor: AuthUser,
    projectId: string,
    phaseId: string,
  ) => Promise<{ data: EapMilestoneDto[] }>;
  getMilestone: (
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    milestoneId: string,
  ) => Promise<EapMilestoneDto>;
  createMilestone: (
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    input: CreateMilestoneInput,
  ) => Promise<EapMilestoneDto>;
  updateMilestone: (
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    milestoneId: string,
    input: UpdateMilestoneInput,
  ) => Promise<EapMilestoneDto>;
  deliverMilestone: (
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    milestoneId: string,
    input: DeliverMilestoneInput,
  ) => Promise<EapMilestoneDto>;
  authorizeResubmission: (
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    milestoneId: string,
    input: AuthorizeResubmissionInput,
  ) => Promise<EapMilestoneDto>;
  listMilestoneDeliveries: (
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    milestoneId: string,
  ) => Promise<{ data: EapMilestoneDeliveryDto[] }>;
  reviewMilestone: (
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    milestoneId: string,
    input: ReviewMilestoneInput,
  ) => Promise<EapMilestoneDto>;
  reorderMilestones: (
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    items: ReorderMilestoneItem[],
  ) => Promise<{ data: EapMilestoneDto[] }>;
  listEvidences: (
    actor: AuthUser,
    projectId: string,
    query: ListEvidencesQuery,
  ) => Promise<{ data: EapEvidenceDto[] }>;
  getEvidence: (
    actor: AuthUser,
    projectId: string,
    evidenceId: string,
  ) => Promise<EapEvidenceDto>;
  createEvidence: (
    actor: AuthUser,
    projectId: string,
    input: CreateEvidenceInput,
  ) => Promise<EapEvidenceDto>;
  updateEvidence: (
    actor: AuthUser,
    projectId: string,
    evidenceId: string,
    input: UpdateEvidenceInput,
  ) => Promise<EapEvidenceDto>;
  listAudit: (
    actor: AuthUser,
    projectId: string,
    query: ListAuditQuery,
  ) => Promise<{ data: EapAuditEntryDto[] }>;
  reschedule: (
    actor: AuthUser,
    projectId: string,
    target: RescheduleTarget,
    input: RescheduleRangeInput | RescheduleMilestoneInput,
  ) => Promise<EapScheduleChangeDto>;
  listScheduleChanges: (
    actor: AuthUser,
    projectId: string,
    query: ListScheduleChangesQuery,
  ) => Promise<{ data: EapScheduleChangeDto[] }>;
  getScheduleMonitoring: (actor: AuthUser, projectId: string) => Promise<EapScheduleMonitoringDto>;
  deletePhase: (actor: AuthUser, projectId: string, phaseId: string) => Promise<void>;
  deleteTask: (
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    taskId: string,
  ) => Promise<void>;
  deleteMilestone: (
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    milestoneId: string,
  ) => Promise<void>;
};

export function makeEapController(useCases: EapPhaseUseCases) {
  return {
    async list(request: FastifyRequest<{ Params: { id: string } }>) {
      return useCases.listPhases(getAuthUser(request), request.params.id);
    },

    async get(request: FastifyRequest<{ Params: { id: string; phaseId: string } }>) {
      return useCases.getPhase(
        getAuthUser(request),
        request.params.id,
        request.params.phaseId,
      );
    },

    async create(
      request: FastifyRequest<{ Params: { id: string }; Body: CreatePhaseInput }>,
      reply: FastifyReply,
    ) {
      const phase = await useCases.createPhase(
        getAuthUser(request),
        request.params.id,
        request.body,
      );
      return reply.status(201).send(phase);
    },

    async update(
      request: FastifyRequest<{
        Params: { id: string; phaseId: string };
        Body: UpdatePhaseInput;
      }>,
    ) {
      return useCases.updatePhase(
        getAuthUser(request),
        request.params.id,
        request.params.phaseId,
        request.body,
      );
    },


    async delete(
      request: FastifyRequest<{ Params: { id: string; phaseId: string } }>,
      reply: FastifyReply,
    ) {
      await useCases.deletePhase(
        getAuthUser(request),
        request.params.id,
        request.params.phaseId,
      );
      return reply.status(204).send();
    },

    async deleteTask(
      request: FastifyRequest<{ Params: { id: string; phaseId: string; taskId: string } }>,
      reply: FastifyReply,
    ) {
      await useCases.deleteTask(
        getAuthUser(request),
        request.params.id,
        request.params.phaseId,
        request.params.taskId,
      );
      return reply.status(204).send();
    },

    async deleteMilestone(
      request: FastifyRequest<{
        Params: { id: string; phaseId: string; milestoneId: string };
      }>,
      reply: FastifyReply,
    ) {
      await useCases.deleteMilestone(
        getAuthUser(request),
        request.params.id,
        request.params.phaseId,
        request.params.milestoneId,
      );
      return reply.status(204).send();
    },

    async reorder(
      request: FastifyRequest<{
        Params: { id: string };
        Body: { items: ReorderPhaseItem[] };
      }>,
    ) {
      return useCases.reorderPhases(
        getAuthUser(request),
        request.params.id,
        request.body.items,
      );
    },

    async importEap(request: FastifyRequest<{ Params: { id: string }; Body: EapImportInput }>) {
      return useCases.importEap(getAuthUser(request), request.params.id, request.body);
    },

    async listTasks(
      request: FastifyRequest<{ Params: { id: string; phaseId: string } }>,
    ) {
      return useCases.listTasks(
        getAuthUser(request),
        request.params.id,
        request.params.phaseId,
      );
    },

    async getTask(
      request: FastifyRequest<{ Params: { id: string; phaseId: string; taskId: string } }>,
    ) {
      return useCases.getTask(
        getAuthUser(request),
        request.params.id,
        request.params.phaseId,
        request.params.taskId,
      );
    },

    async createTask(
      request: FastifyRequest<{
        Params: { id: string; phaseId: string };
        Body: CreateTaskInput;
      }>,
      reply: FastifyReply,
    ) {
      const task = await useCases.createTask(
        getAuthUser(request),
        request.params.id,
        request.params.phaseId,
        request.body,
      );
      return reply.status(201).send(task);
    },

    async updateTask(
      request: FastifyRequest<{
        Params: { id: string; phaseId: string; taskId: string };
        Body: UpdateTaskInput;
      }>,
    ) {
      return useCases.updateTask(
        getAuthUser(request),
        request.params.id,
        request.params.phaseId,
        request.params.taskId,
        request.body,
      );
    },

    async updateTaskProgress(
      request: FastifyRequest<{
        Params: { id: string; phaseId: string; taskId: string };
        Body: UpdateTaskProgressInput;
      }>,
    ) {
      return useCases.updateTaskProgress(
        getAuthUser(request),
        request.params.id,
        request.params.phaseId,
        request.params.taskId,
        request.body,
      );
    },

    async cancelTask(
      request: FastifyRequest<{
        Params: { id: string; phaseId: string; taskId: string };
        Body: TaskStatusDecisionInput;
      }>,
    ) {
      return useCases.cancelTask(
        getAuthUser(request),
        request.params.id,
        request.params.phaseId,
        request.params.taskId,
        request.body,
      );
    },

    async reactivateTask(
      request: FastifyRequest<{
        Params: { id: string; phaseId: string; taskId: string };
        Body: TaskStatusDecisionInput;
      }>,
    ) {
      return useCases.reactivateTask(
        getAuthUser(request),
        request.params.id,
        request.params.phaseId,
        request.params.taskId,
        request.body,
      );
    },

    async listImpediments(
      request: FastifyRequest<{ Params: { id: string; phaseId: string; taskId: string } }>,
    ) {
      return useCases.listImpediments(
        getAuthUser(request),
        request.params.id,
        request.params.phaseId,
        request.params.taskId,
      );
    },

    async registerImpediment(
      request: FastifyRequest<{
        Params: { id: string; phaseId: string; taskId: string };
        Body: RegisterImpedimentInput;
      }>,
      reply: FastifyReply,
    ) {
      const result = await useCases.registerImpediment(
        getAuthUser(request),
        request.params.id,
        request.params.phaseId,
        request.params.taskId,
        request.body,
      );
      return reply.status(201).send(result);
    },

    async updateImpediment(
      request: FastifyRequest<{
        Params: { id: string; phaseId: string; taskId: string; impedimentId: string };
        Body: UpdateImpedimentInput;
      }>,
    ) {
      return useCases.updateImpediment(
        getAuthUser(request),
        request.params.id,
        request.params.phaseId,
        request.params.taskId,
        request.params.impedimentId,
        request.body,
      );
    },

    async resolveImpediment(
      request: FastifyRequest<{
        Params: { id: string; phaseId: string; taskId: string };
        Body: ResolveImpedimentInput;
      }>,
    ) {
      return useCases.resolveImpediment(
        getAuthUser(request),
        request.params.id,
        request.params.phaseId,
        request.params.taskId,
        request.body,
      );
    },

    async reorderTasks(
      request: FastifyRequest<{
        Params: { id: string; phaseId: string };
        Body: { items: ReorderTaskItem[] };
      }>,
    ) {
      return useCases.reorderTasks(
        getAuthUser(request),
        request.params.id,
        request.params.phaseId,
        request.body.items,
      );
    },

    async reorderMilestones(
      request: FastifyRequest<{
        Params: { id: string; phaseId: string };
        Body: { items: ReorderMilestoneItem[] };
      }>,
    ) {
      return useCases.reorderMilestones(
        getAuthUser(request),
        request.params.id,
        request.params.phaseId,
        request.body.items,
      );
    },

    async listMilestones(
      request: FastifyRequest<{ Params: { id: string; phaseId: string } }>,
    ) {
      return useCases.listMilestones(
        getAuthUser(request),
        request.params.id,
        request.params.phaseId,
      );
    },

    async getMilestone(
      request: FastifyRequest<{
        Params: { id: string; phaseId: string; milestoneId: string };
      }>,
    ) {
      return useCases.getMilestone(
        getAuthUser(request),
        request.params.id,
        request.params.phaseId,
        request.params.milestoneId,
      );
    },

    async createMilestone(
      request: FastifyRequest<{
        Params: { id: string; phaseId: string };
        Body: CreateMilestoneInput;
      }>,
      reply: FastifyReply,
    ) {
      const milestone = await useCases.createMilestone(
        getAuthUser(request),
        request.params.id,
        request.params.phaseId,
        request.body,
      );
      return reply.status(201).send(milestone);
    },

    async updateMilestone(
      request: FastifyRequest<{
        Params: { id: string; phaseId: string; milestoneId: string };
        Body: UpdateMilestoneInput;
      }>,
    ) {
      return useCases.updateMilestone(
        getAuthUser(request),
        request.params.id,
        request.params.phaseId,
        request.params.milestoneId,
        request.body,
      );
    },

    async deliverMilestone(
      request: FastifyRequest<{
        Params: { id: string; phaseId: string; milestoneId: string };
        Body: DeliverMilestoneInput;
      }>,
    ) {
      return useCases.deliverMilestone(
        getAuthUser(request),
        request.params.id,
        request.params.phaseId,
        request.params.milestoneId,
        request.body ?? {},
      );
    },

    async authorizeResubmission(
      request: FastifyRequest<{
        Params: { id: string; phaseId: string; milestoneId: string };
        Body: AuthorizeResubmissionInput;
      }>,
    ) {
      return useCases.authorizeResubmission(
        getAuthUser(request),
        request.params.id,
        request.params.phaseId,
        request.params.milestoneId,
        request.body,
      );
    },

    async listMilestoneDeliveries(
      request: FastifyRequest<{
        Params: { id: string; phaseId: string; milestoneId: string };
      }>,
    ) {
      return useCases.listMilestoneDeliveries(
        getAuthUser(request),
        request.params.id,
        request.params.phaseId,
        request.params.milestoneId,
      );
    },

    async reviewMilestone(
      request: FastifyRequest<{
        Params: { id: string; phaseId: string; milestoneId: string };
        Body: ReviewMilestoneInput;
      }>,
    ) {
      return useCases.reviewMilestone(
        getAuthUser(request),
        request.params.id,
        request.params.phaseId,
        request.params.milestoneId,
        request.body,
      );
    },

    async listEvidences(
      request: FastifyRequest<{ Params: { id: string }; Querystring: ListEvidencesQuery }>,
    ) {
      return useCases.listEvidences(
        getAuthUser(request),
        request.params.id,
        request.query,
      );
    },

    async getEvidence(
      request: FastifyRequest<{ Params: { id: string; evidenceId: string } }>,
    ) {
      return useCases.getEvidence(
        getAuthUser(request),
        request.params.id,
        request.params.evidenceId,
      );
    },

    async createEvidence(
      request: FastifyRequest<{ Params: { id: string }; Body: CreateEvidenceInput }>,
      reply: FastifyReply,
    ) {
      const evidence = await useCases.createEvidence(
        getAuthUser(request),
        request.params.id,
        request.body,
      );
      return reply.status(201).send(evidence);
    },

    async updateEvidence(
      request: FastifyRequest<{
        Params: { id: string; evidenceId: string };
        Body: UpdateEvidenceInput;
      }>,
    ) {
      return useCases.updateEvidence(
        getAuthUser(request),
        request.params.id,
        request.params.evidenceId,
        request.body,
      );
    },

    async listAudit(
      request: FastifyRequest<{ Params: { id: string }; Querystring: ListAuditQuery }>,
    ) {
      return useCases.listAudit(getAuthUser(request), request.params.id, request.query);
    },

    async rescheduleProject(
      request: FastifyRequest<{ Params: { id: string }; Body: RescheduleRangeInput }>,
    ) {
      return useCases.reschedule(
        getAuthUser(request),
        request.params.id,
        { entityType: "PROJECT" },
        request.body,
      );
    },

    async reschedulePhase(
      request: FastifyRequest<{ Params: { id: string; phaseId: string }; Body: RescheduleRangeInput }>,
    ) {
      return useCases.reschedule(
        getAuthUser(request),
        request.params.id,
        { entityType: "PHASE", phaseId: request.params.phaseId },
        request.body,
      );
    },

    async rescheduleTask(
      request: FastifyRequest<{
        Params: { id: string; phaseId: string; taskId: string };
        Body: RescheduleRangeInput;
      }>,
    ) {
      return useCases.reschedule(
        getAuthUser(request),
        request.params.id,
        { entityType: "TASK", phaseId: request.params.phaseId, taskId: request.params.taskId },
        request.body,
      );
    },

    async rescheduleMilestone(
      request: FastifyRequest<{
        Params: { id: string; phaseId: string; milestoneId: string };
        Body: RescheduleMilestoneInput;
      }>,
    ) {
      return useCases.reschedule(
        getAuthUser(request),
        request.params.id,
        {
          entityType: "MILESTONE",
          phaseId: request.params.phaseId,
          milestoneId: request.params.milestoneId,
        },
        request.body,
      );
    },

    async listScheduleChanges(
      request: FastifyRequest<{ Params: { id: string }; Querystring: ListScheduleChangesQuery }>,
    ) {
      return useCases.listScheduleChanges(getAuthUser(request), request.params.id, request.query);
    },

    async getScheduleMonitoring(request: FastifyRequest<{ Params: { id: string } }>) {
      return useCases.getScheduleMonitoring(getAuthUser(request), request.params.id);
    },
  };
}

export type EapController = ReturnType<typeof makeEapController>;

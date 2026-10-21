import type { FastifyReply, FastifyRequest } from "fastify";

import type { AuthUser } from "../../lib/session";
import { getAuthUser } from "../../lib/session";
import type {
  CreatePhaseInput,
  EapPhaseDto,
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
  CreateMilestoneInput,
  EapMilestoneDto,
  ReviewMilestoneInput,
  UpdateMilestoneInput,
} from "./dtos/eap-milestones.dto";
import type { ReorderMilestoneItem } from "./use-cases/reorder-milestones";
import type { ReorderTaskItem } from "./use-cases/reorder-tasks";
import type {
  CreateTaskInput,
  EapTaskDto,
  UpdateTaskInput,
  UpdateTaskProgressInput,
} from "./dtos/eap-tasks.dto";

type EapPhaseUseCases = {
  listPhases: (
    actor: AuthUser,
    projectId: string,
  ) => Promise<{ data: EapPhaseDto[] }>;
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
  ) => Promise<{ data: EapPhaseDto[] }>;
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
  reorderTasks: (
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    items: ReorderTaskItem[],
  ) => Promise<{ data: EapTaskDto[] }>;
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
  ) => Promise<EapMilestoneDto>;
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
      }>,
    ) {
      return useCases.deliverMilestone(
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
  };
}

export type EapController = ReturnType<typeof makeEapController>;

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

import { requireAuth } from "../../lib/session";
import type { EapController } from "./eap.controller";
import {
  auditErrorResponses,
  eapAuditListResponseSchema,
  listAuditQuerySchema,
} from "./schemas/eap-audit.schema";
import {
  createPhaseBodySchema,
  eapPhaseListResponseSchema,
  eapPhaseSchema,
  errorResponses,
  phaseParamsSchema,
  projectIdParamsSchema,
  reorderPhasesBodySchema,
  updatePhaseBodySchema,
} from "./schemas/eap-phases.schema";
import {
  createEvidenceBodySchema,
  eapEvidenceListResponseSchema,
  eapEvidenceSchema,
  evidenceErrorResponses,
  evidenceParamsSchema,
  listEvidencesQuerySchema,
  updateEvidenceBodySchema,
} from "./schemas/eap-evidences.schema";
import {
  createMilestoneBodySchema,
  deliverMilestoneBodySchema,
  eapMilestoneListResponseSchema,
  eapMilestoneSchema,
  milestoneErrorResponses,
  milestoneParamsSchema,
  reorderMilestonesBodySchema,
  reviewMilestoneBodySchema,
  updateMilestoneBodySchema,
} from "./schemas/eap-milestones.schema";
import {
  createTaskBodySchema,
  eapTaskListResponseSchema,
  eapTaskSchema,
  reorderTasksBodySchema,
  taskErrorResponses,
  taskParamsSchema,
  updateTaskBodySchema,
  updateTaskProgressBodySchema,
} from "./schemas/eap-tasks.schema";

export function makeEapRoutes(controller: EapController): FastifyPluginAsyncZod {
  return async (app) => {
    app.addHook("preHandler", requireAuth);

    app.get(
      "/projects/:id/phases",
      {
        schema: {
          operationId: "listEapPhases",
          tags: ["EAP"],
          summary: "Listar fases do projeto",
          security: [{ cookieAuth: [] }],
          params: projectIdParamsSchema,
          response: {
            200: eapPhaseListResponseSchema,
            ...errorResponses,
          },
        },
      },
      (request) => controller.list(request),
    );

    app.post(
      "/projects/:id/phases",
      {
        schema: {
          operationId: "createEapPhase",
          tags: ["EAP"],
          summary: "Criar fase do projeto",
          security: [{ cookieAuth: [] }],
          params: projectIdParamsSchema,
          body: createPhaseBodySchema,
          response: {
            201: eapPhaseSchema,
            ...errorResponses,
          },
        },
      },
      (request, reply) => controller.create(request, reply),
    );

    app.patch(
      "/projects/:id/phases/order",
      {
        schema: {
          operationId: "reorderEapPhases",
          tags: ["EAP"],
          summary: "Reordenar fases do projeto",
          security: [{ cookieAuth: [] }],
          params: projectIdParamsSchema,
          body: reorderPhasesBodySchema,
          response: {
            200: eapPhaseListResponseSchema,
            ...errorResponses,
          },
        },
      },
      (request) => controller.reorder(request),
    );

    app.get(
      "/projects/:id/phases/:phaseId",
      {
        schema: {
          operationId: "getEapPhase",
          tags: ["EAP"],
          summary: "Consultar fase do projeto",
          security: [{ cookieAuth: [] }],
          params: phaseParamsSchema,
          response: {
            200: eapPhaseSchema,
            ...errorResponses,
          },
        },
      },
      (request) => controller.get(request),
    );

    app.patch(
      "/projects/:id/phases/:phaseId",
      {
        schema: {
          operationId: "updateEapPhase",
          tags: ["EAP"],
          summary: "Atualizar fase do projeto",
          security: [{ cookieAuth: [] }],
          params: phaseParamsSchema,
          body: updatePhaseBodySchema,
          response: {
            200: eapPhaseSchema,
            ...errorResponses,
          },
        },
      },
      (request) => controller.update(request),
    );

    app.get(
      "/projects/:id/phases/:phaseId/tasks",
      {
        schema: {
          operationId: "listEapTasks",
          tags: ["EAP"],
          summary: "Listar tarefas da fase",
          security: [{ cookieAuth: [] }],
          params: phaseParamsSchema,
          response: {
            200: eapTaskListResponseSchema,
            ...taskErrorResponses,
          },
        },
      },
      (request) => controller.listTasks(request),
    );

    app.post(
      "/projects/:id/phases/:phaseId/tasks",
      {
        schema: {
          operationId: "createEapTask",
          tags: ["EAP"],
          summary: "Criar tarefa da fase",
          security: [{ cookieAuth: [] }],
          params: phaseParamsSchema,
          body: createTaskBodySchema,
          response: {
            201: eapTaskSchema,
            ...taskErrorResponses,
          },
        },
      },
      (request, reply) => controller.createTask(request, reply),
    );

    app.patch(
      "/projects/:id/phases/:phaseId/tasks/order",
      {
        schema: {
          operationId: "reorderEapTasks",
          tags: ["EAP"],
          summary: "Reordenar tarefas da fase",
          security: [{ cookieAuth: [] }],
          params: phaseParamsSchema,
          body: reorderTasksBodySchema,
          response: {
            200: eapTaskListResponseSchema,
            ...taskErrorResponses,
          },
        },
      },
      (request) => controller.reorderTasks(request),
    );

    app.get(
      "/projects/:id/phases/:phaseId/tasks/:taskId",
      {
        schema: {
          operationId: "getEapTask",
          tags: ["EAP"],
          summary: "Consultar tarefa da fase",
          security: [{ cookieAuth: [] }],
          params: taskParamsSchema,
          response: {
            200: eapTaskSchema,
            ...taskErrorResponses,
          },
        },
      },
      (request) => controller.getTask(request),
    );

    app.patch(
      "/projects/:id/phases/:phaseId/tasks/:taskId/progress",
      {
        schema: {
          operationId: "updateEapTaskProgress",
          tags: ["EAP"],
          summary: "Atualizar execução da tarefa",
          security: [{ cookieAuth: [] }],
          params: taskParamsSchema,
          body: updateTaskProgressBodySchema,
          response: {
            200: eapTaskSchema,
            ...taskErrorResponses,
          },
        },
      },
      (request) => controller.updateTaskProgress(request),
    );

    app.patch(
      "/projects/:id/phases/:phaseId/tasks/:taskId",
      {
        schema: {
          operationId: "updateEapTask",
          tags: ["EAP"],
          summary: "Atualizar estrutura da tarefa",
          security: [{ cookieAuth: [] }],
          params: taskParamsSchema,
          body: updateTaskBodySchema,
          response: {
            200: eapTaskSchema,
            ...taskErrorResponses,
          },
        },
      },
      (request) => controller.updateTask(request),
    );

    app.get(
      "/projects/:id/phases/:phaseId/milestones",
      {
        schema: {
          operationId: "listEapMilestones",
          tags: ["EAP"],
          summary: "Listar marcos da fase",
          security: [{ cookieAuth: [] }],
          params: phaseParamsSchema,
          response: {
            200: eapMilestoneListResponseSchema,
            ...milestoneErrorResponses,
          },
        },
      },
      (request) => controller.listMilestones(request),
    );

    app.patch(
      "/projects/:id/phases/:phaseId/milestones/order",
      {
        schema: {
          operationId: "reorderEapMilestones",
          tags: ["EAP"],
          summary: "Reordenar marcos da fase",
          security: [{ cookieAuth: [] }],
          params: phaseParamsSchema,
          body: reorderMilestonesBodySchema,
          response: {
            200: eapMilestoneListResponseSchema,
            ...milestoneErrorResponses,
          },
        },
      },
      (request) => controller.reorderMilestones(request),
    );

    app.post(
      "/projects/:id/phases/:phaseId/milestones",
      {
        schema: {
          operationId: "createEapMilestone",
          tags: ["EAP"],
          summary: "Criar marco da fase",
          security: [{ cookieAuth: [] }],
          params: phaseParamsSchema,
          body: createMilestoneBodySchema,
          response: {
            201: eapMilestoneSchema,
            ...milestoneErrorResponses,
          },
        },
      },
      (request, reply) => controller.createMilestone(request, reply),
    );

    app.get(
      "/projects/:id/phases/:phaseId/milestones/:milestoneId",
      {
        schema: {
          operationId: "getEapMilestone",
          tags: ["EAP"],
          summary: "Consultar marco da fase",
          security: [{ cookieAuth: [] }],
          params: milestoneParamsSchema,
          response: {
            200: eapMilestoneSchema,
            ...milestoneErrorResponses,
          },
        },
      },
      (request) => controller.getMilestone(request),
    );

    app.patch(
      "/projects/:id/phases/:phaseId/milestones/:milestoneId",
      {
        schema: {
          operationId: "updateEapMilestone",
          tags: ["EAP"],
          summary: "Atualizar estrutura do marco",
          security: [{ cookieAuth: [] }],
          params: milestoneParamsSchema,
          body: updateMilestoneBodySchema,
          response: {
            200: eapMilestoneSchema,
            ...milestoneErrorResponses,
          },
        },
      },
      (request) => controller.updateMilestone(request),
    );

    app.post(
      "/projects/:id/phases/:phaseId/milestones/:milestoneId/deliver",
      {
        schema: {
          operationId: "deliverEapMilestone",
          tags: ["EAP"],
          summary: "Registrar entrega do marco",
          security: [{ cookieAuth: [] }],
          params: milestoneParamsSchema,
          body: deliverMilestoneBodySchema,
          response: {
            200: eapMilestoneSchema,
            ...milestoneErrorResponses,
          },
        },
      },
      (request) => controller.deliverMilestone(request),
    );

    app.post(
      "/projects/:id/phases/:phaseId/milestones/:milestoneId/review",
      {
        schema: {
          operationId: "reviewEapMilestone",
          tags: ["EAP"],
          summary: "Aprovar ou rejeitar marco",
          security: [{ cookieAuth: [] }],
          params: milestoneParamsSchema,
          body: reviewMilestoneBodySchema,
          response: {
            200: eapMilestoneSchema,
            ...milestoneErrorResponses,
          },
        },
      },
      (request) => controller.reviewMilestone(request),
    );

    app.get(
      "/projects/:id/evidences",
      {
        schema: {
          operationId: "listEapEvidences",
          tags: ["EAP"],
          summary: "Listar evidências do projeto",
          security: [{ cookieAuth: [] }],
          params: projectIdParamsSchema,
          querystring: listEvidencesQuerySchema,
          response: {
            200: eapEvidenceListResponseSchema,
            ...evidenceErrorResponses,
          },
        },
      },
      (request) => controller.listEvidences(request),
    );

    app.post(
      "/projects/:id/evidences",
      {
        schema: {
          operationId: "createEapEvidence",
          tags: ["EAP"],
          summary: "Registrar evidência do projeto",
          security: [{ cookieAuth: [] }],
          params: projectIdParamsSchema,
          body: createEvidenceBodySchema,
          response: {
            201: eapEvidenceSchema,
            ...evidenceErrorResponses,
          },
        },
      },
      (request, reply) => controller.createEvidence(request, reply),
    );

    app.get(
      "/projects/:id/evidences/:evidenceId",
      {
        schema: {
          operationId: "getEapEvidence",
          tags: ["EAP"],
          summary: "Consultar evidência do projeto",
          security: [{ cookieAuth: [] }],
          params: evidenceParamsSchema,
          response: {
            200: eapEvidenceSchema,
            ...evidenceErrorResponses,
          },
        },
      },
      (request) => controller.getEvidence(request),
    );

    app.patch(
      "/projects/:id/evidences/:evidenceId",
      {
        schema: {
          operationId: "updateEapEvidence",
          tags: ["EAP"],
          summary: "Atualizar evidência do projeto",
          security: [{ cookieAuth: [] }],
          params: evidenceParamsSchema,
          body: updateEvidenceBodySchema,
          response: {
            200: eapEvidenceSchema,
            ...evidenceErrorResponses,
          },
        },
      },
      (request) => controller.updateEvidence(request),
    );

    app.get(
      "/projects/:id/audit",
      {
        schema: {
          operationId: "listEapAudit",
          tags: ["EAP"],
          summary: "Listar histórico de alterações de um item da EAP",
          security: [{ cookieAuth: [] }],
          params: projectIdParamsSchema,
          querystring: listAuditQuerySchema,
          response: {
            200: eapAuditListResponseSchema,
            ...auditErrorResponses,
          },
        },
      },
      (request) => controller.listAudit(request),
    );
  };
}

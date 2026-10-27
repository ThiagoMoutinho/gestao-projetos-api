import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { requireAuth } from "../../lib/session";
import type { EapController } from "./eap.controller";
import { importEapBodySchema, importEapResponseSchema } from "./schemas/eap-import.schema";
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
  eapImpedimentChangeResponseSchema,
  eapImpedimentListResponseSchema,
  impedimentParamsSchema,
  registerImpedimentBodySchema,
  resolveImpedimentBodySchema,
  updateImpedimentBodySchema,
} from "./schemas/eap-impediments.schema";
import {
  authorizeResubmissionBodySchema,
  createMilestoneBodySchema,
  deliverMilestoneBodySchema,
  eapMilestoneDeliveryListResponseSchema,
  eapMilestoneListResponseSchema,
  eapMilestoneSchema,
  milestoneErrorResponses,
  milestoneParamsSchema,
  reorderMilestonesBodySchema,
  reviewMilestoneBodySchema,
  updateMilestoneBodySchema,
} from "./schemas/eap-milestones.schema";
import {
  eapScheduleChangeListResponseSchema,
  eapScheduleChangeSchema,
  eapScheduleMonitoringSchema,
  listScheduleChangesQuerySchema,
  rescheduleMilestoneBodySchema,
  rescheduleRangeBodySchema,
  scheduleErrorResponses,
} from "./schemas/eap-schedule.schema";
import {
  createTaskBodySchema,
  eapTaskListResponseSchema,
  eapTaskSchema,
  reorderTasksBodySchema,
  taskErrorResponses,
  taskParamsSchema,
  taskStatusDecisionBodySchema,
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

    app.post(
      "/projects/:id/eap/import",
      {
        schema: {
          operationId: "importEap",
          tags: ["EAP"],
          summary: "Importar EAP por planilha (pré-visualização ou confirmação)",
          description:
            "Valida fases, tarefas e marcos da planilha e devolve os erros por linha. Com confirm=true e sem erros, grava todos os itens numa única transação.",
          security: [{ cookieAuth: [] }],
          params: projectIdParamsSchema,
          body: importEapBodySchema,
          response: {
            200: importEapResponseSchema,
            ...errorResponses,
          },
        },
      },
      (request) => controller.importEap(request),
    );

    app.post(
      "/projects/:id/closure",
      {
        schema: {
          operationId: "closeProject",
          tags: ["Projetos"],
          summary: "Encerrar formalmente o projeto",
          description:
            "Conclui o projeto quando o backend confirma que está apto (fases concluídas, marcos aceitos, sem homologação pendente, não suspenso). Registra o encerramento no histórico.",
          security: [{ cookieAuth: [] }],
          params: projectIdParamsSchema,
          response: {
            200: z.object({
              projectId: z.string(),
              status: z.literal("CONCLUIDO"),
              closedAt: z.string(),
              closedBy: z.string(),
            }),
            ...errorResponses,
          },
        },
      },
      (request) => controller.closeProject(request),
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

    app.delete(
      "/projects/:id/phases/:phaseId",
      {
        schema: {
          operationId: "deleteEapPhase",
          tags: ["EAP"],
          summary: "Excluir fase sem itens nem histórico formal",
          description:
            "Somente a gestão do projeto. Retorna 409 quando a fase possui tarefas, marcos, evidências ou replanejamentos.",
          security: [{ cookieAuth: [] }],
          params: phaseParamsSchema,
          response: {
            204: z.undefined(),
            ...errorResponses,
          },
        },
      },
      (request, reply) => controller.delete(request, reply),
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

    app.post(
      "/projects/:id/phases/:phaseId/tasks/:taskId/cancel",
      {
        schema: {
          operationId: "cancelEapTask",
          tags: ["EAP"],
          summary: "Cancelar tarefa",
          description:
            "Somente a gestão do projeto, com justificativa. Retorna 409 quando a tarefa já está cancelada ou concluída.",
          security: [{ cookieAuth: [] }],
          params: taskParamsSchema,
          body: taskStatusDecisionBodySchema,
          response: {
            200: eapTaskSchema,
            ...taskErrorResponses,
          },
        },
      },
      (request) => controller.cancelTask(request),
    );

    app.post(
      "/projects/:id/phases/:phaseId/tasks/:taskId/reactivate",
      {
        schema: {
          operationId: "reactivateEapTask",
          tags: ["EAP"],
          summary: "Reativar tarefa cancelada",
          description:
            "Somente a gestão do projeto, com justificativa. A situação volta a ser derivada do percentual.",
          security: [{ cookieAuth: [] }],
          params: taskParamsSchema,
          body: taskStatusDecisionBodySchema,
          response: {
            200: eapTaskSchema,
            ...taskErrorResponses,
          },
        },
      },
      (request) => controller.reactivateTask(request),
    );

    app.get(
      "/projects/:id/phases/:phaseId/tasks/:taskId/impediments",
      {
        schema: {
          operationId: "listEapTaskImpediments",
          tags: ["EAP"],
          summary: "Listar impedimentos da tarefa",
          description: "Impedimentos em aberto e resolvidos, do mais recente para o mais antigo.",
          security: [{ cookieAuth: [] }],
          params: taskParamsSchema,
          response: {
            200: eapImpedimentListResponseSchema,
            ...taskErrorResponses,
          },
        },
      },
      (request) => controller.listImpediments(request),
    );

    app.post(
      "/projects/:id/phases/:phaseId/tasks/:taskId/impediments",
      {
        schema: {
          operationId: "registerEapTaskImpediment",
          tags: ["EAP"],
          summary: "Registrar impedimento da tarefa",
          description:
            "Exige motivo. Não altera percentual, situação, linha de base nem datas planejadas. Retorna 409 quando já existe impedimento em aberto ou a tarefa está cancelada ou concluída.",
          security: [{ cookieAuth: [] }],
          params: taskParamsSchema,
          body: registerImpedimentBodySchema,
          response: {
            201: eapImpedimentChangeResponseSchema,
            ...taskErrorResponses,
          },
        },
      },
      (request, reply) => controller.registerImpediment(request, reply),
    );

    app.patch(
      "/projects/:id/phases/:phaseId/tasks/:taskId/impediments/:impedimentId",
      {
        schema: {
          operationId: "updateEapTaskImpediment",
          tags: ["EAP"],
          summary: "Atualizar motivo do impedimento em aberto",
          description: "O motivo anterior permanece na auditoria.",
          security: [{ cookieAuth: [] }],
          params: impedimentParamsSchema,
          body: updateImpedimentBodySchema,
          response: {
            200: eapImpedimentChangeResponseSchema,
            ...taskErrorResponses,
          },
        },
      },
      (request) => controller.updateImpediment(request),
    );

    app.post(
      "/projects/:id/phases/:phaseId/tasks/:taskId/impediments/resolve",
      {
        schema: {
          operationId: "resolveEapTaskImpediment",
          tags: ["EAP"],
          summary: "Resolver impedimento da tarefa",
          description:
            "Exige nota de resolução. Registra quem resolveu, quando e o tempo em aberto. Não altera percentual, situação, linha de base nem datas planejadas.",
          security: [{ cookieAuth: [] }],
          params: taskParamsSchema,
          body: resolveImpedimentBodySchema,
          response: {
            200: eapImpedimentChangeResponseSchema,
            ...taskErrorResponses,
          },
        },
      },
      (request) => controller.resolveImpediment(request),
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

    app.delete(
      "/projects/:id/phases/:phaseId/tasks/:taskId",
      {
        schema: {
          operationId: "deleteEapTask",
          tags: ["EAP"],
          summary: "Excluir tarefa sem movimentação",
          description:
            "Somente a gestão do projeto. Retorna 409 quando a tarefa está concluída ou possui evidências, impedimentos ou replanejamentos.",
          security: [{ cookieAuth: [] }],
          params: taskParamsSchema,
          response: {
            204: z.undefined(),
            ...taskErrorResponses,
          },
        },
      },
      (request, reply) => controller.deleteTask(request, reply),
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

    app.delete(
      "/projects/:id/phases/:phaseId/milestones/:milestoneId",
      {
        schema: {
          operationId: "deleteEapMilestone",
          tags: ["EAP"],
          summary: "Excluir marco pendente sem histórico formal",
          description:
            "Somente a gestão do projeto. Retorna 409 quando o marco já foi entregue, aceito ou devolvido, ou possui evidências ou replanejamentos.",
          security: [{ cookieAuth: [] }],
          params: milestoneParamsSchema,
          response: {
            204: z.undefined(),
            ...milestoneErrorResponses,
          },
        },
      },
      (request, reply) => controller.deleteMilestone(request, reply),
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
          summary: "Aceitar, solicitar correções ou rejeitar a entrega do marco",
          description:
            "Somente o homologador designado no marco ou, sem designação, o dono e quem tem DONO_PROJETO/GESTOR no projeto. Quem enviou a rodada não decide.",
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

    app.post(
      "/projects/:id/phases/:phaseId/milestones/:milestoneId/resubmission",
      {
        schema: {
          operationId: "authorizeEapMilestoneResubmission",
          tags: ["EAP"],
          summary: "Autorizar nova submissão após rejeição",
          description: "PMO, ADMIN ou a gestão do projeto, com justificativa.",
          security: [{ cookieAuth: [] }],
          params: milestoneParamsSchema,
          body: authorizeResubmissionBodySchema,
          response: {
            200: eapMilestoneSchema,
            ...milestoneErrorResponses,
          },
        },
      },
      (request) => controller.authorizeResubmission(request),
    );

    app.get(
      "/projects/:id/phases/:phaseId/milestones/:milestoneId/deliveries",
      {
        schema: {
          operationId: "listEapMilestoneDeliveries",
          tags: ["EAP"],
          summary: "Listar rodadas de homologação do marco",
          security: [{ cookieAuth: [] }],
          params: milestoneParamsSchema,
          response: {
            200: eapMilestoneDeliveryListResponseSchema,
            ...milestoneErrorResponses,
          },
        },
      },
      (request) => controller.listMilestoneDeliveries(request),
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
          summary: "Listar histórico de alterações de um item da EAP, do projeto ou de um participante",
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

    const rescheduleDescription =
      "ADMIN, PMO ou gestão do projeto (dono, DONO_PROJETO, GESTOR). A primeira definição grava a linha de base e não conta como reprogramação; depois, exige justificativa, preserva o planejamento original e apenas sinaliza impactos.";

    app.post(
      "/projects/:id/reschedule",
      {
        schema: {
          operationId: "rescheduleProject",
          tags: ["Cronograma"],
          summary: "Definir ou reprogramar o planejamento do projeto",
          description: rescheduleDescription,
          security: [{ cookieAuth: [] }],
          params: projectIdParamsSchema,
          body: rescheduleRangeBodySchema,
          response: {
            200: eapScheduleChangeSchema,
            ...scheduleErrorResponses,
          },
        },
      },
      (request) => controller.rescheduleProject(request),
    );

    app.post(
      "/projects/:id/phases/:phaseId/reschedule",
      {
        schema: {
          operationId: "rescheduleEapPhase",
          tags: ["Cronograma"],
          summary: "Definir ou reprogramar o planejamento da fase",
          description: rescheduleDescription,
          security: [{ cookieAuth: [] }],
          params: phaseParamsSchema,
          body: rescheduleRangeBodySchema,
          response: {
            200: eapScheduleChangeSchema,
            ...scheduleErrorResponses,
          },
        },
      },
      (request) => controller.reschedulePhase(request),
    );

    app.post(
      "/projects/:id/phases/:phaseId/tasks/:taskId/reschedule",
      {
        schema: {
          operationId: "rescheduleEapTask",
          tags: ["Cronograma"],
          summary: "Definir ou reprogramar o planejamento da tarefa",
          description: rescheduleDescription,
          security: [{ cookieAuth: [] }],
          params: taskParamsSchema,
          body: rescheduleRangeBodySchema,
          response: {
            200: eapScheduleChangeSchema,
            ...scheduleErrorResponses,
          },
        },
      },
      (request) => controller.rescheduleTask(request),
    );

    app.post(
      "/projects/:id/phases/:phaseId/milestones/:milestoneId/reschedule",
      {
        schema: {
          operationId: "rescheduleEapMilestone",
          tags: ["Cronograma"],
          summary: "Definir ou reprogramar a data prevista do marco",
          description: rescheduleDescription,
          security: [{ cookieAuth: [] }],
          params: milestoneParamsSchema,
          body: rescheduleMilestoneBodySchema,
          response: {
            200: eapScheduleChangeSchema,
            ...scheduleErrorResponses,
          },
        },
      },
      (request) => controller.rescheduleMilestone(request),
    );

    app.get(
      "/projects/:id/schedule-changes",
      {
        schema: {
          operationId: "listScheduleChanges",
          tags: ["Cronograma"],
          summary: "Histórico de planejamento e reprogramações de um item",
          security: [{ cookieAuth: [] }],
          params: projectIdParamsSchema,
          querystring: listScheduleChangesQuerySchema,
          response: {
            200: eapScheduleChangeListResponseSchema,
            ...scheduleErrorResponses,
          },
        },
      },
      (request) => controller.listScheduleChanges(request),
    );

    app.get(
      "/projects/:id/schedule-monitoring",
      {
        schema: {
          operationId: "getScheduleMonitoring",
          tags: ["Cronograma"],
          summary: "Indicadores de prazo, reprogramação e homologação do projeto",
          security: [{ cookieAuth: [] }],
          params: projectIdParamsSchema,
          response: {
            200: eapScheduleMonitoringSchema,
            ...scheduleErrorResponses,
          },
        },
      },
      (request) => controller.getScheduleMonitoring(request),
    );
  };
}

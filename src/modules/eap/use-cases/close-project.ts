import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import { canCloseProject } from "../eap.authorization";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import { loadProjectSituation } from "./project-situation";
import { assertCanView, loadProjectAccess } from "./shared";

export type ProjectClosureDto = { projectId: string; status: "CONCLUIDO"; closedAt: string; closedBy: string };

/**
 * Encerramento formal do projeto. Só a gestão autorizada encerra, e só quando o backend confirma, na
 * mesma transação, que o projeto está apto (todas as fases concluídas pela regra da EAP, marcos aceitos,
 * sem homologação pendente, não suspenso). Grava a situação Concluído e o evento no histórico do projeto,
 * que vale como decisão formal; EAP, datas, evidências e homologações não são alteradas.
 */
export function makeCloseProjectUseCase(deps: { repos: EapRepos; runInTransaction: EapTransactionRunner }) {
  return async function closeProject(actor: AuthUser, projectId: string, now = new Date()): Promise<ProjectClosureDto> {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    if (!canCloseProject(context)) {
      throw new HttpError(
        403,
        "Somente a gestão do projeto, a coordenação ou o PMO podem encerrar o projeto.",
        "PROJECT_CLOSE_FORBIDDEN",
      );
    }

    return deps.runInTransaction(async (txRepos) => {
      const project = await txRepos.projects.findById(projectId);
      if (!project) {
        throw new HttpError(404, "Projeto não encontrado.", "PROJECT_NOT_FOUND");
      }
      const situation = await loadProjectSituation(txRepos, project, now);
      if (situation.formalDecision?.status === "CONCLUIDO" || project.status === "CONCLUIDO") {
        throw new HttpError(409, "O projeto já está encerrado.", "PROJECT_ALREADY_CLOSED");
      }
      if (situation.status === "SUSPENSO") {
        throw new HttpError(409, "Projeto suspenso não pode ser encerrado.", "PROJECT_SUSPENDED");
      }
      if (!situation.readyForClosure) {
        throw new HttpError(
          409,
          "O projeto ainda não está apto para encerramento: todas as fases precisam estar concluídas, com os marcos aceitos e sem homologação pendente.",
          "PROJECT_NOT_READY_FOR_CLOSURE",
        );
      }

      const updated = await txRepos.projects.update(projectId, { status: "CONCLUIDO", updatedAt: now });
      if (!updated) {
        throw new HttpError(404, "Projeto não encontrado.", "PROJECT_NOT_FOUND");
      }
      await txRepos.audit.create({
        id: crypto.randomUUID(),
        projectId,
        entityType: "PROJECT",
        entityId: projectId,
        action: "STATUS_CHANGE",
        summary: `Projeto "${project.name}" encerrado formalmente.`,
        payload: { automatic: false, kind: "PROJECT_CLOSURE", from: project.status, to: "CONCLUIDO" },
        actorId: actor.id,
      });

      return { projectId, status: "CONCLUIDO", closedAt: now.toISOString(), closedBy: actor.id };
    });
  };
}

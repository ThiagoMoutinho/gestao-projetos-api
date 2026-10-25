import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import type { EapRepos } from "../repositories/contracts";
import {
  assertCanUpdateTaskProgress,
  assertCanView,
  loadPhaseInProject,
  loadProjectAccess,
  loadTaskInPhase,
} from "./shared";

/** Impedimento segue a mesma permissão da execução da tarefa: gestão do item ou responsável. */
export async function loadTaskForImpediment(
  repos: EapRepos,
  actor: AuthUser,
  projectId: string,
  phaseId: string,
  taskId: string,
) {
  const { context } = await loadProjectAccess(repos, actor, projectId);
  assertCanView(context);
  await loadPhaseInProject(repos, projectId, phaseId);
  const task = await loadTaskInPhase(repos, phaseId, taskId);
  assertCanUpdateTaskProgress(context, task);
  return task;
}

export function impedimentAlreadyOpenError() {
  return new HttpError(
    409,
    "Esta tarefa já possui um impedimento em aberto. Atualize o motivo ou resolva o impedimento atual.",
    "IMPEDIMENT_ALREADY_OPEN",
  );
}

export function impedimentNotOpenError() {
  return new HttpError(409, "Esta tarefa não possui impedimento em aberto.", "IMPEDIMENT_NOT_OPEN");
}

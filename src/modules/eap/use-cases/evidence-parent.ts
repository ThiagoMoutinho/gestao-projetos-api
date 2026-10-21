import type { CreateEvidenceInput } from "../dtos/eap-evidences.dto";
import type { EapEvidenceParentAccess } from "../eap.authorization";
import type { EapRepos } from "../repositories/contracts";
import { evidenceParentNotFoundError } from "./shared";

export async function assertEvidenceParentInProject(
  repos: EapRepos,
  projectId: string,
  parent: {
    [Key in keyof Pick<
      CreateEvidenceInput,
      "phaseId" | "taskId" | "milestoneId" | "scheduleRequestId"
    >]?: string | null;
  },
): Promise<EapEvidenceParentAccess | null> {
  if (parent.phaseId) {
    const phase = await repos.phases.findById(parent.phaseId);
    if (!phase || phase.projectId !== projectId) {
      throw evidenceParentNotFoundError();
    }
    return { createdBy: phase.createdBy, assigneeId: phase.responsibleId };
  }

  if (parent.taskId) {
    const task = await repos.tasks.findById(parent.taskId);
    const phase = task ? await repos.phases.findById(task.phaseId) : null;
    if (!task || !phase || phase.projectId !== projectId) {
      throw evidenceParentNotFoundError();
    }
    return { createdBy: task.createdBy, assigneeId: task.assigneeId };
  }

  if (parent.milestoneId) {
    const milestone = await repos.milestones.findById(parent.milestoneId);
    const phase = milestone ? await repos.phases.findById(milestone.phaseId) : null;
    if (!milestone || !phase || phase.projectId !== projectId) {
      throw evidenceParentNotFoundError();
    }
    return { createdBy: milestone.createdBy, assigneeId: null };
  }

  if (parent.scheduleRequestId) {
    const request = await repos.scheduleRequests.findById(parent.scheduleRequestId);
    if (!request || request.projectId !== projectId) {
      throw evidenceParentNotFoundError();
    }
  }

  return null;
}

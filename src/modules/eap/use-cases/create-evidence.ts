import type { AuthUser } from "../../../lib/session";
import type { CreateEvidenceInput } from "../dtos/eap-evidences.dto";
import { toEapEvidenceDto } from "../dtos/eap-evidences.dto";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import { assertEvidenceParentInProject } from "./evidence-parent";
import { assertCanRegisterEvidenceOn, assertCanView, evidenceKindError, loadProjectAccess } from "./shared";

export function makeCreateEvidenceUseCase(deps: {
  repos: EapRepos;
  runInTransaction: EapTransactionRunner;
}) {
  return async function createEvidence(
    actor: AuthUser,
    projectId: string,
    input: CreateEvidenceInput,
  ) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    const parent = await assertEvidenceParentInProject(deps.repos, projectId, input);
    assertCanRegisterEvidenceOn(context, parent);

    const isTicket = input.kind === "GLPI_TICKET";
    // Chamado GLPI sem título usa "GLPI #número". O cadastro é só um vínculo com um chamado existente.
    const title = input.title ?? (isTicket ? `GLPI #${input.ticketNumber}` : undefined);
    if (!title || (isTicket && !input.ticketNumber)) {
      throw evidenceKindError("Informe o título da evidência ou o número do chamado GLPI.");
    }

    const created = await deps.runInTransaction(async (txRepos) => {
      await assertEvidenceParentInProject(txRepos, projectId, input);

      const evidence = await txRepos.evidences.create({
        id: crypto.randomUUID(),
        phaseId: input.phaseId ?? null,
        taskId: input.taskId ?? null,
        milestoneId: input.milestoneId ?? null,
        scheduleRequestId: input.scheduleRequestId ?? null,
        projectId: input.projectLevel ? projectId : null,
        title,
        url: input.url,
        kind: input.kind ?? null,
        ticketNumber: isTicket ? (input.ticketNumber ?? null) : null,
        createdBy: actor.id,
      });

      await txRepos.audit.create({
        id: crypto.randomUUID(),
        projectId,
        entityType: "EVIDENCE",
        entityId: evidence.id,
        action: "CREATE",
        summary: `Evidência "${evidence.title}" registrada.`,
        payload: {
          phaseId: evidence.phaseId,
          taskId: evidence.taskId,
          milestoneId: evidence.milestoneId,
          scheduleRequestId: evidence.scheduleRequestId,
          projectId: evidence.projectId,
          title: evidence.title,
          url: evidence.url,
          kind: evidence.kind,
          ticketNumber: evidence.ticketNumber,
        },
        actorId: actor.id,
      });

      return evidence;
    });

    return toEapEvidenceDto(created);
  };
}

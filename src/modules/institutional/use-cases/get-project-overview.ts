import type { AuthUser } from "../../../lib/session";
import { toEapEvidenceDto } from "../../eap/dtos/eap-evidences.dto";
import {
  person,
  toEvolutionView,
  toGlpiTicket,
  toProfileFieldView,
  toResultView,
  type ProjectOverviewDto,
} from "../dtos/institutional.dto";
import {
  canEditInstitutional,
  canRegisterResults,
  canValidateInstitutional,
  canValidateResults,
  ownResultsOnly,
} from "../institutional.authorization";
import type { InstitutionalRepos, ProfileField } from "../repositories/contracts";
import { buildLinkIndex, loadNames, loadViewableProject } from "./shared";

/**
 * Contrato de leitura da Visão Institucional: reúne cadastro, perfil validado, resultados, evoluções reais
 * da EAP e evidências. Reutilizável pela Visão Geral e pelo futuro Painel do Gestor IGEPPS.
 * Nada aqui é calculado de forma fictícia: o que não foi registrado sai como vazio.
 */
export function makeGetProjectOverviewUseCase(deps: { repos: InstitutionalRepos; glpiBaseUrl: string | null }) {
  return async function getProjectOverview(actor: AuthUser, projectId: string): Promise<ProjectOverviewDto> {
    const { project, context } = await loadViewableProject(deps.repos, actor, projectId);
    const canEdit = canEditInstitutional(context);
    const canValidate = canValidateInstitutional(context);
    const canRegister = canRegisterResults(context);
    const canValidateAchieved = canValidateResults(context);
    // Rascunhos (alcançados pendentes, correções) aparecem a quem cadastra ou valida resultados.
    const canSeeDraft = canEdit || canValidate || canRegister || canValidateAchieved;
    const { institutional } = deps.repos;

    const [fields, results, resultLinks, highlights, evolutions, evidences, members] = await Promise.all([
      institutional.listProfileFields(projectId),
      institutional.listResults(projectId),
      institutional.listResultLinks(projectId),
      institutional.listHighlights(projectId),
      institutional.listApprovedMilestones(projectId),
      deps.repos.evidences.listByProject(projectId, {}),
      deps.repos.members.listByProject(projectId),
    ]);

    const resultMilestoneIds = [
      ...new Set(
        results.flatMap((row) => [row.publishedMilestoneId, row.draftMilestoneId]).filter((id): id is string => Boolean(id)),
      ),
    ];
    const milestoneRefs = await Promise.all(resultMilestoneIds.map((id) => institutional.findMilestoneInProject(projectId, id)));
    const milestoneTitles = new Map(
      milestoneRefs.flatMap((ref) => (ref ? ([[ref.id, ref.title]] as const) : [])),
    );

    const names = await loadNames(deps.repos, [
      project.ownerId,
      ...members.map((item) => item.user.id),
      ...fields.flatMap((row) => [row.publishedBy, row.validatedBy, row.draftBy]),
      ...results.flatMap((row) => [row.createdBy, row.publishedBy, row.validatedBy, row.draftBy, row.correctionBy]),
    ]);

    const rowByField = new Map(fields.map((row) => [row.field, row]));
    const view = (field: ProfileField) => toProfileFieldView(field, rowByField.get(field), names, canSeeDraft);
    const highlightByMilestone = new Map(highlights.map((row) => [row.milestoneId, row]));
    const linkIndex = buildLinkIndex(results, resultLinks);
    const resultViews = results.map((row) => toResultView(row, names, milestoneTitles, canSeeDraft, linkIndex));
    // Resultado ainda sem versão publicada só aparece para quem pode editar ou validar.
    const visibleResults = resultViews.filter((item) => canSeeDraft || item.published !== null);
    const byRole = (role: string) =>
      members
        .filter((item) => item.member.role === role)
        .map((item) => person(names, item.user.id));

    return {
      project: { id: project.id, name: project.name, status: project.status },
      origin: {
        glpiTicket: toGlpiTicket(project.glpiTicketId, deps.glpiBaseUrl),
        pmoGlpiTicket: toGlpiTicket(project.pmoGlpiTicketId, deps.glpiBaseUrl),
        requestingArea: view("REQUESTING_AREA"),
      },
      responsible: { owner: person(names, project.ownerId), managers: byRole("GESTOR"), suppliers: byRole("FORNECEDOR") },
      profile: {
        systemDescription: view("SYSTEM_DESCRIPTION"),
        resultsSummary: view("RESULTS_SUMMARY"),
        purpose: view("PURPOSE"),
        scope: view("SCOPE"),
        problem: view("PROBLEM"),
        responsibleCompany: view("RESPONSIBLE_COMPANY"),
        benefitedSectors: view("BENEFITED_SECTORS"),
      },
      results: {
        expected: visibleResults.filter((item) => item.type === "ESPERADO"),
        achieved: visibleResults.filter((item) => item.type === "ALCANCADO"),
      },
      evolutions: evolutions.map((row) => toEvolutionView(row, highlightByMilestone)),
      evidences: evidences.map(toEapEvidenceDto),
      permissions: {
        canEdit,
        canValidate,
        canRegisterResults: canRegister,
        canValidateResults: canValidateAchieved,
        ownResultsOnly: ownResultsOnly(context),
      },
    };
  };
}

import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import type { ProjectAccessContext } from "../../projects/projects.authorization";
import type { ProjectAuditAction } from "../../projects/repositories/contracts";
import { assertCanView, loadProjectAccess } from "../../projects/use-cases/shared";
import {
  canEditInstitutional,
  canRegisterResults,
  canValidateInstitutional,
  canValidateResults,
  ownResultsOnly,
} from "../institutional.authorization";
import type { ResultLinkIndex } from "../dtos/institutional.dto";
import type { InstitutionalRepos, ResultLinkRow, ResultRow } from "../repositories/contracts";
import type { ProfileField } from "../repositories/contracts";

/**
 * Todos os campos de "Sobre o projeto" são informados diretamente pelo gestor: valem assim que salvos, sem rascunho
 * nem validação do PMO. O mecanismo de rascunho e validação continua só para rascunhos antigos e para os resultados.
 */
export const DIRECT_PUBLISH_FIELDS: ReadonlySet<ProfileField> = new Set<ProfileField>([
  "PURPOSE",
  "SCOPE",
  "PROBLEM",
  "REQUESTING_AREA",
  "RESPONSIBLE_COMPANY",
  "BENEFITED_SECTORS",
  "SYSTEM_DESCRIPTION",
  "RESULTS_SUMMARY",
]);

/** Limite do valor persistido (Markdown incluído). Só os dois campos narrativos novos aceitam mais de 4.000. */
const PROFILE_DEFAULT_MAX = 4000;
export const PROFILE_MAX_LENGTH: Partial<Record<ProfileField, number>> = { SYSTEM_DESCRIPTION: 8000, RESULTS_SUMMARY: 8000 };
export const profileMaxLength = (field: ProfileField) => PROFILE_MAX_LENGTH[field] ?? PROFILE_DEFAULT_MAX;

export const FIELD_LABELS: Record<ProfileField, string> = {
  PURPOSE: "Finalidade",
  SCOPE: "Escopo",
  PROBLEM: "Problema que resolve",
  REQUESTING_AREA: "Área Solicitante",
  RESPONSIBLE_COMPANY: "Empresa Responsável",
  BENEFITED_SECTORS: "Setores Beneficiados",
  SYSTEM_DESCRIPTION: "O que o sistema faz",
  RESULTS_SUMMARY: "Síntese dos Resultados Institucionais",
};

/** Carrega o projeto e confere que o usuário pode consultá-lo (a mesma regra do cadastro do projeto). */
export async function loadViewableProject(repos: InstitutionalRepos, actor: AuthUser, projectId: string) {
  const { project, context } = await loadProjectAccess(repos, actor, projectId);
  assertCanView(context);
  return { project, context };
}

export function assertCanEditInstitutional(context: ProjectAccessContext) {
  if (!canEditInstitutional(context)) {
    throw new HttpError(
      403,
      "Você não tem permissão para editar as informações institucionais deste projeto.",
      "INSTITUTIONAL_EDIT_FORBIDDEN",
    );
  }
}

export function assertCanRegisterResults(context: ProjectAccessContext, createdBy?: string, actorId?: string) {
  if (!canRegisterResults(context)) {
    throw new HttpError(403, "Você não tem permissão para cadastrar resultados deste projeto.", "RESULT_EDIT_FORBIDDEN");
  }
  // Fornecedor só altera o que ele mesmo cadastrou.
  if (createdBy !== undefined && ownResultsOnly(context) && createdBy !== actorId) {
    throw new HttpError(403, "O fornecedor só pode alterar os resultados que cadastrou.", "RESULT_EDIT_FORBIDDEN");
  }
}

export function assertCanValidateResults(context: ProjectAccessContext) {
  if (!canValidateResults(context)) {
    throw new HttpError(
      403,
      "Somente o PMO, o coordenador da CTIN ou o gestor do projeto podem validar resultados alcançados.",
      "RESULT_VALIDATE_FORBIDDEN",
    );
  }
}

export function assertCanValidateInstitutional(context: ProjectAccessContext) {
  if (!canValidateInstitutional(context)) {
    throw new HttpError(
      403,
      "Somente o PMO ou a administração podem validar informações institucionais.",
      "INSTITUTIONAL_VALIDATE_FORBIDDEN",
    );
  }
}

export const selfValidationError = () =>
  new HttpError(
    409,
    "Quem redigiu a alteração não pode validá-la. Outro usuário autorizado deve decidir.",
    "INSTITUTIONAL_SELF_VALIDATION",
  );

export const noPendingChangeError = () =>
  new HttpError(409, "Não há alteração aguardando validação.", "INSTITUTIONAL_NO_PENDING_CHANGE");

export const unchangedValueError = () =>
  new HttpError(409, "O texto informado é igual à versão atual.", "INSTITUTIONAL_NO_CHANGE");

export const resultNotFoundError = () => new HttpError(404, "Resultado não encontrado.", "PROJECT_RESULT_NOT_FOUND");

export const milestoneNotFoundError = () =>
  new HttpError(404, "Marco não encontrado neste projeto.", "MILESTONE_NOT_FOUND");

export type AuditInput = {
  entityType: "PROJECT_PROFILE" | "PROJECT_RESULT" | "PROJECT_HIGHLIGHT";
  entityId: string;
  action: ProjectAuditAction;
  summary: string;
  payload: Record<string, unknown>;
};

/** Registra o evento na trilha de auditoria do projeto, com tipo de entidade próprio (separado da EAP). */
export async function recordInstitutionalAudit(
  repos: InstitutionalRepos,
  data: AuditInput & { projectId: string; actorId: string },
) {
  await repos.audit.create(data);
}

/** Nomes dos usuários citados no contrato; usuário removido aparece sem nome, sem quebrar a consulta. */
export async function loadNames(repos: InstitutionalRepos, ids: Iterable<string | null | undefined>) {
  const unique = [...new Set([...ids].filter((id): id is string => Boolean(id)))];
  const users = await Promise.all(unique.map((id) => repos.users.findById(id)));
  return new Map<string, string | null>(unique.map((id, index) => [id, users[index]?.name?.trim() || null]));
}

/** Vínculos alcançado → esperados e contagem de aferições por esperado, para a apresentação dos resultados. */
export function buildLinkIndex(results: ResultRow[], links: ResultLinkRow[]): ResultLinkIndex {
  const textOf = new Map(results.map((row) => [row.id, row.publishedText ?? row.draftText ?? ""] as const));
  const index = new Map<string, { expected: { id: string; text: string }[]; achievedCount: number }>();
  const entry = (id: string) => {
    const current = index.get(id) ?? { expected: [], achievedCount: 0 };
    index.set(id, current);
    return current;
  };
  for (const link of links) {
    if (!textOf.has(link.achievedId) || !textOf.has(link.expectedId)) {
      continue;
    }
    entry(link.achievedId).expected.push({ id: link.expectedId, text: textOf.get(link.expectedId) as string });
    entry(link.expectedId).achievedCount += 1;
  }
  return index;
}

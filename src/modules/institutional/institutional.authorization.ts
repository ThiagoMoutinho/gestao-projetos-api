import {
  hasProjectManagementRole,
  isProjectOwner,
  type ProjectAccessContext,
} from "../projects/projects.authorization";

/** Cadastro e edição das informações institucionais: PMO, administração, dono e gestor do projeto. */
export function canEditInstitutional(context: ProjectAccessContext): boolean {
  if (context.globalRole === "ADMIN" || context.globalRole === "PMO") {
    return true;
  }

  if (context.globalRole === "FORNECEDOR" || context.globalRole === "COLABORADOR") {
    return false;
  }

  return isProjectOwner(context.userId, context.ownerId) || hasProjectManagementRole(context.memberRoles);
}

/** Validação para publicação institucional: somente PMO ou administração (a autovalidação é barrada à parte). */
export function canValidateInstitutional(context: ProjectAccessContext): boolean {
  return context.globalRole === "ADMIN" || context.globalRole === "PMO";
}

/** Fornecedor vinculado ao projeto (perfil global ou papel no projeto). */
function isSupplier(context: ProjectAccessContext): boolean {
  return context.globalRole === "FORNECEDOR" || context.memberRoles.includes("FORNECEDOR");
}

/**
 * Cadastro e edição dos resultados: quem edita as informações institucionais, o COORDENADOR (CTIN) e o
 * fornecedor vinculado. O acesso ao projeto já foi conferido por quem chama.
 */
export function canRegisterResults(context: ProjectAccessContext): boolean {
  return canEditInstitutional(context) || context.globalRole === "COORDENADOR" || isSupplier(context);
}

/** Fornecedor altera apenas os resultados que ele mesmo cadastrou. */
export function ownResultsOnly(context: ProjectAccessContext): boolean {
  return isSupplier(context) && !canEditInstitutional(context) && context.globalRole !== "COORDENADOR";
}

/**
 * Valida ou rejeita resultados alcançados: PMO e COORDENADOR (CTIN) em todos os projetos e o gestor do projeto
 * (dono ou gestor) nos projetos em que atua. ADMIN não valida só por ser administrador; fornecedor nunca valida.
 * A autovalidação é barrada à parte (autor do rascunho e validador diferentes).
 */
export function canValidateResults(context: ProjectAccessContext): boolean {
  if (context.globalRole === "PMO" || context.globalRole === "COORDENADOR") {
    return true;
  }
  if (isSupplier(context)) {
    return false;
  }
  return isProjectOwner(context.userId, context.ownerId) || hasProjectManagementRole(context.memberRoles);
}

import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import { canValidateExecutiveSummary, canViewProjectGovernanceAudit } from "../eap.authorization";
import { ExecutiveSummaryRegularConflictError, type EapRepos, type EapTransactionRunner } from "../repositories/contracts";
import type {
  ExecutiveSummarySnapshotDto,
  ExecutiveSummaryValidationItemDto,
} from "../schemas/eap-executive-summary.schema";
import { executiveCycleOf } from "./executive-cycle";
import { makeBuildExecutiveSummary, toValidationItemDto } from "./get-executive-summary";
import { assertCanView, loadProjectAccess } from "./shared";

export type ValidateExecutiveSummaryInput = {
  observation?: string;
  extraordinary?: boolean;
  withoutChanges?: boolean;
  fingerprint: string;
};

const SNAPSHOT_VERSION = 1;
const DEFAULT_LIST_LIMIT = 50;

const forbidden = () =>
  new HttpError(403, "Somente o PMO pode validar o resumo executivo do projeto.", "EXECUTIVE_SUMMARY_VALIDATE_FORBIDDEN");

/**
 * Validação do resumo executivo pelo PMO. O servidor recalcula os indicadores dentro da transação (nunca usa os do
 * cliente), confere a impressão digital que o PMO viu e grava, na mesma transação, o snapshot e a auditoria. A data e a
 * hora são as reais do servidor; o ciclo é o da semana em que a validação acontece.
 */
export function makeValidateExecutiveSummaryUseCase(deps: { repos: EapRepos; runInTransaction: EapTransactionRunner }) {
  return async function validateExecutiveSummary(
    actor: AuthUser,
    projectId: string,
    input: ValidateExecutiveSummaryInput,
    now = new Date(),
  ): Promise<ExecutiveSummaryValidationItemDto> {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    if (!canValidateExecutiveSummary(context)) {
      throw forbidden();
    }
    const observation = input.observation?.trim() ? input.observation.trim() : null;
    if (input.extraordinary && !observation) {
      throw new HttpError(400, "A validação extraordinária exige observação.", "EXECUTIVE_SUMMARY_OBSERVATION_REQUIRED");
    }

    const cycle = executiveCycleOf(now);

    try {
      const created = await deps.runInTransaction(async (txRepos) => {
        const { snapshot, fingerprint } = await makeBuildExecutiveSummary({ repos: txRepos })(actor, projectId, now);

        if (fingerprint !== input.fingerprint) {
          throw new HttpError(
            409,
            "Os indicadores mudaram desde que você abriu o resumo. Revise os dados atuais e valide novamente.",
            "EXECUTIVE_SUMMARY_CHANGED",
          );
        }

        const previous = await txRepos.executiveSummaries.findLatestByProject(projectId);
        if (input.withoutChanges && previous?.fingerprint !== fingerprint) {
          throw new HttpError(
            409,
            "Há alterações nos indicadores desde a última validação; revise e valide normalmente.",
            "EXECUTIVE_SUMMARY_HAS_CHANGES",
          );
        }

        const kind = input.extraordinary ? "EXTRAORDINARY" : "REGULAR";
        if (kind === "REGULAR" && (await txRepos.executiveSummaries.findRegularInCycle(projectId, cycle.start))) {
          throw regularAlreadyValidated();
        }

        const validation = await txRepos.executiveSummaries.create({
          id: crypto.randomUUID(),
          projectId,
          cycleStart: cycle.start,
          cycleEnd: cycle.end,
          kind,
          snapshot: snapshot as unknown as Record<string, unknown>,
          snapshotVersion: SNAPSHOT_VERSION,
          fingerprint,
          unchanged: Boolean(input.withoutChanges),
          observation,
          validatedBy: actor.id,
        });

        await txRepos.audit.create({
          id: crypto.randomUUID(),
          projectId,
          entityType: "PROJECT_EXECUTIVE_SUMMARY",
          entityId: validation.id,
          action: "EXECUTIVE_SUMMARY_VALIDATE",
          summary:
            kind === "REGULAR"
              ? `Resumo executivo validado pelo PMO (ciclo ${cycle.start} a ${cycle.end}).`
              : `Resumo executivo validado pelo PMO em validação extraordinária (ciclo ${cycle.start} a ${cycle.end}).`,
          payload: { validationId: validation.id, kind, cycleStart: cycle.start, cycleEnd: cycle.end, unchanged: validation.unchanged, observation },
          actorId: actor.id,
        });

        return validation;
      });

      return toValidationItemDto(created);
    } catch (error) {
      // Duas validações regulares simultâneas: o banco deixa passar só a primeira.
      if (error instanceof ExecutiveSummaryRegularConflictError) {
        throw regularAlreadyValidated();
      }
      throw error;
    }
  };
}

const regularAlreadyValidated = () =>
  new HttpError(
    409,
    "O resumo deste ciclo já foi validado. Para registrar outra validação, use a validação extraordinária com observação.",
    "EXECUTIVE_SUMMARY_ALREADY_VALIDATED",
  );

/** Histórico das validações (mais recentes primeiro), sem o snapshot. Consulta: quem pode ver o projeto. */
export function makeListExecutiveSummaryValidationsUseCase(deps: { repos: EapRepos }) {
  return async function listExecutiveSummaryValidations(actor: AuthUser, projectId: string, query: { limit?: number } = {}) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    const rows = await deps.repos.executiveSummaries.listByProject(projectId, query.limit ?? DEFAULT_LIST_LIMIT);
    return { data: rows.map(toValidationItemDto) };
  };
}

/** Snapshot de uma validação, em modo leitura. Entradas de governança só vão para quem pode consultá-las. */
export function makeGetExecutiveSummaryValidationUseCase(deps: { repos: EapRepos }) {
  return async function getExecutiveSummaryValidation(actor: AuthUser, projectId: string, validationId: string) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    const row = await deps.repos.executiveSummaries.findByIdAndProject(validationId, projectId);
    if (!row) {
      throw new HttpError(404, "Validação não encontrada neste projeto.", "EXECUTIVE_SUMMARY_VALIDATION_NOT_FOUND");
    }
    const snapshot = row.snapshot as unknown as ExecutiveSummarySnapshotDto;
    const governanceAllowed = canViewProjectGovernanceAudit(context);
    return {
      ...toValidationItemDto(row),
      snapshot: governanceAllowed ? snapshot : { ...snapshot, movements: snapshot.movements.filter((movement) => !movement.governance) },
    };
  };
}

import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import { toResultView, type CreateResultInput, type UpdateResultInput } from "../dtos/institutional.dto";
import type {
  InstitutionalRepos,
  InstitutionalTransactionRunner,
  ResultContent,
  ResultDetails,
  ResultRow,
} from "../repositories/contracts";
import {
  assertCanRegisterResults,
  buildLinkIndex,
  loadNames,
  loadViewableProject,
  milestoneNotFoundError,
  recordInstitutionalAudit,
  resultNotFoundError,
} from "./shared";

type Deps = { repos: InstitutionalRepos; runInTransaction: InstitutionalTransactionRunner };

async function assertMilestoneInProject(repos: InstitutionalRepos, projectId: string, milestoneId: string | null | undefined) {
  if (milestoneId && !(await repos.institutional.findMilestoneInProject(projectId, milestoneId))) {
    throw milestoneNotFoundError();
  }
}

/** Esperados vinculados precisam ser resultados esperados, ativos, do mesmo projeto. */
async function assertExpectedLinks(repos: InstitutionalRepos, projectId: string, expectedIds: string[], unforeseen: boolean) {
  if (unforeseen && expectedIds.length > 0) {
    throw new HttpError(400, "Um resultado não previsto não se vincula a resultados esperados.", "RESULT_UNFORESEEN_WITH_LINKS");
  }
  if (expectedIds.length === 0) {
    return;
  }
  const results = await repos.institutional.listResults(projectId);
  const valid = new Set(results.filter((row) => row.type === "ESPERADO").map((row) => row.id));
  if (expectedIds.some((id) => !valid.has(id))) {
    throw new HttpError(404, "Resultado esperado não encontrado neste projeto.", "RESULT_EXPECTED_NOT_FOUND");
  }
}

export async function presentResult(repos: InstitutionalRepos, projectId: string, row: ResultRow) {
  const ids = [row.publishedMilestoneId, row.draftMilestoneId].filter((id): id is string => Boolean(id));
  const refs = await Promise.all(ids.map((id) => repos.institutional.findMilestoneInProject(projectId, id)));
  const titles = new Map(refs.flatMap((ref) => (ref ? ([[ref.id, ref.title]] as const) : [])));
  const [results, links] = await Promise.all([repos.institutional.listResults(projectId), repos.institutional.listResultLinks(projectId)]);
  const names = await loadNames(repos, [row.createdBy, row.publishedBy, row.validatedBy, row.draftBy, row.correctionBy]);
  return toResultView(row, names, titles, true, buildLinkIndex(results, links));
}

const toDate = (value: string | null | undefined) => (value ? new Date(value) : null);

function toDetails(value: CreateResultInput["details"] | undefined): ResultDetails | null {
  if (!value) {
    return null;
  }
  const clean = (text: string | null | undefined) => (text && text.trim() ? text.trim() : null);
  const details: ResultDetails = {
    target: clean(value.target),
    indicator: clean(value.indicator),
    dueDate: value.dueDate ? new Date(value.dueDate).toISOString() : null,
    obtainedValue: clean(value.obtainedValue),
    observation: clean(value.observation),
  };
  return Object.values(details).some((item) => item !== null) ? details : null;
}

/**
 * Cadastra um resultado. Resultado esperado é publicado direto, sem validação do PMO; resultado alcançado nasce
 * como rascunho e aguarda a validação institucional.
 */
export function makeCreateResultUseCase(deps: Deps) {
  return async function createResult(actor: AuthUser, projectId: string, input: CreateResultInput) {
    const { context } = await loadViewableProject(deps.repos, actor, projectId);
    assertCanRegisterResults(context);
    await assertMilestoneInProject(deps.repos, projectId, input.milestoneId);
    const expected = input.type === "ESPERADO";
    const expectedIds = expected ? [] : [...new Set(input.expectedIds ?? [])];
    const unforeseen = expected ? false : (input.unforeseen ?? false);
    await assertExpectedLinks(deps.repos, projectId, expectedIds, unforeseen);

    const content: ResultContent = {
      text: input.text,
      resultDate: toDate(input.resultDate),
      milestoneId: input.milestoneId ?? null,
      details: toDetails(input.details),
    };
    const created = await deps.runInTransaction(async (txRepos) => {
      const at = new Date();
      const row = await txRepos.institutional.createResult({
        id: crypto.randomUUID(),
        projectId,
        type: input.type,
        content,
        direct: expected,
        unforeseen,
        actorId: actor.id,
        at,
      });
      if (expectedIds.length > 0) {
        await txRepos.institutional.replaceResultLinks(row.id, expectedIds, actor.id, at);
      }
      await recordInstitutionalAudit(txRepos, {
        projectId,
        actorId: actor.id,
        entityType: "PROJECT_RESULT",
        entityId: row.id,
        action: "CREATE",
        summary: expected
          ? "Resultado esperado publicado."
          : "Resultado alcançado cadastrado, aguardando validação.",
        payload: {
          kind: expected ? "RESULT_DIRECT" : "RESULT_CREATE",
          type: input.type,
          text: content.text,
          resultDate: content.resultDate?.toISOString() ?? null,
          milestoneId: content.milestoneId,
          details: content.details,
          unforeseen,
          expectedIds,
        },
      });
      return row;
    });

    return presentResult(deps.repos, projectId, created);
  };
}

/**
 * Edita um resultado. Esperado: a nova versão é publicada na hora. Alcançado: vira novo rascunho (a versão validada
 * continua visível até a validação) e uma solicitação de correções anterior é encerrada com o reenvio.
 */
export function makeUpdateResultUseCase(deps: Deps) {
  return async function updateResult(actor: AuthUser, projectId: string, resultId: string, input: UpdateResultInput) {
    const { context } = await loadViewableProject(deps.repos, actor, projectId);
    assertCanRegisterResults(context);
    await assertMilestoneInProject(deps.repos, projectId, input.milestoneId);

    const saved = await deps.runInTransaction(async (txRepos) => {
      const row = await txRepos.institutional.findResult(projectId, resultId, true);
      if (!row || row.archivedAt) {
        throw resultNotFoundError();
      }
      assertCanRegisterResults(context, row.createdBy, actor.id);
      const expected = row.type === "ESPERADO";
      const unforeseen = expected ? false : (input.unforeseen ?? row.unforeseen);
      const links = expected || input.expectedIds === undefined ? null : [...new Set(input.expectedIds)];
      if (links !== null || (!expected && input.unforeseen !== undefined)) {
        await assertExpectedLinks(txRepos, projectId, links ?? [], unforeseen);
      }

      const base: ResultContent =
        expected && row.publishedText !== null
          ? {
              text: row.publishedText,
              resultDate: row.publishedResultDate,
              milestoneId: row.publishedMilestoneId,
              details: row.publishedDetails ?? null,
            }
          : row.draftText !== null
            ? {
                text: row.draftText,
                resultDate: row.draftResultDate,
                milestoneId: row.draftMilestoneId,
                details: row.draftDetails ?? null,
              }
            : {
                text: row.publishedText ?? "",
                resultDate: row.publishedResultDate,
                milestoneId: row.publishedMilestoneId,
                details: row.publishedDetails ?? null,
              };
      const content: ResultContent = {
        text: input.text ?? base.text,
        resultDate: input.resultDate !== undefined ? toDate(input.resultDate) : base.resultDate,
        milestoneId: input.milestoneId !== undefined ? input.milestoneId : base.milestoneId,
        details: input.details !== undefined ? toDetails(input.details) : base.details,
      };
      const at = new Date();
      // Valores lidos antes de gravar: a auditoria registra o que existia.
      const previous = { text: row.publishedText, draftText: row.draftText, correction: row.correctionReason };

      const updated = expected
        ? await txRepos.institutional.publishResultDirect(resultId, content, actor.id, at)
        : await txRepos.institutional.saveResultDraft(resultId, content, actor.id, at);
      if (!updated) {
        throw resultNotFoundError();
      }
      if (!expected) {
        if (input.unforeseen !== undefined) {
          await txRepos.institutional.setResultUnforeseen(resultId, unforeseen);
        }
        if (links !== null || unforeseen) {
          await txRepos.institutional.replaceResultLinks(resultId, unforeseen ? [] : (links ?? []), actor.id, at);
        }
      }
      await recordInstitutionalAudit(txRepos, {
        projectId,
        actorId: actor.id,
        entityType: "PROJECT_RESULT",
        entityId: resultId,
        action: "UPDATE",
        summary: expected
          ? "Resultado esperado atualizado e publicado."
          : previous.correction
            ? "Resultado alcançado corrigido e reenviado para validação."
            : "Resultado alcançado salvo, aguardando validação.",
        payload: {
          kind: expected ? "RESULT_DIRECT" : "RESULT_DRAFT",
          text: content.text,
          resultDate: content.resultDate?.toISOString() ?? null,
          milestoneId: content.milestoneId,
          details: content.details,
          previousPublishedText: previous.text,
          previousDraftText: previous.draftText,
          previousCorrectionReason: previous.correction,
          ...(links !== null ? { expectedIds: links } : {}),
        },
      });
      return updated;
    });

    return presentResult(deps.repos, projectId, saved);
  };
}

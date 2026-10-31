import type {
  projectHighlights,
  projectProfileFields,
  projectResultLinks,
  projectResults,
} from "../../../db/schema";
import type { ResultDetails } from "../../../db/schema/project-profile";
import type { EapEvidencesRepository } from "../../eap/repositories/contracts";
import type { ProjectRepos } from "../../projects/repositories/contracts";

export type ProfileFieldRow = typeof projectProfileFields.$inferSelect;
export type ResultRow = typeof projectResults.$inferSelect;
export type HighlightRow = typeof projectHighlights.$inferSelect;
export type ResultLinkRow = typeof projectResultLinks.$inferSelect;
export type { ResultDetails };
export type ProfileField = ProfileFieldRow["field"];
export type ResultType = ResultRow["type"];

export type ResultContent = {
  text: string;
  resultDate: Date | null;
  milestoneId: string | null;
  details: ResultDetails | null;
};

/** Marco aprovado da EAP, com o nome da fase, usado como "evolução" na apresentação institucional. */
export type EvolutionRow = {
  milestoneId: string;
  title: string;
  phaseId: string;
  phaseName: string;
  type: string;
  status: string;
  plannedAt: Date | null;
  actualAt: Date | null;
  validatedAt: Date | null;
};

export type MilestoneRef = { id: string; title: string; status: string };

export interface InstitutionalRepository {
  listProfileFields(projectId: string): Promise<ProfileFieldRow[]>;
  /** Com `lock`, a linha fica travada até o fim da transação (validação sem concorrência). */
  findProfileField(projectId: string, field: ProfileField, lock?: boolean): Promise<ProfileFieldRow | null>;
  /** Grava só o rascunho; a versão publicada nunca é tocada. */
  saveProfileDraft(data: {
    id: string;
    projectId: string;
    field: ProfileField;
    value: string;
    actorId: string;
    at: Date;
  }): Promise<ProfileFieldRow>;
  /** Publica na hora, sem rascunho nem validador (campos de preenchimento direto); limpa um rascunho pendente. */
  publishProfileDirect(data: {
    id: string;
    projectId: string;
    field: ProfileField;
    value: string;
    actorId: string;
    at: Date;
  }): Promise<ProfileFieldRow>;
  /** Promove o rascunho a versão publicada; devolve null se não houver rascunho ou se o validador for o autor. */
  publishProfileDraft(row: ProfileFieldRow, validatorId: string, at: Date): Promise<ProfileFieldRow | null>;
  /** Descarta o rascunho (preserva a publicada; remove a linha quando só havia rascunho). */
  discardProfileDraft(row: ProfileFieldRow): Promise<void>;

  listResults(projectId: string): Promise<ResultRow[]>;
  findResult(projectId: string, resultId: string, lock?: boolean): Promise<ResultRow | null>;
  /** Com `direct`, o resultado já nasce publicado, sem validador (resultados esperados); senão nasce como rascunho. */
  createResult(data: {
    id: string;
    projectId: string;
    type: ResultType;
    content: ResultContent;
    direct: boolean;
    unforeseen: boolean;
    actorId: string;
    at: Date;
  }): Promise<ResultRow>;
  /** Grava só o rascunho (a versão publicada não é tocada) e limpa a solicitação de correções anterior. */
  saveResultDraft(resultId: string, content: ResultContent, actorId: string, at: Date): Promise<ResultRow | null>;
  /** Publica direto, sem validador, e descarta um rascunho antigo (resultados esperados). */
  publishResultDirect(resultId: string, content: ResultContent, actorId: string, at: Date): Promise<ResultRow | null>;
  publishResultDraft(row: ResultRow, validatorId: string, at: Date): Promise<ResultRow | null>;
  /** Rejeição de alcançado: mantém o rascunho e a versão publicada e registra o pedido de correções. */
  requestResultCorrections(resultId: string, reason: string, actorId: string, at: Date): Promise<ResultRow | null>;
  setResultUnforeseen(resultId: string, unforeseen: boolean): Promise<void>;
  listResultLinks(projectId: string): Promise<ResultLinkRow[]>;
  /** Substitui os esperados vinculados a um alcançado. */
  replaceResultLinks(achievedId: string, expectedIds: string[], actorId: string, at: Date): Promise<void>;
  archiveResult(resultId: string, actorId: string, at: Date): Promise<ResultRow | null>;

  listHighlights(projectId: string): Promise<HighlightRow[]>;
  findHighlight(projectId: string, milestoneId: string): Promise<HighlightRow | null>;
  addHighlight(data: { id: string; projectId: string; milestoneId: string; actorId: string }): Promise<HighlightRow>;
  removeHighlight(projectId: string, milestoneId: string): Promise<boolean>;

  findMilestoneInProject(projectId: string, milestoneId: string): Promise<MilestoneRef | null>;
  listApprovedMilestones(projectId: string): Promise<EvolutionRow[]>;
}

export type InstitutionalRepos = ProjectRepos & {
  institutional: InstitutionalRepository;
  /** Evidências do projeto inteiro (inclui as vinculadas diretamente ao projeto). */
  evidences: Pick<EapEvidencesRepository, "listByProject" | "create">;
};

export type InstitutionalTransactionRunner = <T>(fn: (repos: InstitutionalRepos) => Promise<T>) => Promise<T>;

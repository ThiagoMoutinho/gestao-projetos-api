import type { z } from "zod";

import type { EapEvidenceDto } from "../../eap/dtos/eap-evidences.dto";
import type { ProjectStatus } from "../../projects/schemas/projects.schema";
import type {
  EvolutionRow,
  HighlightRow,
  ProfileField,
  ProfileFieldRow,
  ResultContent,
  ResultRow,
} from "../repositories/contracts";
import type { ResultDetails } from "../repositories/contracts";
import type {
  createResultBodySchema,
  decisionBodySchema,
  updateResultBodySchema,
} from "../schemas/institutional.schema";

export type CreateResultInput = z.infer<typeof createResultBodySchema>;
export type UpdateResultInput = z.infer<typeof updateResultBodySchema>;
export type DecisionInput = z.infer<typeof decisionBodySchema>;

export type PersonDto = { id: string; name: string | null };
export type VersionStatus = "EMPTY" | "VALIDATED" | "PENDING_VALIDATION";

/** `validatedBy` e `validatedAt` ficam nulos nos campos de preenchimento direto, que não passam por validação. */
type PublishedMeta = { author: PersonDto; authoredAt: string; validatedBy: PersonDto | null; validatedAt: string | null };
type DraftMeta = { author: PersonDto; savedAt: string };

export type ProfileFieldViewDto = {
  field: ProfileField;
  status: VersionStatus;
  published: (PublishedMeta & { value: string }) | null;
  draft: (DraftMeta & { value: string }) | null;
};

type ResultDetailsDto = {
  target: string | null;
  indicator: string | null;
  dueDate: string | null;
  obtainedValue: string | null;
  observation: string | null;
};

type ResultContentDto = {
  text: string;
  resultDate: string | null;
  milestone: { id: string; title: string } | null;
  details: ResultDetailsDto | null;
};

export type ResultStatus = VersionStatus | "CORRECTIONS_REQUESTED";

/** Vínculos entre alcançados e esperados, indexados por resultado. */
export type ResultLinkIndex = ReadonlyMap<string, { expected: { id: string; text: string }[]; achievedCount: number }>;

export type ProjectResultViewDto = {
  id: string;
  type: ResultRow["type"];
  status: ResultStatus;
  createdAt: string;
  createdBy: PersonDto;
  published: (PublishedMeta & { content: ResultContentDto }) | null;
  draft: (DraftMeta & { content: ResultContentDto }) | null;
  unforeseen: boolean;
  correction: { reason: string; by: PersonDto; at: string } | null;
  expected: { id: string; text: string }[];
  achievedCount: number;
};

export type EvolutionViewDto = {
  milestoneId: string;
  title: string;
  phaseId: string;
  phaseName: string;
  type: string;
  status: string;
  plannedAt: string | null;
  actualAt: string | null;
  validatedAt: string | null;
  highlighted: boolean;
  highlightOrder: number | null;
};

export type GlpiTicketDto = { ticketId: string; url: string | null };

export type ProjectOverviewDto = {
  project: { id: string; name: string; status: ProjectStatus };
  origin: {
    glpiTicket: GlpiTicketDto | null;
    pmoGlpiTicket: GlpiTicketDto | null;
    requestingArea: ProfileFieldViewDto;
  };
  responsible: { owner: PersonDto; managers: PersonDto[]; suppliers: PersonDto[] };
  profile: {
    systemDescription: ProfileFieldViewDto;
    resultsSummary: ProfileFieldViewDto;
    purpose: ProfileFieldViewDto;
    scope: ProfileFieldViewDto;
    problem: ProfileFieldViewDto;
    responsibleCompany: ProfileFieldViewDto;
    benefitedSectors: ProfileFieldViewDto;
  };
  results: { expected: ProjectResultViewDto[]; achieved: ProjectResultViewDto[] };
  evolutions: EvolutionViewDto[];
  evidences: EapEvidenceDto[];
  permissions: {
    canEdit: boolean;
    canValidate: boolean;
    canRegisterResults: boolean;
    canValidateResults: boolean;
    ownResultsOnly: boolean;
  };
};

export type HighlightDto = { milestoneId: string; highlightedBy: string; highlightedAt: string; sortOrder: number };

export type Names = ReadonlyMap<string, string | null>;

export const person = (names: Names, id: string): PersonDto => ({ id, name: names.get(id) ?? null });

/** Rascunho aguardando validação só aparece para quem pode editar ou validar; os demais veem a versão publicada. */
export function toProfileFieldView(
  field: ProfileField,
  row: ProfileFieldRow | undefined,
  names: Names,
  canSeeDraft: boolean,
): ProfileFieldViewDto {
  const published =
    row?.publishedValue != null && row.publishedBy && row.publishedAt
      ? {
          value: row.publishedValue,
          author: person(names, row.publishedBy),
          authoredAt: row.publishedAt.toISOString(),
          validatedBy: row.validatedBy ? person(names, row.validatedBy) : null,
          validatedAt: row.validatedAt?.toISOString() ?? null,
        }
      : null;
  const draft =
    canSeeDraft && row?.draftValue != null && row.draftBy && row.draftAt
      ? { value: row.draftValue, author: person(names, row.draftBy), savedAt: row.draftAt.toISOString() }
      : null;
  const pending = row?.draftValue != null;

  return {
    field,
    status: pending ? "PENDING_VALIDATION" : published ? "VALIDATED" : "EMPTY",
    published,
    draft,
  };
}

const toDetailsDto = (details: ResultDetails | null): ResultDetailsDto | null =>
  details
    ? {
        target: details.target ?? null,
        indicator: details.indicator ?? null,
        dueDate: details.dueDate ?? null,
        obtainedValue: details.obtainedValue ?? null,
        observation: details.observation ?? null,
      }
    : null;

export function toResultView(
  row: ResultRow,
  names: Names,
  milestones: ReadonlyMap<string, string>,
  canSeeDraft: boolean,
  links?: ResultLinkIndex,
): ProjectResultViewDto {
  const content = (value: ResultContent): ResultContentDto => ({
    text: value.text,
    resultDate: value.resultDate?.toISOString() ?? null,
    milestone: value.milestoneId
      ? { id: value.milestoneId, title: milestones.get(value.milestoneId) ?? "Marco removido" }
      : null,
    details: toDetailsDto(value.details),
  });
  const published =
    row.publishedText != null && row.publishedBy && row.publishedAt
      ? {
          content: content({
            text: row.publishedText,
            resultDate: row.publishedResultDate,
            milestoneId: row.publishedMilestoneId,
            details: row.publishedDetails ?? null,
          }),
          author: person(names, row.publishedBy),
          authoredAt: row.publishedAt.toISOString(),
          validatedBy: row.validatedBy ? person(names, row.validatedBy) : null,
          validatedAt: row.validatedAt?.toISOString() ?? null,
        }
      : null;
  const draft =
    canSeeDraft && row.draftText != null && row.draftBy && row.draftAt
      ? {
          content: content({
            text: row.draftText,
            resultDate: row.draftResultDate,
            milestoneId: row.draftMilestoneId,
            details: row.draftDetails ?? null,
          }),
          author: person(names, row.draftBy),
          savedAt: row.draftAt.toISOString(),
        }
      : null;

  return {
    id: row.id,
    type: row.type,
    status:
      row.draftText != null
        ? row.correctionAt
          ? "CORRECTIONS_REQUESTED"
          : "PENDING_VALIDATION"
        : published
          ? "VALIDATED"
          : "EMPTY",
    createdAt: row.createdAt.toISOString(),
    createdBy: person(names, row.createdBy),
    published,
    draft,
    unforeseen: row.unforeseen,
    correction:
      row.correctionReason && row.correctionBy && row.correctionAt
        ? { reason: row.correctionReason, by: person(names, row.correctionBy), at: row.correctionAt.toISOString() }
        : null,
    expected: links?.get(row.id)?.expected ?? [],
    achievedCount: links?.get(row.id)?.achievedCount ?? 0,
  };
}

export function toEvolutionView(row: EvolutionRow, highlights: ReadonlyMap<string, HighlightRow>): EvolutionViewDto {
  const highlight = highlights.get(row.milestoneId);
  return {
    milestoneId: row.milestoneId,
    title: row.title,
    phaseId: row.phaseId,
    phaseName: row.phaseName,
    type: row.type,
    status: row.status,
    plannedAt: row.plannedAt?.toISOString() ?? null,
    actualAt: row.actualAt?.toISOString() ?? null,
    validatedAt: row.validatedAt?.toISOString() ?? null,
    highlighted: Boolean(highlight),
    highlightOrder: highlight?.sortOrder ?? null,
  };
}

export function toHighlightDto(row: HighlightRow): HighlightDto {
  return {
    milestoneId: row.milestoneId,
    highlightedBy: row.highlightedBy,
    highlightedAt: row.highlightedAt.toISOString(),
    sortOrder: row.sortOrder,
  };
}

/**
 * Link do chamado só existe com a URL base do GLPI configurada (variável GLPI_BASE_URL) e número numérico;
 * caso contrário, o contrato devolve apenas o número.
 */
export function toGlpiTicket(ticketId: string | null, baseUrl: string | null): GlpiTicketDto | null {
  const id = ticketId?.trim();
  if (!id) {
    return null;
  }
  return { ticketId: id, url: baseUrl && /^\d+$/.test(id) ? `${baseUrl}/front/ticket.form.php?id=${id}` : null };
}

/** Normaliza a URL base do GLPI; configuração ausente ou inválida desabilita os links. */
export function parseGlpiBaseUrl(value: string | undefined): string | null {
  if (!value?.trim()) {
    return null;
  }
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

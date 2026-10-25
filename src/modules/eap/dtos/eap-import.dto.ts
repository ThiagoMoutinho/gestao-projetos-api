/** Linha da planilha de importação, já lida pelo cliente como texto. */
export type EapImportRow = {
  /** Número da linha na planilha, para apontar os erros. */
  line: number;
  code: string;
  kind: string;
  name: string;
  description?: string | null;
  responsible?: string | null;
  reviewer?: string | null;
  milestoneType?: string | null;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  completionCriteria?: string | null;
};

export type EapImportInput = {
  fileName?: string | null;
  rows: EapImportRow[];
  /** false: só valida e devolve a pré-visualização; true: grava tudo numa transação. */
  confirm: boolean;
};

export type EapImportIssue = { line: number; field: string | null; message: string };

export type EapImportItemKind = "PHASE" | "TASK" | "MILESTONE";

export type EapImportPreviewItem = {
  line: number;
  code: string;
  /** Código que o item terá na EAP, numerado em sequência a partir da ordem da planilha. */
  finalCode: string;
  kind: EapImportItemKind;
  name: string;
  parentCode: string | null;
  responsibleName: string | null;
  reviewerName: string | null;
  /** Fase: planejamento informado na planilha. Tarefa: período planejado. Marco: data prevista no término. */
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  /** Somente fase: período consolidado das tarefas e marcos, calculado à parte. */
  consolidatedStartAt: string | null;
  consolidatedEndAt: string | null;
};

export type EapImportResultDto = {
  valid: boolean;
  committed: boolean;
  errors: EapImportIssue[];
  /** Avisos que não impedem a importação (ex.: itens fora do período planejado da fase). */
  warnings: EapImportIssue[];
  summary: { phases: number; tasks: number; milestones: number };
  items: EapImportPreviewItem[];
};

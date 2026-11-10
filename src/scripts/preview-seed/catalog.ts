import { PREVIEW_ID_PREFIX, PREVIEW_PROJECT_ID } from "./guard";

/**
 * Massa fictícia do Cronograma para o projeto demo-proj-05: quatro fases em situações diferentes, atividades, marcos, rodadas de
 * entrega e solicitações de reprogramação (aprovadas, rejeitada e pendentes), todas relacionadas entre si. Datas em 2026, com
 * "hoje" em 09/11/2026 (ambiente de demonstração). Os registros pré-existentes do projeto não são tocados.
 */

const id = (name: string) => `${PREVIEW_ID_PREFIX}${name}`;
/** Meio-dia de Belém (UTC-3), como o resto do sistema grava datas civis. */
export const at = (day: string) => new Date(`${day}T15:00:00.000Z`);

const GESTOR = "demo-user-seguranca";
const PMO = "demo-user-pmo";

type Dated = { baselineStart?: string; baselineEnd?: string; plannedStart?: string; plannedEnd?: string; actualStart?: string; actualEnd?: string };

export type PhaseSeed = Dated & { id: string; name: string; sortOrder: number; status: "NAO_INICIADA" | "EM_ANDAMENTO" | "CONCLUIDA"; description: string };
export type TaskSeed = Dated & { id: string; phaseId: string; title: string; sortOrder: number; status: "NAO_INICIADA" | "EM_ANDAMENTO" | "CONCLUIDA"; progressPercent: number };
export type MilestoneSeed = {
  id: string;
  phaseId: string;
  title: string;
  sortOrder: number;
  type: "ENTREGA" | "APROVACAO" | "HOMOLOGACAO";
  status: "PENDENTE" | "ENTREGUE" | "APROVADO";
  baselineAt: string;
  plannedAt: string;
  actualAt?: string;
  validatedAt?: string;
  validationNote?: string;
};
export type DeliverySeed = {
  id: string;
  milestoneId: string;
  status: "EM_ANALISE" | "ACEITA";
  submittedAt: string;
  decidedAt?: string;
  note: string;
  decisionNote?: string;
};
export type RequestSeed = {
  id: string;
  target: { phaseId: string } | { taskId: string } | { milestoneId: string };
  field: "PLANNED_START_AT" | "PLANNED_END_AT" | "PLANNED_AT";
  baseline: string;
  expectedCurrent: string;
  proposed: string;
  justification: string;
  status: "PENDENTE" | "APROVADA" | "REJEITADA";
  requestedAt: string;
  reviewedAt?: string;
  decisionNote?: string;
};

const phase = { a: id("phase-a"), b: id("phase-b"), c: id("phase-c"), d: id("phase-d") };

export const phases: PhaseSeed[] = [
  { id: phase.a, name: "Levantamento e desenho", description: "Registro fictício. Fase concluída com um pequeno ajuste de prazo aprovado.", sortOrder: 4, status: "CONCLUIDA", baselineStart: "2026-09-14", baselineEnd: "2026-09-30", plannedStart: "2026-09-14", plannedEnd: "2026-10-02", actualStart: "2026-09-14", actualEnd: "2026-10-02" },
  { id: phase.b, name: "Desenvolvimento", description: "Registro fictício. Fase em andamento, dentro do prazo vigente.", sortOrder: 5, status: "EM_ANDAMENTO", baselineStart: "2026-10-05", baselineEnd: "2026-11-20", plannedStart: "2026-10-05", plannedEnd: "2026-11-20", actualStart: "2026-10-05" },
  { id: phase.c, name: "Homologação", description: "Registro fictício. Fase atrasada: o prazo vigente já passou e há entrega em validação.", sortOrder: 6, status: "EM_ANDAMENTO", baselineStart: "2026-10-19", baselineEnd: "2026-11-02", plannedStart: "2026-10-19", plannedEnd: "2026-11-06", actualStart: "2026-10-19" },
  { id: phase.d, name: "Implantação", description: "Registro fictício. Fase ainda não iniciada, com prazo final reprogramado.", sortOrder: 7, status: "NAO_INICIADA", baselineStart: "2026-11-23", baselineEnd: "2026-12-04", plannedStart: "2026-11-23", plannedEnd: "2026-12-11" },
];

const task = {
  a1: id("task-a1"), a2: id("task-a2"), a3: id("task-a3"),
  b1: id("task-b1"), b2: id("task-b2"), b3: id("task-b3"), b4: id("task-b4"),
  c1: id("task-c1"), c2: id("task-c2"), c3: id("task-c3"),
  d1: id("task-d1"), d2: id("task-d2"),
};

export const tasks: TaskSeed[] = [
  { id: task.a1, phaseId: phase.a, title: "Levantar requisitos", sortOrder: 0, status: "CONCLUIDA", progressPercent: 100, baselineStart: "2026-09-14", baselineEnd: "2026-09-18", plannedStart: "2026-09-14", plannedEnd: "2026-09-18", actualStart: "2026-09-14", actualEnd: "2026-09-18" },
  { id: task.a2, phaseId: phase.a, title: "Modelar a solução", sortOrder: 1, status: "CONCLUIDA", progressPercent: 100, baselineStart: "2026-09-21", baselineEnd: "2026-09-25", plannedStart: "2026-09-21", plannedEnd: "2026-09-25", actualStart: "2026-09-21", actualEnd: "2026-09-26" },
  { id: task.a3, phaseId: phase.a, title: "Validar o desenho com a gestão", sortOrder: 2, status: "CONCLUIDA", progressPercent: 100, baselineStart: "2026-09-28", baselineEnd: "2026-09-30", plannedStart: "2026-09-28", plannedEnd: "2026-10-02", actualStart: "2026-09-28", actualEnd: "2026-10-02" },
  { id: task.b1, phaseId: phase.b, title: "Implementar o módulo de cadastro", sortOrder: 0, status: "CONCLUIDA", progressPercent: 100, baselineStart: "2026-10-05", baselineEnd: "2026-10-23", plannedStart: "2026-10-05", plannedEnd: "2026-10-23", actualStart: "2026-10-05", actualEnd: "2026-10-22" },
  { id: task.b2, phaseId: phase.b, title: "Implementar os relatórios", sortOrder: 1, status: "CONCLUIDA", progressPercent: 100, baselineStart: "2026-10-26", baselineEnd: "2026-11-06", plannedStart: "2026-10-26", plannedEnd: "2026-11-06", actualStart: "2026-10-26", actualEnd: "2026-11-06" },
  { id: task.b3, phaseId: phase.b, title: "Integrar com os sistemas legados", sortOrder: 2, status: "EM_ANDAMENTO", progressPercent: 60, baselineStart: "2026-11-02", baselineEnd: "2026-11-20", plannedStart: "2026-11-02", plannedEnd: "2026-11-20", actualStart: "2026-11-02" },
  { id: task.b4, phaseId: phase.b, title: "Executar os testes de regressão", sortOrder: 3, status: "NAO_INICIADA", progressPercent: 0, baselineStart: "2026-11-16", baselineEnd: "2026-11-20", plannedStart: "2026-11-16", plannedEnd: "2026-11-20" },
  { id: task.c1, phaseId: phase.c, title: "Preparar o ambiente de homologação", sortOrder: 0, status: "CONCLUIDA", progressPercent: 100, baselineStart: "2026-10-19", baselineEnd: "2026-10-23", plannedStart: "2026-10-19", plannedEnd: "2026-10-23", actualStart: "2026-10-19", actualEnd: "2026-10-23" },
  { id: task.c2, phaseId: phase.c, title: "Executar os roteiros de teste", sortOrder: 1, status: "EM_ANDAMENTO", progressPercent: 70, baselineStart: "2026-10-26", baselineEnd: "2026-11-02", plannedStart: "2026-10-26", plannedEnd: "2026-11-06", actualStart: "2026-10-26" },
  { id: task.c3, phaseId: phase.c, title: "Corrigir as não conformidades", sortOrder: 2, status: "EM_ANDAMENTO", progressPercent: 30, baselineStart: "2026-10-30", baselineEnd: "2026-11-02", plannedStart: "2026-10-30", plannedEnd: "2026-11-05", actualStart: "2026-11-02" },
  { id: task.d1, phaseId: phase.d, title: "Preparar o plano de implantação", sortOrder: 0, status: "NAO_INICIADA", progressPercent: 0, baselineStart: "2026-11-23", baselineEnd: "2026-11-27", plannedStart: "2026-11-23", plannedEnd: "2026-11-27" },
  { id: task.d2, phaseId: phase.d, title: "Executar a implantação", sortOrder: 1, status: "NAO_INICIADA", progressPercent: 0, baselineStart: "2026-11-30", baselineEnd: "2026-12-04", plannedStart: "2026-11-30", plannedEnd: "2026-12-11" },
];

const milestone = { a: id("ms-a"), b: id("ms-b"), c: id("ms-c"), c2: id("ms-c2"), d: id("ms-d") };

export const milestones: MilestoneSeed[] = [
  { id: milestone.a, phaseId: phase.a, title: "Aprovação do desenho", sortOrder: 0, type: "APROVACAO", status: "APROVADO", baselineAt: "2026-09-30", plannedAt: "2026-10-02", actualAt: "2026-10-02", validatedAt: "2026-10-02", validationNote: "Desenho aprovado pela gestão. Registro fictício." },
  { id: milestone.b, phaseId: phase.b, title: "Entrega da versão 1.0", sortOrder: 0, type: "ENTREGA", status: "PENDENTE", baselineAt: "2026-11-20", plannedAt: "2026-11-20" },
  { id: milestone.c, phaseId: phase.c, title: "Homologação funcional", sortOrder: 0, type: "HOMOLOGACAO", status: "ENTREGUE", baselineAt: "2026-11-02", plannedAt: "2026-11-06" },
  { id: milestone.c2, phaseId: phase.c, title: "Aceite do usuário-chave", sortOrder: 1, type: "HOMOLOGACAO", status: "PENDENTE", baselineAt: "2026-11-13", plannedAt: "2026-11-13" },
  { id: milestone.d, phaseId: phase.d, title: "Go-live", sortOrder: 0, type: "ENTREGA", status: "PENDENTE", baselineAt: "2026-12-04", plannedAt: "2026-12-11" },
];

export const deliveries: DeliverySeed[] = [
  { id: id("delivery-a1"), milestoneId: milestone.a, status: "ACEITA", submittedAt: "2026-10-01", decidedAt: "2026-10-02", note: "Desenho entregue para validação. Registro fictício.", decisionNote: "Aceito sem ressalvas. Registro fictício." },
  { id: id("delivery-c1"), milestoneId: milestone.c, status: "EM_ANALISE", submittedAt: "2026-11-06", note: "Homologação funcional enviada para análise. Registro fictício." },
];

const JUST = {
  a: "Revisão do desenho com a gestão exigiu mais dois dias. Registro fictício.",
  c: "Ambiente de homologação liberado com atraso pela infraestrutura. Registro fictício.",
  d: "Janela de implantação deslocada pelo calendário do cliente. Registro fictício.",
};

const approved = (key: string, target: RequestSeed["target"], field: RequestSeed["field"], baseline: string, proposed: string, justification: string, requestedAt: string, reviewedAt: string): RequestSeed => ({
  id: id(`req-${key}`),
  target,
  field,
  baseline,
  expectedCurrent: baseline,
  proposed,
  justification,
  status: "APROVADA",
  requestedAt,
  reviewedAt,
  decisionNote: "Aprovada. Registro fictício.",
});

/** Solicitações aprovadas (viram reprogramações efetivadas), uma rejeitada e três pendentes de análise. */
export const requests: RequestSeed[] = [
  approved("a-phase", { phaseId: phase.a }, "PLANNED_END_AT", "2026-09-30", "2026-10-02", JUST.a, "2026-09-29", "2026-09-30"),
  approved("a-milestone", { milestoneId: milestone.a }, "PLANNED_AT", "2026-09-30", "2026-10-02", JUST.a, "2026-09-29", "2026-09-30"),
  approved("a3-task", { taskId: task.a3 }, "PLANNED_END_AT", "2026-09-30", "2026-10-02", JUST.a, "2026-09-29", "2026-09-30"),
  approved("c-phase", { phaseId: phase.c }, "PLANNED_END_AT", "2026-11-02", "2026-11-06", JUST.c, "2026-10-30", "2026-10-31"),
  approved("c2-task", { taskId: task.c2 }, "PLANNED_END_AT", "2026-11-02", "2026-11-06", JUST.c, "2026-10-30", "2026-10-31"),
  approved("c3-task", { taskId: task.c3 }, "PLANNED_END_AT", "2026-11-02", "2026-11-05", JUST.c, "2026-10-30", "2026-10-31"),
  approved("c-milestone", { milestoneId: milestone.c }, "PLANNED_AT", "2026-11-02", "2026-11-06", JUST.c, "2026-10-30", "2026-10-31"),
  approved("d-phase", { phaseId: phase.d }, "PLANNED_END_AT", "2026-12-04", "2026-12-11", JUST.d, "2026-11-04", "2026-11-05"),
  approved("d2-task", { taskId: task.d2 }, "PLANNED_END_AT", "2026-12-04", "2026-12-11", JUST.d, "2026-11-04", "2026-11-05"),
  approved("d-milestone", { milestoneId: milestone.d }, "PLANNED_AT", "2026-12-04", "2026-12-11", JUST.d, "2026-11-04", "2026-11-05"),
  {
    id: id("req-b-phase-rejected"),
    target: { phaseId: phase.b },
    field: "PLANNED_END_AT",
    baseline: "2026-11-20",
    expectedCurrent: "2026-11-20",
    proposed: "2026-12-05",
    justification: "Ampliar o prazo para incluir funcionalidades extras. Registro fictício.",
    status: "REJEITADA",
    requestedAt: "2026-11-03",
    reviewedAt: "2026-11-04",
    decisionNote: "Escopo adicional deve entrar em novo ciclo; manter o prazo vigente. Registro fictício.",
  },
  {
    id: id("req-b3-pending"),
    target: { taskId: task.b3 },
    field: "PLANNED_END_AT",
    baseline: "2026-11-20",
    expectedCurrent: "2026-11-20",
    proposed: "2026-11-27",
    justification: "Dependência do ambiente legado, liberado só em 10/11. Registro fictício.",
    status: "PENDENTE",
    requestedAt: "2026-11-08",
  },
  {
    id: id("req-c2-pending"),
    target: { taskId: task.c2 },
    field: "PLANNED_END_AT",
    baseline: "2026-11-02",
    expectedCurrent: "2026-11-06",
    proposed: "2026-11-16",
    justification: "Volume de roteiros maior que o estimado e casos reprovados a reexecutar. Registro fictício.",
    status: "PENDENTE",
    requestedAt: "2026-11-07",
  },
  {
    id: id("req-d-milestone-pending"),
    target: { milestoneId: milestone.d },
    field: "PLANNED_AT",
    baseline: "2026-12-04",
    expectedCurrent: "2026-12-11",
    proposed: "2026-12-18",
    justification: "A janela de implantação depende da liberação do cliente. Registro fictício.",
    status: "PENDENTE",
    requestedAt: "2026-11-09",
  },
];

/** Dados da auditoria de cada reprogramação aprovada: o fluxo real grava um registro SCHEDULE_CHANGE ligado à solicitação. */
export function approvedAuditOf(request: RequestSeed) {
  const t = request.target;
  const entityType = "phaseId" in t ? "PHASE" : "taskId" in t ? "TASK" : "MILESTONE";
  const entityId = "phaseId" in t ? t.phaseId : "taskId" in t ? t.taskId : t.milestoneId;
  const phaseId = "phaseId" in t ? t.phaseId : "taskId" in t ? (tasks.find((item) => item.id === t.taskId) as TaskSeed).phaseId : (milestones.find((item) => item.id === t.milestoneId) as MilestoneSeed).phaseId;
  const title = entityType === "PHASE" ? phases.find((item) => item.id === entityId)?.name : entityType === "TASK" ? tasks.find((item) => item.id === entityId)?.title : milestones.find((item) => item.id === entityId)?.title;
  const label = entityType === "PHASE" ? "da fase" : entityType === "TASK" ? "da tarefa" : "do marco";
  const br = (value: string) => value.split("-").reverse().join("/");
  return {
    id: `${request.id}-audit`,
    entityType,
    entityId,
    phaseId,
    summary: `Prazo ${label} "${title}" reprogramado (reprogramação nº 1): ${br(request.expectedCurrent)} → ${br(request.proposed)}.`,
  };
}

export const actors = { requester: GESTOR, reviewer: PMO, project: PREVIEW_PROJECT_ID };

export type PreviewCatalog = { phases: PhaseSeed[]; tasks: TaskSeed[]; milestones: MilestoneSeed[]; deliveries: DeliverySeed[]; requests: RequestSeed[] };
export const catalog: PreviewCatalog = { phases, tasks, milestones, deliveries, requests };

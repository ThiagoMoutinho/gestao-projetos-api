import {
  DEMO_EMAIL_DOMAIN,
  FICTION_MARKER,
  PROTECTED_EMAILS,
  USER_MARKER,
} from "./constants";
import { addBusinessDays, atBelemNoon, civilToday, previousBusinessDay, type CivilDate } from "./dates";

export type DemoUser = {
  id: string;
  accountId: string;
  name: string;
  email: string;
  role: "PMO" | "COORDENADOR" | "GESTOR" | "FORNECEDOR" | "COLABORADOR";
};

export type DemoProject = {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  status:
    | "NAO_INICIADO"
    | "EM_EXECUCAO"
    | "EM_ATENCAO"
    | "CRITICO"
    | "EM_VALIDACAO"
    | "CONCLUIDO"
    | "SUSPENSO";
};

export type DemoMember = {
  id: string;
  projectId: string;
  userId: string;
  role: "DONO_PROJETO" | "GESTOR" | "RESPONSAVEL_TECNICO" | "FORNECEDOR";
};

export type DemoPhase = {
  id: string;
  projectId: string;
  name: string;
  description: string;
  sortOrder: number;
  status: "NAO_INICIADA" | "EM_ANDAMENTO" | "CONCLUIDA" | "SUSPENSA";
  baselineStartAt: Date;
  baselineEndAt: Date;
  plannedStartAt: Date;
  plannedEndAt: Date;
  createdBy: string;
  updatedBy: string;
};

export type DemoTask = {
  id: string;
  phaseId: string;
  title: string;
  description: string;
  assigneeId: string | null;
  status: "NAO_INICIADA" | "EM_ANDAMENTO" | "IMPEDIDA" | "CONCLUIDA" | "CANCELADA";
  progressPercent: number;
  weight: number;
  baselineStartAt: Date;
  baselineEndAt: Date;
  plannedStartAt: Date;
  plannedEndAt: Date;
  actualStartAt: Date | null;
  actualEndAt: Date | null;
  hasImpediment: boolean;
  createdBy: string;
  updatedBy: string;
};

export type DemoMilestone = {
  id: string;
  phaseId: string;
  title: string;
  description: string;
  type: "ENTREGA" | "APROVACAO";
  status: "PENDENTE" | "ENTREGUE" | "APROVADO" | "REJEITADO";
  baselineAt: Date;
  plannedAt: Date;
  actualAt: Date | null;
  deliveredBy: string | null;
  validatedBy: string | null;
  validationNote: string | null;
  createdBy: string;
  updatedBy: string;
};

export type DemoEvidence = {
  id: string;
  taskId: string | null;
  milestoneId: string | null;
  scheduleRequestId: string | null;
  title: string;
  url: string;
  createdBy: string;
};

export type DemoScheduleRequest = {
  id: string;
  projectId: string;
  phaseId: null;
  taskId: string;
  milestoneId: null;
  field: "PLANNED_END_AT";
  baselineValue: Date;
  expectedCurrentValue: Date;
  proposedValue: Date;
  justification: string;
  status: "PENDENTE" | "APROVADA";
  requestedBy: string;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  decisionNote: string | null;
};

export type DemoScheduleChange = {
  id: string;
  projectId: string;
  requestId: string;
  phaseId: null;
  taskId: string;
  milestoneId: null;
  field: "PLANNED_END_AT";
  baselineValue: Date;
  oldValue: Date;
  newValue: Date;
  changedBy: string;
};

export type DemoImpediment = {
  id: string;
  taskId: string;
  description: string;
  openedBy: string;
};

export type DemoCatalog = {
  users: DemoUser[];
  projects: DemoProject[];
  members: DemoMember[];
  phases: DemoPhase[];
  tasks: DemoTask[];
  milestones: DemoMilestone[];
  evidences: DemoEvidence[];
  scheduleRequests: DemoScheduleRequest[];
  scheduleChanges: DemoScheduleChange[];
  impediments: DemoImpediment[];
};

const PMO = "demo-user-pmo";
const COORD = "demo-user-coordenacao";
const SISTEMAS = "demo-user-sistemas";
const INFRA = "demo-user-infra";
const SEGURANCA = "demo-user-seguranca";
const NORTE = "demo-user-norte";
const RIO = "demo-user-rio";
const COLAB = "demo-user-colaborador";

export function buildDemoCatalog(now: Date): DemoCatalog {
  const today = civilToday(now);
  const noon = (day: CivilDate) => atBelemNoon(day);
  const offset = (days: number) => noon(addBusinessDays(today, days));
  const previous = noon(previousBusinessDay(today));
  const before = (day: Date, businessDays: number) => {
    const civil = civilToday(day);
    return noon(addBusinessDays(civil, -businessDays));
  };
  const mark = (text: string) => `${FICTION_MARKER} ${text}`;

  const users: DemoUser[] = [
    user(PMO, "PMO Fictício", "demo.pmo@exemplo.com", "PMO"),
    user(COORD, "Coordenação Fictícia", "demo.coordenacao@exemplo.com", "COORDENADOR"),
    user(SISTEMAS, "Sistemas Fictício", "demo.sistemas@exemplo.com", "GESTOR"),
    user(INFRA, "Infraestrutura Fictícia", "demo.infra@exemplo.com", "GESTOR"),
    user(SEGURANCA, "Segurança Fictícia", "demo.seguranca@exemplo.com", "GESTOR"),
    user(NORTE, "Norte Digital", "demo.norte@exemplo.com", "FORNECEDOR"),
    user(RIO, "Rio Serviços", "demo.rio@exemplo.com", "FORNECEDOR"),
    user(COLAB, "Colaborador Fictício", "demo.colaborador@exemplo.com", "COLABORADOR"),
  ];

  const projects: DemoProject[] = [
    project("01", "Portal de Atendimento", "Sistemas", SISTEMAS, "EM_EXECUCAO"),
    project("02", "Inventário de Servidores", "Infraestrutura", INFRA, "EM_ATENCAO"),
    project("03", "Homologação do Firewall", "Segurança", SEGURANCA, "EM_VALIDACAO"),
    project("04", "Modernização da Rede", "Infraestrutura", INFRA, "SUSPENSO"),
    project("05", "Adequação de Identidade", "Segurança", SEGURANCA, "EM_EXECUCAO"),
    project("06", "Catálogo de Serviços", "Sistemas", SISTEMAS, "EM_EXECUCAO"),
    project("07", "Migração de Correio", "Infraestrutura", INFRA, "EM_EXECUCAO"),
    project("08", "Relatório de Capacidade", "Sistemas", SISTEMAS, "EM_EXECUCAO"),
    project("09", "Monitoramento de Acessos", "Segurança", SEGURANCA, "CRITICO"),
    project("10", "Onboarding de Fornecedor", "Sistemas", SISTEMAS, "NAO_INICIADO"),
  ];

  const members: DemoMember[] = [
    ...ownerMembers("01", SISTEMAS),
    member("01", "responsavel", COLAB, "RESPONSAVEL_TECNICO"),
    ...ownerMembers("02", INFRA),
    member("02", "responsavel", COLAB, "RESPONSAVEL_TECNICO"),
    ...ownerMembers("03", SEGURANCA),
    member("03", "fornecedor", NORTE, "FORNECEDOR"),
    ...ownerMembers("04", INFRA),
    ...ownerMembers("05", SEGURANCA),
    ...ownerMembers("06", SISTEMAS),
    ...ownerMembers("07", INFRA),
    member("07", "fornecedor", RIO, "FORNECEDOR"),
    ...ownerMembers("08", SISTEMAS),
    member("08", "fornecedor", RIO, "FORNECEDOR"),
    member("08", "responsavel", COLAB, "RESPONSAVEL_TECNICO"),
    ...ownerMembers("09", SEGURANCA),
    member("09", "responsavel", COLAB, "RESPONSAVEL_TECNICO"),
    ...ownerMembers("10", SISTEMAS),
  ];

  const wideStart = offset(-10);
  const wideEnd = offset(20);
  const phases: DemoPhase[] = [
    phase("01", "Execução", "EM_ANDAMENTO", wideStart, wideEnd),
    phase("02", "Levantamento", "EM_ANDAMENTO", before(previous, 5), previous),
    phase("03", "Homologação", "EM_ANDAMENTO", before(previous, 5), offset(5)),
    phase("04", "Implantação", "EM_ANDAMENTO", before(previous, 5), previous),
    phase("05", "Adequação", "SUSPENSA", before(previous, 5), previous),
    phase("06", "Publicação", "EM_ANDAMENTO", wideStart, offset(10)),
    phase("07", "Migração", "EM_ANDAMENTO", before(previous, 5), offset(12)),
    phase("08", "Fechamento", "EM_ANDAMENTO", before(previous, 5), previous),
    phase("09", "Monitoramento", "EM_ANDAMENTO", before(previous, 5), previous),
    phase("10", "Preparação", "NAO_INICIADA", offset(1), offset(8)),
  ];

  const onTimeEnd = offset(15);
  const warningEnd = offset(5);
  const pendingEnd = offset(10);
  const approvedEnd = offset(12);
  const cancelledEnd = offset(8);
  const tasks: DemoTask[] = [
    task({
      id: "demo-task-01-aviso",
      phaseId: "demo-phase-01",
      title: "Publicar versão de demonstração",
      text: "Vence em cinco dias úteis.",
      assigneeId: COLAB,
      status: "EM_ANDAMENTO",
      progressPercent: 40,
      end: warningEnd,
    }),
    task({
      id: "demo-task-01-em-dia",
      phaseId: "demo-phase-01",
      title: "Revisar conteúdo institucional",
      text: "Prazo folgado, dentro do planejado.",
      assigneeId: COLAB,
      status: "EM_ANDAMENTO",
      progressPercent: 20,
      end: onTimeEnd,
    }),
    task({
      id: "demo-task-02-atraso",
      phaseId: "demo-phase-02",
      title: "Levantar servidores fictícios",
      text: "Vencimento no último dia útil.",
      assigneeId: COLAB,
      status: "EM_ANDAMENTO",
      progressPercent: 55,
      end: previous,
    }),
    task({
      id: "demo-task-04-suspenso",
      phaseId: "demo-phase-04",
      title: "Trocar enlace fictício",
      text: "Projeto suspenso. A tarefa continua em andamento.",
      assigneeId: null,
      status: "EM_ANDAMENTO",
      progressPercent: 10,
      end: previous,
    }),
    task({
      id: "demo-task-05-fase",
      phaseId: "demo-phase-05",
      title: "Revisar credenciais fictícias",
      text: "Fase suspensa. O status desta tarefa não muda.",
      assigneeId: null,
      status: "EM_ANDAMENTO",
      progressPercent: 25,
      end: previous,
    }),
    task({
      id: "demo-task-06-pendente",
      phaseId: "demo-phase-06",
      title: "Publicar catálogo fictício",
      text: "Há reprogramação pendente. A data vigente permanece.",
      assigneeId: null,
      status: "EM_ANDAMENTO",
      progressPercent: 30,
      end: pendingEnd,
    }),
    task({
      id: "demo-task-07-aprovada",
      phaseId: "demo-phase-07",
      title: "Migrar caixas fictícias",
      text: "Reprogramação aprovada. A linha de base ficou para trás.",
      assigneeId: null,
      status: "EM_ANDAMENTO",
      progressPercent: 45,
      end: approvedEnd,
      baselineEnd: previous,
    }),
    task({
      id: "demo-task-08-concluida",
      phaseId: "demo-phase-08",
      title: "Entregar relatório fictício",
      text: "Concluída no prazo.",
      assigneeId: COLAB,
      status: "CONCLUIDA",
      progressPercent: 100,
      end: previous,
      actualEnd: previous,
    }),
    task({
      id: "demo-task-09-impedida",
      phaseId: "demo-phase-09",
      title: "Coletar registros fictícios",
      text: "Impedida e atrasada. Não é suspensão.",
      assigneeId: COLAB,
      status: "IMPEDIDA",
      progressPercent: 35,
      end: previous,
      hasImpediment: true,
    }),
    task({
      id: "demo-task-10-cancelada",
      phaseId: "demo-phase-10",
      title: "Carga inicial cancelada",
      text: "Cancelada antes do vencimento. Não é conclusão.",
      assigneeId: null,
      status: "CANCELADA",
      progressPercent: 0,
      end: cancelledEnd,
    }),
  ];

  const milestones: DemoMilestone[] = [
    {
      id: "demo-milestone-03-entrega",
      phaseId: "demo-phase-03",
      title: "Entrega do firewall fictício",
      description: mark("Entregue e aguardando aceite."),
      type: "ENTREGA",
      status: "ENTREGUE",
      baselineAt: previous,
      plannedAt: previous,
      actualAt: previous,
      deliveredBy: NORTE,
      validatedBy: null,
      validationNote: null,
      createdBy: PMO,
      updatedBy: PMO,
    },
    {
      id: "demo-milestone-05-pendente",
      phaseId: "demo-phase-05",
      title: "Aceite da identidade fictícia",
      description: mark("Marco pendente dentro de fase suspensa."),
      type: "ENTREGA",
      status: "PENDENTE",
      baselineAt: previous,
      plannedAt: previous,
      actualAt: null,
      deliveredBy: null,
      validatedBy: null,
      validationNote: null,
      createdBy: PMO,
      updatedBy: PMO,
    },
    {
      id: "demo-milestone-08-aceite",
      phaseId: "demo-phase-08",
      title: "Aceite do relatório fictício",
      description: mark("Aceite registrado por usuário diferente de quem entregou."),
      type: "ENTREGA",
      status: "APROVADO",
      baselineAt: previous,
      plannedAt: previous,
      actualAt: previous,
      deliveredBy: RIO,
      validatedBy: SISTEMAS,
      validationNote: mark("Aceite fictício."),
      createdBy: PMO,
      updatedBy: PMO,
    },
    {
      id: "demo-milestone-10-sem-responsavel",
      phaseId: "demo-phase-10",
      title: "Aprovação inicial fictícia",
      description: mark("Marco sem responsável específico."),
      type: "APROVACAO",
      status: "PENDENTE",
      baselineAt: offset(8),
      plannedAt: offset(8),
      actualAt: null,
      deliveredBy: null,
      validatedBy: null,
      validationNote: null,
      createdBy: PMO,
      updatedBy: PMO,
    },
  ];

  const scheduleRequests: DemoScheduleRequest[] = [
    {
      id: "demo-schedule-06-pendente",
      projectId: "demo-proj-06",
      phaseId: null,
      taskId: "demo-task-06-pendente",
      milestoneId: null,
      field: "PLANNED_END_AT",
      baselineValue: pendingEnd,
      expectedCurrentValue: pendingEnd,
      proposedValue: offset(20),
      justification: mark("Pedido fictício ainda sem decisão."),
      status: "PENDENTE",
      requestedBy: PMO,
      reviewedBy: null,
      reviewedAt: null,
      decisionNote: null,
    },
    {
      id: "demo-schedule-07-aprovada",
      projectId: "demo-proj-07",
      phaseId: null,
      taskId: "demo-task-07-aprovada",
      milestoneId: null,
      field: "PLANNED_END_AT",
      baselineValue: previous,
      expectedCurrentValue: previous,
      proposedValue: approvedEnd,
      justification: mark("Pedido fictício já aprovado."),
      status: "APROVADA",
      requestedBy: PMO,
      reviewedBy: PMO,
      reviewedAt: noon(today),
      decisionNote: null,
    },
  ];

  const scheduleChanges: DemoScheduleChange[] = [
    {
      id: "demo-change-07-aprovada",
      projectId: "demo-proj-07",
      requestId: "demo-schedule-07-aprovada",
      phaseId: null,
      taskId: "demo-task-07-aprovada",
      milestoneId: null,
      field: "PLANNED_END_AT",
      baselineValue: previous,
      oldValue: previous,
      newValue: approvedEnd,
      changedBy: PMO,
    },
  ];

  const evidences: DemoEvidence[] = [
    {
      id: "demo-evidence-03-marco",
      taskId: null,
      milestoneId: "demo-milestone-03-entrega",
      scheduleRequestId: null,
      title: mark("Link fictício do marco"),
      url: "https://exemplo.com/ficticio/marco-firewall",
      createdBy: PMO,
    },
    {
      id: "demo-evidence-08-tarefa",
      taskId: "demo-task-08-concluida",
      milestoneId: null,
      scheduleRequestId: null,
      title: mark("Link fictício da tarefa"),
      url: "https://exemplo.com/ficticio/tarefa-capacidade",
      createdBy: PMO,
    },
    {
      id: "demo-evidence-06-pedido",
      taskId: null,
      milestoneId: null,
      scheduleRequestId: "demo-schedule-06-pendente",
      title: mark("Link fictício da reprogramação"),
      url: "https://exemplo.com/ficticio/reprogramacao-catalogo",
      createdBy: PMO,
    },
  ];

  const impediments: DemoImpediment[] = [
    {
      id: "demo-impediment-09",
      taskId: "demo-task-09-impedida",
      description: mark("Falta um insumo fictício. O prazo continua valendo."),
      openedBy: PMO,
    },
  ];

  const catalog = {
    users,
    projects,
    members,
    phases,
    tasks,
    milestones,
    evidences,
    scheduleRequests,
    scheduleChanges,
    impediments,
  };

  assertCatalogIntegrity(catalog);

  return catalog;
}

export function assertCatalogIntegrity(catalog: DemoCatalog) {
  const ids = new Set<string>();

  for (const row of allRows(catalog)) {
    if (ids.has(row.id)) {
      throw new Error(`Identificador duplicado no catálogo: ${row.id}`);
    }

    ids.add(row.id);
  }

  if (catalog.projects.length !== 10 || catalog.users.length !== 8) {
    throw new Error("O catálogo precisa ter 10 projetos e 8 usuários.");
  }

  for (const person of catalog.users) {
    if (!person.email.endsWith(DEMO_EMAIL_DOMAIN) || person.email.includes("@igepps")) {
      throw new Error(`E-mail fora do domínio fictício: ${person.email}`);
    }

    if ((PROTECTED_EMAILS as readonly string[]).includes(person.email)) {
      throw new Error(`E-mail protegido não pode entrar no catálogo: ${person.email}`);
    }

    if (!person.name.startsWith(USER_MARKER)) {
      throw new Error(`Usuário sem marca de demonstração: ${person.id}`);
    }
  }

  const userIds = new Set(catalog.users.map((person) => person.id));
  const projectIds = new Set(catalog.projects.map((item) => item.id));
  const phaseIds = new Set(catalog.phases.map((item) => item.id));
  const taskIds = new Set(catalog.tasks.map((item) => item.id));
  const milestoneIds = new Set(catalog.milestones.map((item) => item.id));
  const requestIds = new Set(catalog.scheduleRequests.map((item) => item.id));

  for (const item of catalog.projects) {
    if (!item.description.startsWith(FICTION_MARKER)) {
      throw new Error(`Projeto sem marca de demonstração: ${item.id}`);
    }

    if (!userIds.has(item.ownerId)) {
      throw new Error(`Dono inexistente: ${item.id}`);
    }

    const owns = catalog.members.some(
      (memberRow) =>
        memberRow.projectId === item.id &&
        memberRow.userId === item.ownerId &&
        memberRow.role === "DONO_PROJETO",
    );

    if (!owns) {
      throw new Error(`Projeto sem participação de dono: ${item.id}`);
    }
  }

  const memberKeys = new Set<string>();

  for (const memberRow of catalog.members) {
    const key = `${memberRow.projectId}:${memberRow.userId}:${memberRow.role}`;

    if (memberKeys.has(key) || !projectIds.has(memberRow.projectId) || !userIds.has(memberRow.userId)) {
      throw new Error(`Participação inválida: ${memberRow.id}`);
    }

    memberKeys.add(key);
  }

  const sortKeys = new Set<string>();

  for (const phaseRow of catalog.phases) {
    const key = `${phaseRow.projectId}:${phaseRow.sortOrder}`;

    if (
      sortKeys.has(key) ||
      !projectIds.has(phaseRow.projectId) ||
      !phaseRow.description.startsWith(FICTION_MARKER) ||
      phaseRow.plannedEndAt < phaseRow.plannedStartAt ||
      phaseRow.baselineEndAt < phaseRow.baselineStartAt
    ) {
      throw new Error(`Fase inválida: ${phaseRow.id}`);
    }

    sortKeys.add(key);
  }

  for (const taskRow of catalog.tasks) {
    if (
      !phaseIds.has(taskRow.phaseId) ||
      !taskRow.description.startsWith(FICTION_MARKER) ||
      (taskRow.assigneeId !== null && !userIds.has(taskRow.assigneeId)) ||
      taskRow.plannedEndAt < taskRow.plannedStartAt ||
      taskRow.baselineEndAt < taskRow.baselineStartAt ||
      taskRow.progressPercent < 0 ||
      taskRow.progressPercent > 100 ||
      (taskRow.status === "CONCLUIDA" && taskRow.progressPercent !== 100) ||
      (taskRow.status !== "CONCLUIDA" && taskRow.progressPercent === 100) ||
      (taskRow.actualEndAt !== null &&
        (taskRow.actualStartAt === null || taskRow.actualEndAt < taskRow.actualStartAt)) ||
      (taskRow.status === "IMPEDIDA" && !taskRow.hasImpediment) ||
      (taskRow.status !== "IMPEDIDA" && taskRow.hasImpediment)
    ) {
      throw new Error(`Tarefa inválida: ${taskRow.id}`);
    }
  }

  for (const milestone of catalog.milestones) {
    if (
      !phaseIds.has(milestone.phaseId) ||
      !milestone.description.startsWith(FICTION_MARKER) ||
      (milestone.status === "ENTREGUE" && milestone.deliveredBy === null) ||
      (milestone.status === "APROVADO" &&
        (milestone.deliveredBy === null ||
          milestone.validatedBy === null ||
          milestone.deliveredBy === milestone.validatedBy))
    ) {
      throw new Error(`Marco inválido: ${milestone.id}`);
    }
  }

  for (const evidence of catalog.evidences) {
    const parents = [evidence.taskId, evidence.milestoneId, evidence.scheduleRequestId].filter(
      (value) => value !== null,
    );

    if (
      parents.length !== 1 ||
      (evidence.taskId !== null && !taskIds.has(evidence.taskId)) ||
      (evidence.milestoneId !== null && !milestoneIds.has(evidence.milestoneId)) ||
      (evidence.scheduleRequestId !== null && !requestIds.has(evidence.scheduleRequestId)) ||
      !evidence.url.startsWith("https://exemplo.com/ficticio/")
    ) {
      throw new Error(`Evidência inválida: ${evidence.id}`);
    }
  }

  for (const request of catalog.scheduleRequests) {
    const pending = request.status === "PENDENTE";

    if (
      !taskIds.has(request.taskId) ||
      !projectIds.has(request.projectId) ||
      request.justification.trim().length < 10 ||
      (pending && (request.reviewedBy !== null || request.reviewedAt !== null || request.decisionNote !== null)) ||
      (!pending && (request.reviewedBy === null || request.reviewedAt === null))
    ) {
      throw new Error(`Reprogramação inválida: ${request.id}`);
    }
  }

  for (const change of catalog.scheduleChanges) {
    if (!requestIds.has(change.requestId) || !taskIds.has(change.taskId)) {
      throw new Error(`Histórico de reprogramação inválido: ${change.id}`);
    }
  }

  for (const impediment of catalog.impediments) {
    const parent = catalog.tasks.find((item) => item.id === impediment.taskId);

    if (!parent?.hasImpediment || !impediment.description.startsWith(FICTION_MARKER)) {
      throw new Error(`Impedimento inválido: ${impediment.id}`);
    }
  }

  const statuses = new Set(catalog.tasks.map((item) => item.status));

  if (!statuses.has("EM_ANDAMENTO") || !statuses.has("IMPEDIDA") || !statuses.has("CANCELADA") || !statuses.has("CONCLUIDA")) {
    throw new Error("O catálogo não cobre os estados de tarefa pedidos.");
  }
}

function user(id: string, name: string, email: string, role: DemoUser["role"]): DemoUser {
  return {
    id,
    accountId: id.replace("demo-user-", "demo-account-"),
    name: `${USER_MARKER}${name}`,
    email,
    role,
  };
}

function project(
  number: string,
  name: string,
  area: string,
  ownerId: string,
  status: DemoProject["status"],
): DemoProject {
  return {
    id: `demo-proj-${number}`,
    name,
    description: `${FICTION_MARKER} Área fictícia: ${area}.`,
    ownerId,
    status,
  };
}

function ownerMembers(number: string, ownerId: string): DemoMember[] {
  return [
    member(number, "dono", ownerId, "DONO_PROJETO"),
    member(number, "gestor", ownerId, "GESTOR"),
  ];
}

function member(
  number: string,
  key: string,
  userId: string,
  role: DemoMember["role"],
): DemoMember {
  return {
    id: `demo-member-${number}-${key}`,
    projectId: `demo-proj-${number}`,
    userId,
    role,
  };
}

function phase(
  number: string,
  name: string,
  status: DemoPhase["status"],
  start: Date,
  end: Date,
): DemoPhase {
  return {
    id: `demo-phase-${number}`,
    projectId: `demo-proj-${number}`,
    name,
    description: `${FICTION_MARKER} Fase de demonstração.`,
    sortOrder: 0,
    status,
    baselineStartAt: start,
    baselineEndAt: end,
    plannedStartAt: start,
    plannedEndAt: end,
    createdBy: PMO,
    updatedBy: PMO,
  };
}

function task(input: {
  id: string;
  phaseId: string;
  title: string;
  text: string;
  assigneeId: string | null;
  status: DemoTask["status"];
  progressPercent: number;
  end: Date;
  baselineEnd?: Date;
  actualEnd?: Date | null;
  hasImpediment?: boolean;
}): DemoTask {
  const baselineEnd = input.baselineEnd ?? input.end;
  const plannedStartAt = atBelemNoon(addBusinessDays(civilToday(input.end), -5));
  const baselineStartAt = atBelemNoon(addBusinessDays(civilToday(baselineEnd), -5));

  return {
    id: input.id,
    phaseId: input.phaseId,
    title: input.title,
    description: `${FICTION_MARKER} ${input.text}`,
    assigneeId: input.assigneeId,
    status: input.status,
    progressPercent: input.progressPercent,
    weight: 1,
    baselineStartAt,
    baselineEndAt: baselineEnd,
    plannedStartAt,
    plannedEndAt: input.end,
    actualStartAt: input.actualEnd ? plannedStartAt : null,
    actualEndAt: input.actualEnd ?? null,
    hasImpediment: input.hasImpediment ?? false,
    createdBy: PMO,
    updatedBy: PMO,
  };
}

function allRows(catalog: DemoCatalog) {
  return [
    ...catalog.users,
    ...catalog.projects,
    ...catalog.members,
    ...catalog.phases,
    ...catalog.tasks,
    ...catalog.milestones,
    ...catalog.evidences,
    ...catalog.scheduleRequests,
    ...catalog.scheduleChanges,
    ...catalog.impediments,
  ];
}

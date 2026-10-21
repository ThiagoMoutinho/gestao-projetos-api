import type { DemoCatalog } from "./catalog";
import { FICTION_MARKER, USER_MARKER } from "./constants";

export type DemoTable =
  | "users"
  | "projects"
  | "members"
  | "phases"
  | "tasks"
  | "milestones"
  | "evidences"
  | "scheduleRequests"
  | "scheduleChanges"
  | "impediments";

export type SeedAction = {
  op: "insert" | "update" | "unchanged" | "skip";
  table: DemoTable;
  id: string;
  reason?: string;
};

export type DemoSnapshot = {
  users: { id: string; email: string; name: string; role: string }[];
  projects: { id: string; description: string | null; ownerId: string }[];
  members: { id: string; projectId: string; userId: string; role: string }[];
  phases: {
    id: string;
    projectId: string;
    description: string | null;
    sortOrder: number;
    createdBy: string;
    updatedBy: string;
  }[];
  tasks: {
    id: string;
    phaseId: string;
    description: string | null;
    assigneeId: string | null;
    createdBy: string;
    updatedBy: string;
  }[];
  milestones: {
    id: string;
    phaseId: string;
    description: string | null;
    deliveredBy: string | null;
    validatedBy: string | null;
    createdBy: string;
    updatedBy: string;
  }[];
  evidences: {
    id: string;
    taskId: string | null;
    milestoneId: string | null;
    scheduleRequestId: string | null;
    title: string;
    createdBy: string;
  }[];
  scheduleRequests: {
    id: string;
    projectId: string;
    taskId: string | null;
    justification: string;
    requestedBy: string;
    reviewedBy: string | null;
  }[];
  scheduleChanges: { id: string; requestId: string; changedBy: string }[];
  impediments: { id: string; taskId: string; description: string; openedBy: string }[];
  blockedUserIds: string[];
  auditRefs: { actorId: string; projectId: string }[];
};

export function emptySnapshot(): DemoSnapshot {
  return {
    users: [],
    projects: [],
    members: [],
    phases: [],
    tasks: [],
    milestones: [],
    evidences: [],
    scheduleRequests: [],
    scheduleChanges: [],
    impediments: [],
    blockedUserIds: [],
    auditRefs: [],
  };
}

export function planSeed(snapshot: DemoSnapshot, catalog: DemoCatalog): SeedAction[] {
  const actions: SeedAction[] = [];
  const availableUsers = new Set<string>();

  for (const person of catalog.users) {
    const byId = snapshot.users.find((item) => item.id === person.id);
    const byEmail = snapshot.users.find((item) => item.email === person.email);

    if (!byId && !byEmail) {
      actions.push({ op: "insert", table: "users", id: person.id });
      availableUsers.add(person.id);
      continue;
    }

    if (
      byId &&
      byId.email === person.email &&
      byId.name.startsWith(USER_MARKER) &&
      byEmail?.id === person.id
    ) {
      actions.push({ op: "unchanged", table: "users", id: person.id });
      availableUsers.add(person.id);
      continue;
    }

    actions.push({
      op: "skip",
      table: "users",
      id: person.id,
      reason: "O usuário existente deixou o catálogo ou o e-mail pertence a outro registro.",
    });
  }

  const controlledProjects = new Set<string>();

  for (const project of catalog.projects) {
    const existing = snapshot.projects.find((item) => item.id === project.id);

    if (!availableUsers.has(project.ownerId)) {
      actions.push({
        op: "skip",
        table: "projects",
        id: project.id,
        reason: "O dono fictício não está disponível.",
      });
      continue;
    }

    if (!existing) {
      actions.push({ op: "insert", table: "projects", id: project.id });
      controlledProjects.add(project.id);
      continue;
    }

    if (!hasMarker(existing.description)) {
      actions.push({
        op: "skip",
        table: "projects",
        id: project.id,
        reason: "O projeto deixou de pertencer ao catálogo.",
      });
      continue;
    }

    actions.push({ op: "update", table: "projects", id: project.id });
    controlledProjects.add(project.id);
  }

  for (const memberRow of catalog.members) {
    if (!controlledProjects.has(memberRow.projectId) || !availableUsers.has(memberRow.userId)) {
      actions.push({
        op: "skip",
        table: "members",
        id: memberRow.id,
        reason: "O projeto ou o usuário da participação não está no catálogo controlado.",
      });
      continue;
    }

    const existing = snapshot.members.find((item) => item.id === memberRow.id);
    const conflict = snapshot.members.find(
      (item) =>
        item.id !== memberRow.id &&
        item.projectId === memberRow.projectId &&
        item.userId === memberRow.userId &&
        item.role === memberRow.role,
    );

    if (!existing && !conflict) {
      actions.push({ op: "insert", table: "members", id: memberRow.id });
      continue;
    }

    if (
      existing &&
      !conflict &&
      existing.projectId === memberRow.projectId &&
      existing.userId === memberRow.userId &&
      existing.role === memberRow.role
    ) {
      actions.push({ op: "unchanged", table: "members", id: memberRow.id });
      continue;
    }

    actions.push({
      op: "skip",
      table: "members",
      id: memberRow.id,
      reason: "A participação foi alterada manualmente ou conflita com outro registro.",
    });
  }

  const controlledPhases = new Set<string>();

  for (const phaseRow of catalog.phases) {
    if (!controlledProjects.has(phaseRow.projectId)) {
      actions.push({
        op: "skip",
        table: "phases",
        id: phaseRow.id,
        reason: "A fase pertence a um projeto fora do catálogo controlado.",
      });
      continue;
    }

    const existing = snapshot.phases.find((item) => item.id === phaseRow.id);
    const sortConflict = snapshot.phases.find(
      (item) =>
        item.id !== phaseRow.id &&
        item.projectId === phaseRow.projectId &&
        item.sortOrder === phaseRow.sortOrder,
    );

    if (!existing && !sortConflict) {
      actions.push({ op: "insert", table: "phases", id: phaseRow.id });
      controlledPhases.add(phaseRow.id);
      continue;
    }

    if (
      existing &&
      !sortConflict &&
      existing.projectId === phaseRow.projectId &&
      hasMarker(existing.description)
    ) {
      actions.push({ op: "update", table: "phases", id: phaseRow.id });
      controlledPhases.add(phaseRow.id);
      continue;
    }

    actions.push({
      op: "skip",
      table: "phases",
      id: phaseRow.id,
      reason: "A fase deixou o catálogo ou a ordem conflita com outro registro.",
    });
  }

  const controlledTasks = new Set<string>();

  for (const taskRow of catalog.tasks) {
    if (!controlledPhases.has(taskRow.phaseId) || (taskRow.assigneeId && !availableUsers.has(taskRow.assigneeId))) {
      actions.push({
        op: "skip",
        table: "tasks",
        id: taskRow.id,
        reason: "A tarefa depende de fase ou responsável fora do catálogo controlado.",
      });
      continue;
    }

    const existing = snapshot.tasks.find((item) => item.id === taskRow.id);

    if (!existing) {
      actions.push({ op: "insert", table: "tasks", id: taskRow.id });
      controlledTasks.add(taskRow.id);
      continue;
    }

    if (existing.phaseId === taskRow.phaseId && hasMarker(existing.description)) {
      actions.push({ op: "update", table: "tasks", id: taskRow.id });
      controlledTasks.add(taskRow.id);
      continue;
    }

    actions.push({
      op: "skip",
      table: "tasks",
      id: taskRow.id,
      reason: "A tarefa deixou de pertencer ao catálogo.",
    });
  }

  const controlledMilestones = new Set<string>();

  for (const milestone of catalog.milestones) {
    const people = [milestone.deliveredBy, milestone.validatedBy].filter((value) => value !== null);
    const peopleReady = people.every((value) => availableUsers.has(value));

    if (!controlledPhases.has(milestone.phaseId) || !peopleReady) {
      actions.push({
        op: "skip",
        table: "milestones",
        id: milestone.id,
        reason: "O marco depende de fase ou usuário fora do catálogo controlado.",
      });
      continue;
    }

    const existing = snapshot.milestones.find((item) => item.id === milestone.id);

    if (!existing) {
      actions.push({ op: "insert", table: "milestones", id: milestone.id });
      controlledMilestones.add(milestone.id);
      continue;
    }

    if (existing.phaseId === milestone.phaseId && hasMarker(existing.description)) {
      actions.push({ op: "update", table: "milestones", id: milestone.id });
      controlledMilestones.add(milestone.id);
      continue;
    }

    actions.push({
      op: "skip",
      table: "milestones",
      id: milestone.id,
      reason: "O marco deixou de pertencer ao catálogo.",
    });
  }

  const controlledRequests = new Set<string>();

  for (const request of catalog.scheduleRequests) {
    if (!controlledProjects.has(request.projectId) || !controlledTasks.has(request.taskId)) {
      actions.push({
        op: "skip",
        table: "scheduleRequests",
        id: request.id,
        reason: "A reprogramação depende de projeto ou tarefa fora do catálogo controlado.",
      });
      continue;
    }

    const existing = snapshot.scheduleRequests.find((item) => item.id === request.id);

    if (!existing) {
      actions.push({ op: "insert", table: "scheduleRequests", id: request.id });
      controlledRequests.add(request.id);
      continue;
    }

    if (
      existing.projectId === request.projectId &&
      existing.taskId === request.taskId &&
      hasMarker(existing.justification)
    ) {
      actions.push({ op: "update", table: "scheduleRequests", id: request.id });
      controlledRequests.add(request.id);
      continue;
    }

    actions.push({
      op: "skip",
      table: "scheduleRequests",
      id: request.id,
      reason: "A reprogramação deixou de pertencer ao catálogo.",
    });
  }

  for (const change of catalog.scheduleChanges) {
    if (!controlledRequests.has(change.requestId) || !controlledTasks.has(change.taskId)) {
      actions.push({
        op: "skip",
        table: "scheduleChanges",
        id: change.id,
        reason: "O histórico depende de pedido ou tarefa fora do catálogo controlado.",
      });
      continue;
    }

    const existing = snapshot.scheduleChanges.find((item) => item.id === change.id);

    if (!existing) {
      actions.push({ op: "insert", table: "scheduleChanges", id: change.id });
      continue;
    }

    if (existing.requestId === change.requestId) {
      actions.push({ op: "update", table: "scheduleChanges", id: change.id });
      continue;
    }

    actions.push({
      op: "skip",
      table: "scheduleChanges",
      id: change.id,
      reason: "O histórico deixou de pertencer ao catálogo.",
    });
  }

  for (const evidence of catalog.evidences) {
    const parentReady =
      (evidence.taskId === null || controlledTasks.has(evidence.taskId)) &&
      (evidence.milestoneId === null || controlledMilestones.has(evidence.milestoneId)) &&
      (evidence.scheduleRequestId === null || controlledRequests.has(evidence.scheduleRequestId));

    if (!parentReady) {
      actions.push({
        op: "skip",
        table: "evidences",
        id: evidence.id,
        reason: "A evidência depende de um pai fora do catálogo controlado.",
      });
      continue;
    }

    const existing = snapshot.evidences.find((item) => item.id === evidence.id);

    if (!existing) {
      actions.push({ op: "insert", table: "evidences", id: evidence.id });
      continue;
    }

    if (
      existing.taskId === evidence.taskId &&
      existing.milestoneId === evidence.milestoneId &&
      existing.scheduleRequestId === evidence.scheduleRequestId &&
      hasMarker(existing.title)
    ) {
      actions.push({ op: "update", table: "evidences", id: evidence.id });
      continue;
    }

    actions.push({
      op: "skip",
      table: "evidences",
      id: evidence.id,
      reason: "A evidência deixou de pertencer ao catálogo.",
    });
  }

  for (const impediment of catalog.impediments) {
    if (!controlledTasks.has(impediment.taskId)) {
      actions.push({
        op: "skip",
        table: "impediments",
        id: impediment.id,
        reason: "O impedimento depende de tarefa fora do catálogo controlado.",
      });
      continue;
    }

    const existing = snapshot.impediments.find((item) => item.id === impediment.id);

    if (!existing) {
      actions.push({ op: "insert", table: "impediments", id: impediment.id });
      continue;
    }

    if (existing.taskId === impediment.taskId && hasMarker(existing.description)) {
      actions.push({ op: "update", table: "impediments", id: impediment.id });
      continue;
    }

    actions.push({
      op: "skip",
      table: "impediments",
      id: impediment.id,
      reason: "O impedimento deixou de pertencer ao catálogo.",
    });
  }

  return actions;
}

export function snapshotAfterSeed(snapshot: DemoSnapshot, catalog: DemoCatalog, actions: SeedAction[]): DemoSnapshot {
  const next = structuredClone(snapshot);
  const written = new Set(actions.filter((action) => action.op === "insert" || action.op === "update").map((action) => `${action.table}:${action.id}`));

  for (const person of catalog.users) {
    if (!written.has(`users:${person.id}`)) {
      continue;
    }

    const current = next.users.find((item) => item.id === person.id);

    if (current) {
      current.email = person.email;
      current.name = person.name;
      current.role = person.role;
    } else {
      next.users.push({ id: person.id, email: person.email, name: person.name, role: person.role });
    }
  }

  for (const project of catalog.projects) {
    if (!written.has(`projects:${project.id}`)) {
      continue;
    }

    const current = next.projects.find((item) => item.id === project.id);

    if (current) {
      current.description = project.description;
      current.ownerId = project.ownerId;
    } else {
      next.projects.push({ id: project.id, description: project.description, ownerId: project.ownerId });
    }
  }

  copyRows(next.members, catalog.members, written, "members", (row) => ({
    id: row.id,
    projectId: row.projectId,
    userId: row.userId,
    role: row.role,
  }));
  copyRows(next.phases, catalog.phases, written, "phases", (row) => ({
    id: row.id,
    projectId: row.projectId,
    description: row.description,
    sortOrder: row.sortOrder,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
  }));
  copyRows(next.tasks, catalog.tasks, written, "tasks", (row) => ({
    id: row.id,
    phaseId: row.phaseId,
    description: row.description,
    assigneeId: row.assigneeId,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
  }));
  copyRows(next.milestones, catalog.milestones, written, "milestones", (row) => ({
    id: row.id,
    phaseId: row.phaseId,
    description: row.description,
    deliveredBy: row.deliveredBy,
    validatedBy: row.validatedBy,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
  }));
  copyRows(next.evidences, catalog.evidences, written, "evidences", (row) => ({
    id: row.id,
    taskId: row.taskId,
    milestoneId: row.milestoneId,
    scheduleRequestId: row.scheduleRequestId,
    title: row.title,
    createdBy: row.createdBy,
  }));
  copyRows(next.scheduleRequests, catalog.scheduleRequests, written, "scheduleRequests", (row) => ({
    id: row.id,
    projectId: row.projectId,
    taskId: row.taskId,
    justification: row.justification,
    requestedBy: row.requestedBy,
    reviewedBy: row.reviewedBy,
  }));
  copyRows(next.scheduleChanges, catalog.scheduleChanges, written, "scheduleChanges", (row) => ({
    id: row.id,
    requestId: row.requestId,
    changedBy: row.changedBy,
  }));
  copyRows(next.impediments, catalog.impediments, written, "impediments", (row) => ({
    id: row.id,
    taskId: row.taskId,
    description: row.description,
    openedBy: row.openedBy,
  }));

  return next;
}

function copyRows<T extends { id: string }>(
  target: T[],
  source: T[],
  written: Set<string>,
  table: DemoTable,
  mapRow: (row: T) => T,
) {
  for (const row of source) {
    if (!written.has(`${table}:${row.id}`)) {
      continue;
    }

    const current = target.find((item) => item.id === row.id);
    const mapped = mapRow(row);

    if (current) {
      Object.assign(current, mapped);
    } else {
      target.push(mapped);
    }
  }
}

function hasMarker(value: string | null) {
  return value !== null && value.startsWith(FICTION_MARKER);
}

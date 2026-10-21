import { and, eq, inArray, like, max, or } from "drizzle-orm";

import { db } from "../../db";
import {
  eapAuditLogs,
  eapEvidences,
  eapImpediments,
  eapMilestones,
  eapPhases,
  eapScheduleChanges,
  eapScheduleRequests,
  eapTasks,
  projectMembers,
  projects,
  user,
} from "../../db/schema";
import { auth } from "../../lib/auth";
import type { DemoCatalog } from "./catalog";
import type { CleanupPlan } from "./clean-plan";
import { DEMO_EMAIL_DOMAIN, FICTION_MARKER, PROTECTED_EMAILS, USER_MARKER } from "./constants";
import { DemoSeedRefused } from "./guard";
import { emptySnapshot, type DemoSnapshot, type DemoTable, type SeedAction } from "./plan";

const markerLike = `${FICTION_MARKER}%`;
const userLike = `${USER_MARKER}%`;

type AuthContext = Awaited<typeof auth.$context>;
type QueryClient = Pick<typeof db, "select" | "insert" | "update" | "delete">;

export async function loadDemoSnapshot(catalog: DemoCatalog): Promise<DemoSnapshot> {
  const snapshot = emptySnapshot();
  const projectIds = catalog.projects.map((item) => item.id);
  const userIds = catalog.users.map((item) => item.id);
  const emails = catalog.users.map((item) => item.email);
  const phaseIds = catalog.phases.map((item) => item.id);
  const taskIds = catalog.tasks.map((item) => item.id);
  const milestoneIds = catalog.milestones.map((item) => item.id);
  const requestIds = catalog.scheduleRequests.map((item) => item.id);

  snapshot.users = await db
    .select({ id: user.id, email: user.email, name: user.name, role: user.role })
    .from(user)
    .where(inArray(user.id, userIds));

  const byEmail = await db
    .select({ id: user.id, email: user.email, name: user.name, role: user.role })
    .from(user)
    .where(inArray(user.email, emails));

  for (const person of byEmail) {
    if (!snapshot.users.some((item) => item.id === person.id)) {
      snapshot.users.push(person);
    }
  }

  snapshot.projects = await db
    .select({ id: projects.id, description: projects.description, ownerId: projects.ownerId })
    .from(projects)
    .where(inArray(projects.id, projectIds));

  snapshot.members = await db
    .select({
      id: projectMembers.id,
      projectId: projectMembers.projectId,
      userId: projectMembers.userId,
      role: projectMembers.role,
    })
    .from(projectMembers)
    .where(inArray(projectMembers.projectId, projectIds));

  snapshot.phases = await db
    .select({
      id: eapPhases.id,
      projectId: eapPhases.projectId,
      description: eapPhases.description,
      sortOrder: eapPhases.sortOrder,
      createdBy: eapPhases.createdBy,
      updatedBy: eapPhases.updatedBy,
    })
    .from(eapPhases)
    .where(inArray(eapPhases.projectId, projectIds));

  const loadedPhaseIds = unique([...snapshot.phases.map((item) => item.id), ...phaseIds]);

  snapshot.tasks = await db
    .select({
      id: eapTasks.id,
      phaseId: eapTasks.phaseId,
      description: eapTasks.description,
      assigneeId: eapTasks.assigneeId,
      createdBy: eapTasks.createdBy,
      updatedBy: eapTasks.updatedBy,
    })
    .from(eapTasks)
    .where(inArray(eapTasks.phaseId, loadedPhaseIds));

  const knownTaskIds = unique([...snapshot.tasks.map((item) => item.id), ...taskIds]);

  snapshot.milestones = await db
    .select({
      id: eapMilestones.id,
      phaseId: eapMilestones.phaseId,
      description: eapMilestones.description,
      deliveredBy: eapMilestones.deliveredBy,
      validatedBy: eapMilestones.validatedBy,
      createdBy: eapMilestones.createdBy,
      updatedBy: eapMilestones.updatedBy,
    })
    .from(eapMilestones)
    .where(inArray(eapMilestones.phaseId, loadedPhaseIds));

  const knownMilestoneIds = unique([...snapshot.milestones.map((item) => item.id), ...milestoneIds]);

  snapshot.scheduleRequests = await db
    .select({
      id: eapScheduleRequests.id,
      projectId: eapScheduleRequests.projectId,
      taskId: eapScheduleRequests.taskId,
      justification: eapScheduleRequests.justification,
      requestedBy: eapScheduleRequests.requestedBy,
      reviewedBy: eapScheduleRequests.reviewedBy,
    })
    .from(eapScheduleRequests)
    .where(inArray(eapScheduleRequests.projectId, projectIds));

  const knownRequestIds = unique([...snapshot.scheduleRequests.map((item) => item.id), ...requestIds]);

  snapshot.scheduleChanges = await db
    .select({
      id: eapScheduleChanges.id,
      requestId: eapScheduleChanges.requestId,
      changedBy: eapScheduleChanges.changedBy,
    })
    .from(eapScheduleChanges)
    .where(inArray(eapScheduleChanges.requestId, knownRequestIds));

  snapshot.evidences = await db
    .select({
      id: eapEvidences.id,
      taskId: eapEvidences.taskId,
      milestoneId: eapEvidences.milestoneId,
      scheduleRequestId: eapEvidences.scheduleRequestId,
      title: eapEvidences.title,
      createdBy: eapEvidences.createdBy,
    })
    .from(eapEvidences)
    .where(
      or(
        inArray(eapEvidences.taskId, knownTaskIds),
        inArray(eapEvidences.milestoneId, knownMilestoneIds),
        inArray(eapEvidences.scheduleRequestId, knownRequestIds),
      ),
    );

  snapshot.impediments = await db
    .select({
      id: eapImpediments.id,
      taskId: eapImpediments.taskId,
      description: eapImpediments.description,
      openedBy: eapImpediments.openedBy,
    })
    .from(eapImpediments)
    .where(inArray(eapImpediments.taskId, knownTaskIds));

  snapshot.auditRefs = await db
    .select({ actorId: eapAuditLogs.actorId, projectId: eapAuditLogs.projectId })
    .from(eapAuditLogs)
    .where(and(inArray(eapAuditLogs.actorId, userIds), inArray(eapAuditLogs.projectId, projectIds)));

  snapshot.blockedUserIds = await loadBlockedUserIds(catalog, {
    projectIds,
    userIds,
    phaseIds,
    taskIds: knownTaskIds,
    milestoneIds: knownMilestoneIds,
    requestIds: knownRequestIds,
  });

  return snapshot;
}

export async function executeSeed(catalog: DemoCatalog, actions: SeedAction[], password: string) {
  const context = await auth.$context;
  await applyUsers(context, catalog, actions, password);

  const writable = actions.filter((action) => action.op === "insert" || action.op === "update");

  await db.transaction(async (tx) => {
    for (const table of WRITE_ORDER) {
      for (const action of writable.filter((item) => item.table === table)) {
        await writeRow(tx, catalog, action);
      }
    }
  });
}

export async function executeCleanup(catalog: DemoCatalog, plan: CleanupPlan) {
  await db.transaction(async (tx) => {
    const markedProjects = new Set(
      (
        await tx
          .select({ id: projects.id })
          .from(projects)
          .where(like(projects.description, markerLike))
      ).map((item) => item.id),
    );

    for (const table of WRITE_ORDER) {
      const ids = plan.deletions.filter((item) => item.table === table).map((item) => item.id);

      if (ids.length === 0) {
        continue;
      }

      await deleteRows(tx, catalog, table, ids, markedProjects);
    }

    const userIds = plan.deletions.filter((item) => item.table === "users").map((item) => item.id);
    const emails = catalog.users
      .filter((person) => userIds.includes(person.id))
      .map((person) => person.email)
      .filter((email) => email.endsWith(DEMO_EMAIL_DOMAIN) && !(PROTECTED_EMAILS as readonly string[]).includes(email));

    if (userIds.length > 0 && emails.length > 0) {
      await tx.delete(user).where(
        and(inArray(user.id, userIds), inArray(user.email, emails), like(user.name, userLike)),
      );
    }
  });
}

const WRITE_ORDER: DemoTable[] = [
  "projects",
  "members",
  "phases",
  "tasks",
  "milestones",
  "scheduleRequests",
  "scheduleChanges",
  "evidences",
  "impediments",
];

async function applyUsers(
  context: AuthContext,
  catalog: DemoCatalog,
  actions: SeedAction[],
  password: string,
) {
  for (const action of actions.filter((item) => item.table === "users" && item.op === "insert")) {
    const person = catalog.users.find((item) => item.id === action.id);

    if (!person) {
      throw new DemoSeedRefused("Usuário do catálogo não encontrado.");
    }

    const hashedPassword = await context.password.hash(password);
    const before = await listRoles(context);
    const created = readUser(
      await context.internalAdapter.createUser(
        {
          id: person.id,
          email: person.email,
          name: person.name,
          role: person.role,
          emailVerified: false,
        },
        { method: "email-password" },
      ),
    );

    if (!created || created.id !== person.id || created.role !== person.role) {
      if (created) {
        await context.internalAdapter.deleteUser(created.id);
      }

      throw new DemoSeedRefused("O usuário fictício não foi criado com o identificador e o perfil previstos.");
    }

    try {
      await context.internalAdapter.linkAccount({
        id: person.accountId,
        accountId: person.id,
        providerId: "credential",
        userId: person.id,
        password: hashedPassword,
      });
    } catch (error) {
      await context.internalAdapter.deleteUser(created.id);
      throw error;
    }

    const confirmed = await context.internalAdapter.findUserByEmail(person.email, { includeAccounts: true });
    const credential = credentialOf(confirmed);

    if (!credential || credential.password.length === 0 || credential.password === password) {
      await context.internalAdapter.deleteUser(created.id);
      throw new DemoSeedRefused("A credencial fictícia não foi gravada com o hash do Better Auth.");
    }

    if (!sameRoles(before, await listRoles(context))) {
      await context.internalAdapter.deleteUser(created.id);
      throw new DemoSeedRefused("A criação foi desfeita porque o perfil de outro usuário mudou.");
    }
  }
}

async function writeRow(tx: QueryClient, catalog: DemoCatalog, action: SeedAction) {
  const now = new Date();

  switch (action.table) {
    case "projects": {
      const row = required(catalog.projects, action.id);

      if (action.op === "insert") {
        await tx.insert(projects).values({ ...row, glpiTicketId: null, createdAt: now, updatedAt: now });
        return;
      }

      await tx
        .update(projects)
        .set({
          name: row.name,
          description: row.description,
          ownerId: row.ownerId,
          status: row.status,
          glpiTicketId: null,
          updatedAt: now,
        })
        .where(and(eq(projects.id, row.id), like(projects.description, markerLike)));
      return;
    }
    case "members": {
      const row = required(catalog.members, action.id);

      if (action.op === "insert") {
        await tx.insert(projectMembers).values({ ...row, createdAt: now });
      }

      return;
    }
    case "phases": {
      const row = required(catalog.phases, action.id);

      if (action.op === "insert") {
        await tx.insert(eapPhases).values({ ...row, actualStartAt: null, actualEndAt: null, createdAt: now, updatedAt: now });
        return;
      }

      await tx
        .update(eapPhases)
        .set({
          name: row.name,
          description: row.description,
          status: row.status,
          sortOrder: row.sortOrder,
          baselineStartAt: row.baselineStartAt,
          baselineEndAt: row.baselineEndAt,
          plannedStartAt: row.plannedStartAt,
          plannedEndAt: row.plannedEndAt,
          updatedBy: row.updatedBy,
          updatedAt: now,
        })
        .where(and(eq(eapPhases.id, row.id), like(eapPhases.description, markerLike)));
      return;
    }
    case "tasks": {
      const row = required(catalog.tasks, action.id);

      if (action.op === "insert") {
        const [current] = await tx
          .select({ value: max(eapTasks.sortOrder) })
          .from(eapTasks)
          .where(eq(eapTasks.phaseId, row.phaseId));
        await tx.insert(eapTasks).values({
          ...row,
          sortOrder: (current?.value ?? -1) + 1,
          createdAt: now,
          updatedAt: now,
        });
        return;
      }

      await tx
        .update(eapTasks)
        .set({
          title: row.title,
          description: row.description,
          assigneeId: row.assigneeId,
          status: row.status,
          progressPercent: row.progressPercent,
          weight: row.weight,
          baselineStartAt: row.baselineStartAt,
          baselineEndAt: row.baselineEndAt,
          plannedStartAt: row.plannedStartAt,
          plannedEndAt: row.plannedEndAt,
          actualStartAt: row.actualStartAt,
          actualEndAt: row.actualEndAt,
          hasImpediment: row.hasImpediment,
          updatedBy: row.updatedBy,
          updatedAt: now,
        })
        .where(and(eq(eapTasks.id, row.id), like(eapTasks.description, markerLike)));
      return;
    }
    case "milestones": {
      const row = required(catalog.milestones, action.id);

      if (action.op === "insert") {
        const [current] = await tx
          .select({ value: max(eapMilestones.sortOrder) })
          .from(eapMilestones)
          .where(eq(eapMilestones.phaseId, row.phaseId));
        await tx.insert(eapMilestones).values({
          ...row,
          sortOrder: (current?.value ?? -1) + 1,
          createdAt: now,
          updatedAt: now,
        });
        return;
      }

      await tx
        .update(eapMilestones)
        .set({
          title: row.title,
          description: row.description,
          type: row.type,
          status: row.status,
          baselineAt: row.baselineAt,
          plannedAt: row.plannedAt,
          actualAt: row.actualAt,
          deliveredBy: row.deliveredBy,
          validatedBy: row.validatedBy,
          validationNote: row.validationNote,
          updatedBy: row.updatedBy,
          updatedAt: now,
        })
        .where(and(eq(eapMilestones.id, row.id), like(eapMilestones.description, markerLike)));
      return;
    }
    case "scheduleRequests": {
      const row = required(catalog.scheduleRequests, action.id);
      const values = {
        projectId: row.projectId,
        phaseId: row.phaseId,
        taskId: row.taskId,
        milestoneId: row.milestoneId,
        field: row.field,
        baselineValue: row.baselineValue,
        expectedCurrentValue: row.expectedCurrentValue,
        proposedValue: row.proposedValue,
        justification: row.justification,
        status: row.status,
        requestedBy: row.requestedBy,
        reviewedBy: row.reviewedBy,
        reviewedAt: row.reviewedAt,
        decisionNote: row.decisionNote,
        updatedAt: now,
      };

      if (action.op === "insert") {
        await tx.insert(eapScheduleRequests).values({ ...values, id: row.id, requestedAt: now, createdAt: now });
        return;
      }

      await tx
        .update(eapScheduleRequests)
        .set(values)
        .where(and(eq(eapScheduleRequests.id, row.id), like(eapScheduleRequests.justification, markerLike)));
      return;
    }
    case "scheduleChanges": {
      const row = required(catalog.scheduleChanges, action.id);

      if (action.op === "insert") {
        await tx.insert(eapScheduleChanges).values({ ...row, createdAt: now });
        return;
      }

      await tx
        .update(eapScheduleChanges)
        .set({
          baselineValue: row.baselineValue,
          oldValue: row.oldValue,
          newValue: row.newValue,
          changedBy: row.changedBy,
        })
        .where(and(eq(eapScheduleChanges.id, row.id), eq(eapScheduleChanges.requestId, row.requestId)));
      return;
    }
    case "evidences": {
      const row = required(catalog.evidences, action.id);

      if (action.op === "insert") {
        await tx.insert(eapEvidences).values({ ...row, createdAt: now });
        return;
      }

      await tx
        .update(eapEvidences)
        .set({ title: row.title, url: row.url })
        .where(and(eq(eapEvidences.id, row.id), like(eapEvidences.title, markerLike)));
      return;
    }
    case "impediments": {
      const row = required(catalog.impediments, action.id);

      if (action.op === "insert") {
        await tx.insert(eapImpediments).values({
          ...row,
          openedAt: now,
          resolvedBy: null,
          resolvedAt: null,
          resolutionNote: null,
        });
        return;
      }

      await tx
        .update(eapImpediments)
        .set({ description: row.description })
        .where(and(eq(eapImpediments.id, row.id), like(eapImpediments.description, markerLike)));
      return;
    }
    default:
      return;
  }
}

async function deleteRows(
  tx: QueryClient,
  catalog: DemoCatalog,
  table: DemoTable,
  ids: string[],
  markedProjects: Set<string>,
) {
  const marked = (projectId: string) => markedProjects.has(projectId);

  switch (table) {
    case "evidences":
      await tx.delete(eapEvidences).where(and(inArray(eapEvidences.id, ids), like(eapEvidences.title, markerLike)));
      return;
    case "impediments":
      await tx
        .delete(eapImpediments)
        .where(and(inArray(eapImpediments.id, ids), like(eapImpediments.description, markerLike)));
      return;
    case "scheduleChanges": {
      const requestIds = catalog.scheduleChanges
        .filter((item) => ids.includes(item.id) && marked(item.projectId))
        .map((item) => item.requestId);

      if (requestIds.length === 0) {
        return;
      }

      await tx
        .delete(eapScheduleChanges)
        .where(and(inArray(eapScheduleChanges.id, ids), inArray(eapScheduleChanges.requestId, requestIds)));
      return;
    }
    case "scheduleRequests": {
      const requestIds = ids.filter((id) => marked(catalog.scheduleRequests.find((item) => item.id === id)?.projectId ?? ""));

      if (requestIds.length === 0) {
        return;
      }

      await tx.delete(eapScheduleRequests).where(
        and(inArray(eapScheduleRequests.id, requestIds), like(eapScheduleRequests.justification, markerLike)),
      );
      return;
    }
    case "milestones":
      await tx
        .delete(eapMilestones)
        .where(and(inArray(eapMilestones.id, ids), like(eapMilestones.description, markerLike)));
      return;
    case "tasks":
      await tx.delete(eapTasks).where(and(inArray(eapTasks.id, ids), like(eapTasks.description, markerLike)));
      return;
    case "phases":
      await tx.delete(eapPhases).where(and(inArray(eapPhases.id, ids), like(eapPhases.description, markerLike)));
      return;
    case "members": {
      const memberIds = catalog.members.filter((item) => ids.includes(item.id) && marked(item.projectId)).map((item) => item.id);

      if (memberIds.length === 0) {
        return;
      }

      await tx.delete(projectMembers).where(inArray(projectMembers.id, memberIds));
      return;
    }
    case "projects": {
      const projectIds = ids.filter((id) => marked(id));

      if (projectIds.length === 0) {
        return;
      }

      await tx.delete(projects).where(and(inArray(projects.id, projectIds), like(projects.description, markerLike)));
      return;
    }
    default:
      return;
  }
}

async function loadBlockedUserIds(
  catalog: DemoCatalog,
  known: {
    projectIds: string[];
    userIds: string[];
    phaseIds: string[];
    taskIds: string[];
    milestoneIds: string[];
    requestIds: string[];
  },
) {
  const blocked = new Set<string>();
  const watch = (userId: string | null, rowId: string, catalogIds: Set<string>) => {
    if (userId && known.userIds.includes(userId) && !catalogIds.has(rowId)) {
      blocked.add(userId);
    }
  };
  const projectIds = new Set(known.projectIds);
  const phaseIds = new Set(known.phaseIds);
  const taskIds = new Set(known.taskIds);
  const milestoneIds = new Set(known.milestoneIds);
  const requestIds = new Set(known.requestIds);
  const userIds = new Set(known.userIds);

  const projectRows = await db.select({ id: projects.id, ownerId: projects.ownerId }).from(projects);
  for (const row of projectRows) {
    watch(row.ownerId, row.id, projectIds);
  }

  const memberRows = await db
    .select({ id: projectMembers.id, userId: projectMembers.userId })
    .from(projectMembers);
  const memberIds = new Set(catalog.members.map((item) => item.id));
  for (const row of memberRows) {
    watch(row.userId, row.id, memberIds);
  }

  const phaseRows = await db
    .select({ id: eapPhases.id, createdBy: eapPhases.createdBy, updatedBy: eapPhases.updatedBy })
    .from(eapPhases);
  for (const row of phaseRows) {
    watch(row.createdBy, row.id, phaseIds);
    watch(row.updatedBy, row.id, phaseIds);
  }

  const taskRows = await db
    .select({
      id: eapTasks.id,
      assigneeId: eapTasks.assigneeId,
      createdBy: eapTasks.createdBy,
      updatedBy: eapTasks.updatedBy,
    })
    .from(eapTasks);
  for (const row of taskRows) {
    watch(row.assigneeId, row.id, taskIds);
    watch(row.createdBy, row.id, taskIds);
    watch(row.updatedBy, row.id, taskIds);
  }

  const milestoneRows = await db
    .select({
      id: eapMilestones.id,
      deliveredBy: eapMilestones.deliveredBy,
      validatedBy: eapMilestones.validatedBy,
      createdBy: eapMilestones.createdBy,
      updatedBy: eapMilestones.updatedBy,
    })
    .from(eapMilestones);
  for (const row of milestoneRows) {
    watch(row.deliveredBy, row.id, milestoneIds);
    watch(row.validatedBy, row.id, milestoneIds);
    watch(row.createdBy, row.id, milestoneIds);
    watch(row.updatedBy, row.id, milestoneIds);
  }

  const requestRows = await db
    .select({
      id: eapScheduleRequests.id,
      requestedBy: eapScheduleRequests.requestedBy,
      reviewedBy: eapScheduleRequests.reviewedBy,
    })
    .from(eapScheduleRequests);
  for (const row of requestRows) {
    watch(row.requestedBy, row.id, requestIds);
    watch(row.reviewedBy, row.id, requestIds);
  }

  const changeRows = await db
    .select({ id: eapScheduleChanges.id, changedBy: eapScheduleChanges.changedBy })
    .from(eapScheduleChanges);
  const changeIds = new Set(catalog.scheduleChanges.map((item) => item.id));
  for (const row of changeRows) {
    watch(row.changedBy, row.id, changeIds);
  }

  const evidenceRows = await db
    .select({ id: eapEvidences.id, createdBy: eapEvidences.createdBy })
    .from(eapEvidences);
  const evidenceIds = new Set(catalog.evidences.map((item) => item.id));
  for (const row of evidenceRows) {
    watch(row.createdBy, row.id, evidenceIds);
  }

  const impedimentRows = await db
    .select({ id: eapImpediments.id, openedBy: eapImpediments.openedBy })
    .from(eapImpediments);
  const impedimentIds = new Set(catalog.impediments.map((item) => item.id));
  for (const row of impedimentRows) {
    watch(row.openedBy, row.id, impedimentIds);
  }

  const auditRows = await db
    .select({ actorId: eapAuditLogs.actorId, projectId: eapAuditLogs.projectId })
    .from(eapAuditLogs);
  for (const row of auditRows) {
    if (userIds.has(row.actorId) && !projectIds.has(row.projectId)) {
      blocked.add(row.actorId);
    }
  }

  return [...blocked];
}

function required<T extends { id: string }>(rows: T[], id: string) {
  const row = rows.find((item) => item.id === id);

  if (!row) {
    throw new DemoSeedRefused(`Registro do catálogo não encontrado: ${id}`);
  }

  return row;
}

async function listRoles(context: AuthContext) {
  return readUsers(await context.internalAdapter.listUsers(1000, 0)).map((item) => ({
    id: item.id,
    role: item.role,
  }));
}

function sameRoles(
  before: { id: string; role?: string }[],
  after: { id: string; role?: string }[],
) {
  const roles = new Map(before.map((item) => [item.id, item.role]));

  return after.filter((item) => roles.has(item.id)).every((item) => roles.get(item.id) === item.role);
}

function credentialOf(value: unknown) {
  if (!value || typeof value !== "object" || !("accounts" in value) || !Array.isArray(value.accounts)) {
    return undefined;
  }

  const accountRow = value.accounts.find(
    (item) => item && typeof item === "object" && "providerId" in item && item.providerId === "credential",
  );

  if (!accountRow || typeof accountRow !== "object" || !("password" in accountRow) || typeof accountRow.password !== "string") {
    return undefined;
  }

  return { password: accountRow.password };
}

function readUser(value: unknown) {
  const [userRow] = readUsers(value ? [value] : []);

  return userRow;
}

function readUsers(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const record = item as Record<string, unknown>;

    if (typeof record.id !== "string" || typeof record.email !== "string" || typeof record.name !== "string") {
      return [];
    }

    return [
      {
        id: record.id,
        email: record.email,
        name: record.name,
        role: typeof record.role === "string" ? record.role : undefined,
      },
    ];
  });
}

function unique(values: string[]) {
  return [...new Set(values)];
}

import type { DemoCatalog } from "./catalog";
import { DEMO_EMAIL_DOMAIN, FICTION_MARKER, PROTECTED_EMAILS, USER_MARKER } from "./constants";
import type { DemoSnapshot, DemoTable } from "./plan";

export type CleanupItem = {
  table: DemoTable;
  id: string;
};

export type CleanupPlan = {
  deletions: CleanupItem[];
  kept: CleanupItem[];
};

const TABLE_ORDER: DemoTable[] = [
  "evidences",
  "impediments",
  "scheduleChanges",
  "scheduleRequests",
  "milestones",
  "tasks",
  "phases",
  "members",
  "projects",
  "users",
];

export function planCleanup(snapshot: DemoSnapshot, catalog: DemoCatalog): CleanupPlan {
  const deletions: CleanupItem[] = [];
  const kept: CleanupItem[] = [];
  const deleted = new Set<string>();
  const ownedProjectIds = new Set(
    catalog.projects
      .filter((project) => {
        const existing = snapshot.projects.find((item) => item.id === project.id);

        return existing !== undefined && hasMarker(existing.description);
      })
      .map((project) => project.id),
  );
  const remove = (table: DemoTable, id: string) => {
    deletions.push({ table, id });
    deleted.add(`${table}:${id}`);
  };
  const keep = (table: DemoTable, id: string) => {
    kept.push({ table, id });
  };
  const projectOfPhase = (phaseId: string) =>
    catalog.phases.find((phaseRow) => phaseRow.id === phaseId)?.projectId;
  const projectIsOwned = (projectId: string | undefined) =>
    projectId !== undefined && ownedProjectIds.has(projectId);

  const ownedRequests = new Set(
    catalog.scheduleRequests
      .filter((request) => {
        const existing = snapshot.scheduleRequests.find((item) => item.id === request.id);
        return existing?.taskId === request.taskId && hasMarker(existing.justification);
      })
      .map((request) => request.id),
  );
  const ownedTasks = new Set(
    catalog.tasks
      .filter((taskRow) => {
        const existing = snapshot.tasks.find((item) => item.id === taskRow.id);
        return existing?.phaseId === taskRow.phaseId && hasMarker(existing.description);
      })
      .map((taskRow) => taskRow.id),
  );
  const ownedMilestones = new Set(
    catalog.milestones
      .filter((milestone) => {
        const existing = snapshot.milestones.find((item) => item.id === milestone.id);
        return existing?.phaseId === milestone.phaseId && hasMarker(existing.description);
      })
      .map((milestone) => milestone.id),
  );

  for (const evidence of catalog.evidences) {
    const existing = snapshot.evidences.find((item) => item.id === evidence.id);
    const parentOwned =
      (evidence.taskId === null || ownedTasks.has(evidence.taskId)) &&
      (evidence.milestoneId === null || ownedMilestones.has(evidence.milestoneId)) &&
      (evidence.scheduleRequestId === null || ownedRequests.has(evidence.scheduleRequestId));

    if (
      existing &&
      parentOwned &&
      projectIsOwned(projectOfEvidence(evidence, catalog)) &&
      existing.taskId === evidence.taskId &&
      existing.milestoneId === evidence.milestoneId &&
      existing.scheduleRequestId === evidence.scheduleRequestId &&
      hasMarker(existing.title)
    ) {
      remove("evidences", evidence.id);
    } else if (existing) {
      keep("evidences", evidence.id);
    }
  }

  for (const impediment of catalog.impediments) {
    const existing = snapshot.impediments.find((item) => item.id === impediment.id);

    if (
      existing &&
      ownedTasks.has(impediment.taskId) &&
      projectIsOwned(projectOfPhase(catalog.tasks.find((item) => item.id === impediment.taskId)?.phaseId ?? "")) &&
      existing.taskId === impediment.taskId &&
      hasMarker(existing.description)
    ) {
      remove("impediments", impediment.id);
    } else if (existing) {
      keep("impediments", impediment.id);
    }
  }

  for (const change of catalog.scheduleChanges) {
    const existing = snapshot.scheduleChanges.find((item) => item.id === change.id);

    if (
      existing &&
      ownedRequests.has(change.requestId) &&
      projectIsOwned(catalog.scheduleRequests.find((item) => item.id === change.requestId)?.projectId) &&
      existing.requestId === change.requestId
    ) {
      remove("scheduleChanges", change.id);
    } else if (existing) {
      keep("scheduleChanges", change.id);
    }
  }

  for (const request of catalog.scheduleRequests) {
    const existing = snapshot.scheduleRequests.find((item) => item.id === request.id);
    const foreignEvidence = snapshot.evidences.some(
      (item) => item.scheduleRequestId === request.id && !deleted.has(`evidences:${item.id}`),
    );

    if (existing && ownedRequests.has(request.id) && projectIsOwned(request.projectId) && !foreignEvidence) {
      remove("scheduleRequests", request.id);
    } else if (existing) {
      keep("scheduleRequests", request.id);
    }
  }

  for (const milestone of catalog.milestones) {
    const existing = snapshot.milestones.find((item) => item.id === milestone.id);
    const foreignEvidence = snapshot.evidences.some(
      (item) => item.milestoneId === milestone.id && !deleted.has(`evidences:${item.id}`),
    );

    if (
      existing &&
      ownedMilestones.has(milestone.id) &&
      projectIsOwned(projectOfPhase(milestone.phaseId)) &&
      !foreignEvidence
    ) {
      remove("milestones", milestone.id);
    } else if (existing) {
      keep("milestones", milestone.id);
    }
  }

  for (const taskRow of catalog.tasks) {
    const existing = snapshot.tasks.find((item) => item.id === taskRow.id);
    const blocked =
      snapshot.evidences.some((item) => item.taskId === taskRow.id && !deleted.has(`evidences:${item.id}`)) ||
      snapshot.impediments.some((item) => item.taskId === taskRow.id && !deleted.has(`impediments:${item.id}`)) ||
      snapshot.scheduleRequests.some((item) => item.taskId === taskRow.id && !deleted.has(`scheduleRequests:${item.id}`));

    if (existing && ownedTasks.has(taskRow.id) && projectIsOwned(projectOfPhase(taskRow.phaseId)) && !blocked) {
      remove("tasks", taskRow.id);
    } else if (existing) {
      keep("tasks", taskRow.id);
    }
  }

  const deletedTaskIds = new Set(deletions.filter((item) => item.table === "tasks").map((item) => item.id));
  const deletedMilestoneIds = new Set(deletions.filter((item) => item.table === "milestones").map((item) => item.id));

  for (const phaseRow of catalog.phases) {
    const existing = snapshot.phases.find((item) => item.id === phaseRow.id);
    const blocked =
      snapshot.tasks.some((item) => item.phaseId === phaseRow.id && !deletedTaskIds.has(item.id)) ||
      snapshot.milestones.some((item) => item.phaseId === phaseRow.id && !deletedMilestoneIds.has(item.id));

    if (
      existing &&
      existing.projectId === phaseRow.projectId &&
      projectIsOwned(phaseRow.projectId) &&
      hasMarker(existing.description) &&
      !blocked
    ) {
      remove("phases", phaseRow.id);
    } else if (existing) {
      keep("phases", phaseRow.id);
    }
  }

  for (const memberRow of catalog.members) {
    const existing = snapshot.members.find((item) => item.id === memberRow.id);

    if (
      existing &&
      projectIsOwned(memberRow.projectId) &&
      existing.projectId === memberRow.projectId &&
      existing.userId === memberRow.userId &&
      existing.role === memberRow.role
    ) {
      remove("members", memberRow.id);
    } else if (existing) {
      keep("members", memberRow.id);
    }
  }

  const deletedPhaseIds = new Set(deletions.filter((item) => item.table === "phases").map((item) => item.id));
  const deletedMemberIds = new Set(deletions.filter((item) => item.table === "members").map((item) => item.id));
  const deletedRequestIds = new Set(deletions.filter((item) => item.table === "scheduleRequests").map((item) => item.id));

  for (const project of catalog.projects) {
    const existing = snapshot.projects.find((item) => item.id === project.id);
    const blocked =
      snapshot.phases.some((item) => item.projectId === project.id && !deletedPhaseIds.has(item.id)) ||
      snapshot.members.some((item) => item.projectId === project.id && !deletedMemberIds.has(item.id)) ||
      snapshot.scheduleRequests.some((item) => item.projectId === project.id && !deletedRequestIds.has(item.id));

    if (existing && hasMarker(existing.description) && !blocked) {
      remove("projects", project.id);
    } else if (existing) {
      keep("projects", project.id);
    }
  }

  const removedIds = new Set(deletions.map((item) => item.id));

  for (const person of catalog.users) {
    const existing = snapshot.users.find((item) => item.id === person.id);
    const referenced = userStillReferenced(snapshot, person.id, removedIds);

    if (
      existing &&
      existing.email === person.email &&
      existing.email.endsWith(DEMO_EMAIL_DOMAIN) &&
      !(PROTECTED_EMAILS as readonly string[]).includes(existing.email) &&
      existing.name.startsWith(USER_MARKER) &&
      !snapshot.blockedUserIds.includes(person.id) &&
      !referenced
    ) {
      remove("users", person.id);
    } else if (existing) {
      keep("users", person.id);
    }
  }

  deletions.sort((left, right) => TABLE_ORDER.indexOf(left.table) - TABLE_ORDER.indexOf(right.table));

  return { deletions, kept };
}

export function formatCleanupPreview(plan: CleanupPlan) {
  const lines = [
    "Prévia da limpeza do catálogo fictício. Nenhum registro foi apagado.",
    `Exclusões previstas: ${plan.deletions.length}.`,
    `Registros do catálogo preservados: ${plan.kept.length}.`,
  ];

  for (const item of plan.deletions) {
    lines.push(`excluir ${item.table} ${item.id}`);
  }

  for (const item of plan.kept) {
    lines.push(`preservar ${item.table} ${item.id}`);
  }

  return lines.join("\n");
}

function userStillReferenced(snapshot: DemoSnapshot, userId: string, removedIds: Set<string>) {
  const remains = (id: string) => !removedIds.has(id);

  return (
    snapshot.projects.some((item) => remains(item.id) && item.ownerId === userId) ||
    snapshot.members.some((item) => remains(item.id) && item.userId === userId) ||
    snapshot.phases.some((item) => remains(item.id) && (item.createdBy === userId || item.updatedBy === userId)) ||
    snapshot.tasks.some(
      (item) => remains(item.id) && (item.assigneeId === userId || item.createdBy === userId || item.updatedBy === userId),
    ) ||
    snapshot.milestones.some(
      (item) =>
        remains(item.id) &&
        (item.deliveredBy === userId ||
          item.validatedBy === userId ||
          item.createdBy === userId ||
          item.updatedBy === userId),
    ) ||
    snapshot.evidences.some((item) => remains(item.id) && item.createdBy === userId) ||
    snapshot.scheduleRequests.some(
      (item) => remains(item.id) && (item.requestedBy === userId || item.reviewedBy === userId),
    ) ||
    snapshot.scheduleChanges.some((item) => remains(item.id) && item.changedBy === userId) ||
    snapshot.impediments.some((item) => remains(item.id) && item.openedBy === userId) ||
    snapshot.auditRefs.some((item) => item.actorId === userId && remains(item.projectId))
  );
}

function projectOfEvidence(
  evidence: { taskId: string | null; milestoneId: string | null; scheduleRequestId: string | null },
  catalog: DemoCatalog,
) {
  if (evidence.taskId) {
    const phaseId = catalog.tasks.find((item) => item.id === evidence.taskId)?.phaseId;
    return catalog.phases.find((item) => item.id === phaseId)?.projectId;
  }

  if (evidence.milestoneId) {
    const phaseId = catalog.milestones.find((item) => item.id === evidence.milestoneId)?.phaseId;
    return catalog.phases.find((item) => item.id === phaseId)?.projectId;
  }

  return catalog.scheduleRequests.find((item) => item.id === evidence.scheduleRequestId)?.projectId;
}

function hasMarker(value: string | null) {
  return value !== null && value.startsWith(FICTION_MARKER);
}

import "dotenv/config";

import { assessPreviewDatabase, PREVIEW_ID_PREFIX, PREVIEW_PROJECT_ID } from "./guard";

/**
 * Seed da massa fictícia do Cronograma no banco descartável gp_preview_97 (projeto demo-proj-05).
 *
 *   DATABASE_URL=postgresql://.../gp_preview_97 pnpm seed:preview            cria o que falta (idempotente)
 *   DATABASE_URL=postgresql://.../gp_preview_97 pnpm seed:preview --reset    remove só os registros prev97-* e recria
 *
 * Recusa qualquer outro banco. Não apaga nada que não tenha o prefixo prev97- e não executa migrations.
 */
async function main() {
  const assessment = assessPreviewDatabase(process.env);
  if (!assessment.ok) {
    console.error(assessment.reason);
    process.exit(1);
  }
  const reset = process.argv.includes("--reset");

  const { like, eq } = await import("drizzle-orm");
  const { db } = await import("../../db");
  const { eapAuditLogs, eapMilestoneDeliveries, eapMilestones, eapPhases, eapScheduleChanges, eapScheduleRequests, eapTasks, projects, user } = await import("../../db/schema");
  const { actors, approvedAuditOf, at, catalog } = await import("./catalog");

  console.log(`Banco: ${assessment.database} (${assessment.host})`);

  const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, PREVIEW_PROJECT_ID));
  if (!project) {
    console.error(`Projeto ${PREVIEW_PROJECT_ID} não existe neste banco; nada foi gravado.`);
    process.exit(1);
  }
  for (const userId of [actors.requester, actors.reviewer]) {
    const [found] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId));
    if (!found) {
      console.error(`Usuário fictício ${userId} não existe neste banco; nada foi gravado.`);
      process.exit(1);
    }
  }

  const counts = await db.transaction(async (tx) => {
    if (reset) {
      // Só os registros do seed; tarefas, marcos, rodadas, solicitações e alterações saem em cascata com as fases.
      await tx.delete(eapPhases).where(like(eapPhases.id, `${PREVIEW_ID_PREFIX}%`));
    }

    const phases = await tx
      .insert(eapPhases)
      .values(
        catalog.phases.map((item) => ({
          id: item.id,
          projectId: PREVIEW_PROJECT_ID,
          name: item.name,
          description: item.description,
          sortOrder: item.sortOrder,
          status: item.status,
          baselineStartAt: item.baselineStart ? at(item.baselineStart) : null,
          baselineEndAt: item.baselineEnd ? at(item.baselineEnd) : null,
          plannedStartAt: item.plannedStart ? at(item.plannedStart) : null,
          plannedEndAt: item.plannedEnd ? at(item.plannedEnd) : null,
          actualStartAt: item.actualStart ? at(item.actualStart) : null,
          actualEndAt: item.actualEnd ? at(item.actualEnd) : null,
          responsibleId: actors.requester,
          createdBy: actors.requester,
          updatedBy: actors.requester,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: eapPhases.id });

    const tasks = await tx
      .insert(eapTasks)
      .values(
        catalog.tasks.map((item) => ({
          id: item.id,
          phaseId: item.phaseId,
          title: item.title,
          description: "Registro fictício.",
          sortOrder: item.sortOrder,
          assigneeId: actors.requester,
          status: item.status,
          progressPercent: item.progressPercent,
          baselineStartAt: item.baselineStart ? at(item.baselineStart) : null,
          baselineEndAt: item.baselineEnd ? at(item.baselineEnd) : null,
          plannedStartAt: item.plannedStart ? at(item.plannedStart) : null,
          plannedEndAt: item.plannedEnd ? at(item.plannedEnd) : null,
          actualStartAt: item.actualStart ? at(item.actualStart) : null,
          actualEndAt: item.actualEnd ? at(item.actualEnd) : null,
          createdBy: actors.requester,
          updatedBy: actors.requester,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: eapTasks.id });

    const milestones = await tx
      .insert(eapMilestones)
      .values(
        catalog.milestones.map((item) => ({
          id: item.id,
          phaseId: item.phaseId,
          title: item.title,
          description: "Registro fictício.",
          sortOrder: item.sortOrder,
          type: item.type,
          status: item.status,
          baselineAt: at(item.baselineAt),
          plannedAt: at(item.plannedAt),
          actualAt: item.actualAt ? at(item.actualAt) : null,
          deliveredBy: item.status === "PENDENTE" ? null : actors.requester,
          validatedBy: item.status === "APROVADO" ? actors.reviewer : null,
          validationNote: item.validationNote ?? null,
          validatedAt: item.validatedAt ? at(item.validatedAt) : null,
          reviewerId: actors.reviewer,
          createdBy: actors.requester,
          updatedBy: actors.requester,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: eapMilestones.id });

    const deliveries = await tx
      .insert(eapMilestoneDeliveries)
      .values(
        catalog.deliveries.map((item) => ({
          id: item.id,
          milestoneId: item.milestoneId,
          round: 1,
          legacy: false,
          status: item.status,
          submittedBy: actors.requester,
          submittedAt: at(item.submittedAt),
          note: item.note,
          decidedBy: item.decidedAt ? actors.reviewer : null,
          decidedAt: item.decidedAt ? at(item.decidedAt) : null,
          decisionNote: item.decisionNote ?? null,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: eapMilestoneDeliveries.id });

    const target = (item: (typeof catalog.requests)[number]) => ({
      phaseId: "phaseId" in item.target ? item.target.phaseId : null,
      taskId: "taskId" in item.target ? item.target.taskId : null,
      milestoneId: "milestoneId" in item.target ? item.target.milestoneId : null,
    });

    const requests = await tx
      .insert(eapScheduleRequests)
      .values(
        catalog.requests.map((item) => ({
          id: item.id,
          projectId: PREVIEW_PROJECT_ID,
          ...target(item),
          field: item.field,
          baselineValue: at(item.baseline),
          expectedCurrentValue: at(item.expectedCurrent),
          proposedValue: at(item.proposed),
          justification: item.justification,
          status: item.status,
          requestedBy: actors.requester,
          requestedAt: at(item.requestedAt),
          reviewedBy: item.status === "PENDENTE" ? null : actors.reviewer,
          reviewedAt: item.reviewedAt ? at(item.reviewedAt) : null,
          decisionNote: item.status === "PENDENTE" ? null : (item.decisionNote ?? null),
        })),
      )
      .onConflictDoNothing()
      .returning({ id: eapScheduleRequests.id });

    // Solicitação aprovada é uma reprogramação efetivada: o registro da alteração guarda o valor anterior e o novo.
    const changes = await tx
      .insert(eapScheduleChanges)
      .values(
        catalog.requests
          .filter((item) => item.status === "APROVADA")
          .map((item) => ({
            id: `${item.id}-change`,
            projectId: PREVIEW_PROJECT_ID,
            requestId: item.id,
            ...target(item),
            field: item.field,
            baselineValue: at(item.baseline),
            oldValue: at(item.expectedCurrent),
            newValue: at(item.proposed),
            changedBy: actors.reviewer,
            createdAt: at(item.reviewedAt as string),
          })),
      )
      .onConflictDoNothing()
      .returning({ id: eapScheduleChanges.id });

    // Registro de auditoria de cada aprovação (SCHEDULE_CHANGE ligado à solicitação): é dele que o monitoramento conta as reprogramações.
    const audits = await tx
      .insert(eapAuditLogs)
      .values(
        catalog.requests
          .filter((item) => item.status === "APROVADA")
          .map((item) => {
            const audit = approvedAuditOf(item);
            return {
              id: audit.id,
              projectId: PREVIEW_PROJECT_ID,
              entityType: audit.entityType,
              entityId: audit.entityId,
              action: "SCHEDULE_CHANGE" as const,
              summary: audit.summary,
              payload: {
                kind: "RESCHEDULE",
                requestId: item.id,
                phaseId: audit.phaseId,
                baseline: { startAt: null, endAt: at(item.baseline).toISOString() },
                previous: { startAt: null, endAt: at(item.expectedCurrent).toISOString() },
                next: { startAt: null, endAt: at(item.proposed).toISOString() },
                sequence: 1,
                justification: item.justification,
                wasOverdue: false,
                escalatedToPmo: false,
                impacts: [],
              },
              actorId: actors.reviewer,
              createdAt: at(item.reviewedAt as string),
            };
          }),
      )
      .onConflictDoNothing()
      .returning({ id: eapAuditLogs.id });

    return { audits: audits.length, phases: phases.length, tasks: tasks.length, milestones: milestones.length, deliveries: deliveries.length, requests: requests.length, changes: changes.length };
  });

  console.log(reset ? "Registros prev97-* removidos e recriados." : "Registros que faltavam foram criados (os existentes ficam como estão).");
  console.log(counts);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

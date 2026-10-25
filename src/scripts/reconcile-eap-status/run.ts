import "dotenv/config";

import { and, eq } from "drizzle-orm";

import { db } from "../../db";
import { eapAuditLogs, eapMilestones, eapPhases, eapTasks, user } from "../../db/schema";
import {
  formatReconciliationPreview,
  planReconciliation,
  RECONCILE_CONFIRMATION,
  type ReconciliationPlan,
} from "./plan";

type QueryClient = Pick<typeof db, "select" | "insert" | "update">;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function loadPlan(client: QueryClient) {
  const [phases, tasks, milestones] = [
    await client.select().from(eapPhases),
    await client.select().from(eapTasks),
    await client.select().from(eapMilestones),
  ];
  return planReconciliation({ phases, tasks, milestones });
}

async function applyPlan(client: QueryClient, plan: ReconciliationPlan, actorId: string) {
  const now = new Date();

  for (const change of plan.tasks) {
    await client
      .update(eapTasks)
      .set({
        status: change.to,
        ...(change.markImpediment ? { hasImpediment: true } : {}),
        updatedBy: actorId,
        updatedAt: now,
      })
      .where(and(eq(eapTasks.id, change.taskId), eq(eapTasks.status, change.from)));
    await client.insert(eapAuditLogs).values({
      id: crypto.randomUUID(),
      projectId: change.projectId,
      entityType: "TASK",
      entityId: change.taskId,
      action: "STATUS_CHANGE",
      summary: `Situação da tarefa "${change.title}" reconciliada com o andamento.`,
      payload: {
        automatic: true,
        reconciliation: true,
        from: change.from,
        to: change.to,
        cause: `Andamento registrado de ${change.progressPercent}%.`,
        ...(change.markImpediment ? { hasImpediment: true } : {}),
      },
      actorId,
    });
  }

  for (const change of plan.phases) {
    await client
      .update(eapPhases)
      .set({ status: change.to, updatedBy: actorId, updatedAt: now })
      .where(and(eq(eapPhases.id, change.phaseId), eq(eapPhases.status, change.from)));
    await client.insert(eapAuditLogs).values({
      id: crypto.randomUUID(),
      projectId: change.projectId,
      entityType: "PHASE",
      entityId: change.phaseId,
      action: "STATUS_CHANGE",
      summary: `Situação da fase "${change.name}" reconciliada com os itens.`,
      payload: {
        automatic: true,
        reconciliation: true,
        from: change.from,
        to: change.to,
        cause: "Reconciliação das situações legadas da EAP.",
      },
      actorId,
    });
  }
}

async function main() {
  const confirmation = process.env.RECONCILE_EAP_CONFIRM;
  const plan = await loadPlan(db);
  console.log(formatReconciliationPreview(plan));

  if (!confirmation) {
    console.log(
      `Prévia apenas. Para aplicar, execute de novo com RECONCILE_EAP_CONFIRM=${RECONCILE_CONFIRMATION} e RECONCILE_EAP_ACTOR_EMAIL=<e-mail de ADMIN ou PMO>.`,
    );
    return;
  }
  if (confirmation !== RECONCILE_CONFIRMATION) {
    fail("Reconciliação bloqueada: a confirmação não confere. Nada foi alterado.");
  }

  const email = process.env.RECONCILE_EAP_ACTOR_EMAIL?.trim().toLowerCase();
  const [actor] = email ? await db.select().from(user).where(eq(user.email, email)) : [];
  if (!actor || (actor.role !== "ADMIN" && actor.role !== "PMO")) {
    fail("Reconciliação bloqueada: informe o e-mail de um usuário ADMIN ou PMO para a auditoria.");
  }

  const applied = await db.transaction(async (tx) => {
    const current = await loadPlan(tx);
    await applyPlan(tx, current, actor.id);
    return current;
  });
  console.log(
    `Reconciliação concluída: ${applied.tasks.length} tarefa(s) e ${applied.phases.length} fase(s), cada uma com registro no histórico.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Falha na reconciliação da EAP.");
    process.exit(1);
  });

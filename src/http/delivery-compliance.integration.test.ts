// Primeiro import: liga o modo de teste do banco (só conecta a um banco gp_test* autorizado; ver src/db/test-database-guard.ts).
import "../db/force-test-mode";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { hashPassword } from "better-auth/crypto";
import { eq, inArray, like, sql } from "drizzle-orm";

import { buildApp } from "../app";
import { db } from "../db";
import { account, session, user } from "../db/schema";

/**
 * Conformidade de Entrega ponta a ponta (HTTP + Drizzle real) no banco de testes gp_test: modelos, versões, envio e validação
 * de documentos, bloqueio de homologação e restrições do banco. Tudo o que o teste cria é removido ao final.
 */
const RUN = crypto.randomUUID().slice(0, 8);
const SUFFIX = "@delivery-compliance.test";
const PASSWORD = "Ficticio@Dc20";
const FRONT_ORIGIN = "http://localhost:3001";
const people = {
  pmo: { id: `dc-pmo-${RUN}`, role: "PMO", name: "PMO Fictício" },
  owner: { id: `dc-owner-${RUN}`, role: "GESTOR", name: "Gestor Fictício" },
  supplier: { id: `dc-forn-${RUN}`, role: "FORNECEDOR", name: "Fornecedor Fictício" },
  tech: { id: `dc-tec-${RUN}`, role: "COLABORADOR", name: "Técnico Fictício" },
  dev: { id: `dc-dev-${RUN}`, role: "COLABORADOR", name: "Desenvolvedor Fictício" },
} as const;
type Who = keyof typeof people;

const cookies: Partial<Record<Who, string>> = {};
let app: Awaited<ReturnType<typeof buildApp>>;
let projectId = "";
let phaseId = "";
let milestoneId = "";
let taskId = "";
let versionId = "";

async function call(who: Who | null, method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: unknown) {
  const response = await app.inject({
    method,
    url,
    headers: { ...(who ? { cookie: cookies[who] as string } : {}), ...(payload ? { "content-type": "application/json" } : {}) },
    ...(payload ? { payload: JSON.stringify(payload) } : {}),
  });
  return { status: response.statusCode, body: response.body ? (JSON.parse(response.body) as Record<string, any>) : {} }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function cleanup() {
  const versions = projectId ? await db.execute(sql`select id from project_delivery_versions where project_id = ${projectId}`) : { rows: [] };
  const versionIds = (versions.rows as Array<{ id: string }>).map((row) => row.id);
  if (versionIds.length > 0) {
    await db.execute(sql`delete from project_delivery_item_events where item_id in (select id from project_delivery_version_items where version_id in (${sql.join(versionIds.map((id) => sql`${id}`), sql`, `)}))`);
    await db.execute(sql`delete from eap_milestone_deliveries where delivery_version_id in (${sql.join(versionIds.map((id) => sql`${id}`), sql`, `)})`);
    await db.execute(sql`delete from project_delivery_version_items where version_id in (${sql.join(versionIds.map((id) => sql`${id}`), sql`, `)})`);
    await db.execute(sql`delete from project_delivery_versions where id in (${sql.join(versionIds.map((id) => sql`${id}`), sql`, `)})`);
  }
  if (projectId) {
    await db.execute(sql`delete from eap_milestone_deliveries where milestone_id in (select m.id from eap_milestones m join eap_phases p on p.id = m.phase_id where p.project_id = ${projectId})`);
    await db.execute(sql`delete from projects where id = ${projectId}`);
  }
  // Revisões publicadas pelo teste (a revisão 1 semeada permanece).
  await db.execute(sql`delete from delivery_checklist_template_items where revision_id in (select id from delivery_checklist_template_revisions where created_by like ${`dc-%-${RUN}`})`);
  await db.execute(sql`delete from delivery_checklist_template_revisions where created_by like ${`dc-%-${RUN}`}`);
  const ids = Object.values(people).map((person) => person.id);
  await db.delete(session).where(inArray(session.userId, ids));
  await db.delete(account).where(inArray(account.userId, ids));
  await db.delete(user).where(like(user.email, `%${SUFFIX}`));
}

describe("Conformidade de Entrega: integração HTTP + banco de testes", () => {
  before(async () => {
    const password = await hashPassword(PASSWORD);
    for (const [key, person] of Object.entries(people)) {
      await db.insert(user).values({ id: person.id, name: person.name, email: `${key}-${RUN}${SUFFIX}`, emailVerified: true, role: person.role });
      await db.insert(account).values({ id: `acc-${person.id}`, accountId: person.id, providerId: "credential", userId: person.id, password });
    }
    app = await buildApp();
    await app.ready();
    for (const key of Object.keys(people) as Who[]) {
      const login = await app.inject({
        method: "POST",
        url: "/api/auth/sign-in/email",
        headers: { origin: FRONT_ORIGIN, "content-type": "application/json" },
        payload: JSON.stringify({ email: `${key}-${RUN}${SUFFIX}`, password: PASSWORD }),
      });
      assert.equal(login.statusCode, 200, `login de ${key}`);
      cookies[key] = String(login.headers["set-cookie"]).split(";")[0];
    }
  });

  after(async () => {
    try {
      await cleanup();
    } finally {
      await app.close();
    }
  });

  it("prepara projeto com fornecedor, fase e marco de homologação pela API", async () => {
    const project = await call("pmo", "POST", "/projects", { name: `Projeto DC ${RUN}`, ownerId: people.owner.id });
    assert.equal(project.status, 201, JSON.stringify(project.body));
    projectId = project.body.id;
    for (const [who, role] of [["supplier", "FORNECEDOR"], ["tech", "RESPONSAVEL_TECNICO"], ["dev", "DESENVOLVEDOR"]] as const) {
      const member = await call("pmo", "POST", `/projects/${projectId}/members`, { userId: people[who].id, role });
      assert.equal(member.status, 201, `${who}: ${JSON.stringify(member.body)}`);
    }
    const phase = await call("pmo", "POST", `/projects/${projectId}/phases`, { name: "Entrega", responsibleId: people.tech.id });
    assert.equal(phase.status, 201, JSON.stringify(phase.body));
    phaseId = phase.body.id;
    const milestone = await call("pmo", "POST", `/projects/${projectId}/phases/${phaseId}/milestones`, {
      title: "Homologação final",
      description: "Marco final de homologação.",
      type: "HOMOLOGACAO",
      plannedAt: "2030-11-10T15:00:00.000Z",
      reviewerId: people.tech.id,
      presenterId: people.dev.id,
    });
    assert.equal(milestone.status, 201, JSON.stringify(milestone.body));
    milestoneId = milestone.body.id;

    // A fase precisa de uma tarefa concluída com datas reais para que o aceite do marco conclua a fase (regra do rollup existente).
    const task = await call("pmo", "POST", `/projects/${projectId}/phases/${phaseId}/tasks`, {
      title: "Implantação",
      assigneeId: people.dev.id,
      plannedStartAt: "2026-06-01T15:00:00.000Z",
      plannedEndAt: "2026-06-30T15:00:00.000Z",
    });
    assert.equal(task.status, 201, JSON.stringify(task.body));
    taskId = task.body.id;
  });

  it("modelos: qualquer usuário consulta; só ADMIN/PMO criam rascunho e publicam; a revisão publicada é imutável", async () => {
    const asSupplier = await call("supplier", "GET", "/delivery-checklist-templates");
    assert.equal(asSupplier.status, 200);
    assert.deepEqual(asSupplier.body.data.map((template: { nature: string }) => template.nature).sort(), ["INFRAESTRUTURA", "PROCESSOS", "SISTEMAS"]);
    const sistemas = asSupplier.body.data.find((template: { nature: string }) => template.nature === "SISTEMAS");
    assert.equal(sistemas.published.revision, 1);
    assert.equal(sistemas.published.isProposal, false);
    assert.equal(asSupplier.body.data.find((template: { nature: string }) => template.nature === "INFRAESTRUTURA").published.isProposal, true);
    assert.equal(sistemas.draft, null);

    const items = [
      { documentType: "ESCOPO_CRITERIOS", title: "Escopo e critérios de aceite", required: true },
      { documentType: "PLANO_TESTES", title: "Plano de testes", required: true },
      { documentType: "MANUAL", title: "Manual de uso", required: false },
    ];
    assert.equal((await call("owner", "PUT", "/delivery-checklist-templates/SISTEMAS/draft", { items })).status, 403);
    assert.equal((await call("supplier", "POST", "/delivery-checklist-templates/SISTEMAS/draft/publish")).status, 403);
    assert.equal((await call("pmo", "PUT", "/delivery-checklist-templates/SISTEMAS/draft", { items: [{ documentType: "minúsculo", title: "x", required: true }] })).status, 400);

    const draft = await call("pmo", "PUT", "/delivery-checklist-templates/SISTEMAS/draft", { items, notes: "Teste de integração." });
    assert.equal(draft.status, 200, JSON.stringify(draft.body));
    assert.equal(draft.body.status, "RASCUNHO");
    const published = await call("pmo", "POST", "/delivery-checklist-templates/SISTEMAS/draft/publish");
    assert.equal(published.status, 200, JSON.stringify(published.body));
    assert.equal(published.body.revision, 2);

    const rev1 = await db.execute(sql`select count(*)::int n from delivery_checklist_template_items where revision_id = 'rev-sistemas-1'`);
    assert.equal((rev1.rows[0] as { n: number }).n, 9, "a revisão 1 publicada continua com os 9 itens semeados");
  });

  it("versão 1.0 copia os itens da revisão publicada; rótulo duplicado, papel sem permissão e formato inválido são recusados", async () => {
    assert.equal((await call("pmo", "POST", `/projects/${projectId}/delivery-versions`, { versionLabel: "1.0", nature: "SISTEMAS" })).status, 403);
    assert.equal((await call("supplier", "POST", `/projects/${projectId}/delivery-versions`, { versionLabel: "v1", nature: "SISTEMAS" })).status, 400);
    const created = await call("supplier", "POST", `/projects/${projectId}/delivery-versions`, { versionLabel: "1.0", nature: "SISTEMAS", notes: "Primeira entrega." });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    versionId = created.body.id;
    assert.equal(created.body.templateRevision, 2);
    assert.equal(created.body.items.length, 3);
    assert.equal(created.body.conformity.required, 2);
    assert.equal(created.body.conformity.conforming, false);
    assert.equal((await call("supplier", "POST", `/projects/${projectId}/delivery-versions`, { versionLabel: "1.0", nature: "SISTEMAS" })).status, 409);

    const listed = await call("pmo", "GET", `/projects/${projectId}/delivery-versions`);
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.summary, { versions: 1, conforming: 0, nonConforming: 1, hasSupplier: true });

    // Revisão 3 publicada depois não altera a versão 1.0 existente.
    await call("pmo", "PUT", "/delivery-checklist-templates/SISTEMAS/draft", { items: [{ documentType: "SO_UM", title: "Único documento", required: true }] });
    await call("pmo", "POST", "/delivery-checklist-templates/SISTEMAS/draft/publish");
    const reread = await call("supplier", "GET", `/projects/${projectId}/delivery-versions/${versionId}`);
    assert.equal(reread.body.items.length, 3);
    assert.equal(reread.body.templateRevision, 2);
  });

  it("envio e validação: link obrigatório, sem autoaprovação, histórico e restrições do banco", async () => {
    const version = (await call("supplier", "GET", `/projects/${projectId}/delivery-versions/${versionId}`)).body;
    const [escopo, plano, manual] = version.items;
    const base = `/projects/${projectId}/delivery-versions/${versionId}/items`;

    assert.equal((await call("supplier", "POST", `${base}/${escopo.id}/submit`, { evidenceKind: "SHAREPOINT", evidenceRef: "arquivo.pdf" })).status, 400);
    assert.equal((await call("pmo", "POST", `${base}/${escopo.id}/submit`, { evidenceKind: "SHAREPOINT", evidenceRef: "https://igepps.sharepoint.com/escopo" })).status, 403);

    const sent = await call("supplier", "POST", `${base}/${escopo.id}/submit`, { evidenceKind: "SHAREPOINT", evidenceRef: "https://igepps.sharepoint.com/escopo" });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal(sent.body.items[0].status, "ENVIADO");

    // Quem enviou não valida; só o responsável técnico designado valida.
    assert.equal((await call("supplier", "POST", `${base}/${escopo.id}/approve`, {})).status, 403);
    assert.equal((await call("owner", "POST", `${base}/${escopo.id}/approve`, {})).status, 403);
    assert.equal((await call("tech", "POST", `${base}/${escopo.id}/reject`, { note: "curta" })).status, 400);
    const rejected = await call("tech", "POST", `${base}/${escopo.id}/reject`, { note: "O escopo não cobre os requisitos aprovados." });
    assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
    assert.equal(rejected.body.items[0].status, "REJEITADO");
    assert.equal((await call("tech", "POST", `${base}/${escopo.id}/approve`, {})).status, 409, "só documento ENVIADO é decidido");

    await call("supplier", "POST", `${base}/${escopo.id}/submit`, { evidenceKind: "GITLAB_TAG", evidenceRef: "v1.0.0" });
    const approved = await call("tech", "POST", `${base}/${escopo.id}/approve`, {});
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.items[0].status, "APROVADO");

    const events = await call("pmo", "GET", `${base}/${escopo.id}/events`);
    assert.deepEqual(events.body.data.map((event: { action: string }) => event.action), ["ENVIO", "REJEICAO", "ENVIO", "APROVACAO"]);
    assert.equal(events.body.data[0].actor.name, people.supplier.name);

    assert.equal((await call("owner", "POST", `${base}/${plano.id}/waive`, { note: "Plano substituído por evidência de testes." })).status, 403);
    const waived = await call("pmo", "POST", `${base}/${plano.id}/waive`, { note: "Plano substituído por evidência de testes." });
    assert.equal(waived.status, 200, JSON.stringify(waived.body));
    assert.equal(waived.body.items[1].status, "DISPENSADO");
    assert.equal(waived.body.conformity.conforming, true, "obrigatórios aprovados ou dispensados; o opcional pendente não bloqueia");
    assert.equal(manual.required, false);

    // Restrições do próprio banco: autoaprovação e alteração do histórico não passam, mesmo fora da API.
    await assert.rejects(
      () => db.execute(sql`update project_delivery_version_items set decided_by = submitted_by where id = ${escopo.id}`),
      (error: unknown) => /project_delivery_version_items_decision_chk|violates check constraint/.test(String((error as { cause?: { message?: string } }).cause?.message ?? (error as Error).message)),
    );
    const untouched = await db.execute(sql`select status, decided_by from project_delivery_version_items where id = ${escopo.id}`);
    assert.deepEqual(untouched.rows, [{ status: "APROVADO", decided_by: people.tech.id }]);
  });

  it("homologação do marco final: bloqueada com documento obrigatório pendente e liberada com a versão conforme; a rodada registra a versão", async () => {
    const lib = `/projects/${projectId}/phases/${phaseId}/milestones/${milestoneId}`;
    // Nova versão evolutiva (revisão publicada mais recente, com 1 documento obrigatório) ainda não conforme.
    const second = await call("dev", "POST", `/projects/${projectId}/delivery-versions`, { versionLabel: "1.1", nature: "SISTEMAS" });
    assert.equal(second.status, 201, JSON.stringify(second.body));

    const deliver = await call("supplier", "POST", `${lib}/deliver`, {});
    assert.equal(deliver.status, 200, JSON.stringify(deliver.body));
    const blocked = await call("pmo", "POST", `${lib}/review`, { decision: "APROVADO" });
    assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
    assert.equal(blocked.body.code, "DELIVERY_NOT_CONFORMING");

    const rounds = await call("pmo", "GET", `${lib}/deliveries`);
    assert.equal(rounds.body.data[0].status, "EM_ANALISE", "a recusa não decide a rodada");
    assert.equal(rounds.body.data[0].deliveryVersionId, second.body.id, "na homologação, sem versão informada vale a mais recente");

    // Tarefa concluída (datas reais no passado) para a fase poder ser concluída pelo aceite do marco.
    const progress = await call("dev", "PATCH", `/projects/${projectId}/phases/${phaseId}/tasks/${taskId}/progress`, {
      progressPercent: 100,
      actualStartAt: "2026-06-02T15:00:00.000Z",
      actualEndAt: "2026-06-20T15:00:00.000Z",
    });
    assert.equal(progress.status, 200, JSON.stringify(progress.body));

    // Conclui o checklist da versão 1.1 e homologa.
    const only = second.body.items[0];
    const base = `/projects/${projectId}/delivery-versions/${second.body.id}/items/${only.id}`;
    assert.equal((await call("supplier", "POST", `${base}/submit`, { evidenceKind: "SHAREPOINT", evidenceRef: "https://igepps.sharepoint.com/unico" })).status, 200);
    assert.equal((await call("tech", "POST", `${base}/approve`, {})).status, 200);

    const homologated = await call("pmo", "POST", `${lib}/review`, { decision: "APROVADO" });
    assert.equal(homologated.status, 200, JSON.stringify(homologated.body));
    assert.equal(homologated.body.status, "APROVADO");

    const check = await db.execute(sql`select delivery_version_id, status from eap_milestone_deliveries where milestone_id = ${milestoneId}`);
    assert.deepEqual(check.rows, [{ delivery_version_id: second.body.id, status: "ACEITA" }]);

    // A versão 1.0 conforme continua conforme; o encerramento depende de todas as versões conformes.
    const versions = await call("pmo", "GET", `/projects/${projectId}/delivery-versions`);
    assert.deepEqual(versions.body.summary, { versions: 2, conforming: 2, nonConforming: 0, hasSupplier: true });
    assert.equal(versions.body.data.find((version: { versionLabel: string }) => version.versionLabel === "1.1").rounds, 1);
  });

  it("os dados reais do banco de testes não foram tocados fora do que o teste criou", async () => {
    const seed = await db.execute(sql`select (select count(*)::int from delivery_checklist_templates) t, (select count(*)::int from delivery_checklist_template_items where revision_id = 'rev-sistemas-1') i`);
    assert.deepEqual(seed.rows[0], { t: 3, i: 9 });
    const mine = await db.select({ id: user.id }).from(user).where(eq(user.id, people.pmo.id));
    assert.equal(mine.length, 1);
  });
});

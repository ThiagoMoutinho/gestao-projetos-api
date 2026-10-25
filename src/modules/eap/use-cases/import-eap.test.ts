import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import type { EapImportRow } from "../dtos/eap-import.dto";
import {
  createEapInMemoryStore,
  makeEapInMemoryRepos,
  makeEapInMemoryTransactionRunner,
  makeMember,
  makeProject,
  makeUser,
} from "../test/in-memory";
import { makeCreatePhaseUseCase } from "./create-phase";
import { makeImportEapUseCase, parseImportDate } from "./import-eap";

function actor(role: AuthUser["role"], id: string): AuthUser {
  return { id, name: id, email: `${id}@igepps.test`, role };
}

const pmo = actor("PMO", "pmo-1");
const observer = actor("COLABORADOR", "obs-1");

async function setup() {
  const store = createEapInMemoryStore({
    users: [
      makeUser({ id: "pmo-1", role: "PMO", name: "Ana PMO" }),
      makeUser({ id: "forn-1", role: "FORNECEDOR", name: "Fornecedor Um" }),
      makeUser({ id: "obs-1", role: "COLABORADOR", name: "Gestora Obs" }),
    ],
    projects: [makeProject({ id: "project-1", ownerId: "owner-1" })],
    members: [
      makeMember({ id: "m-forn", projectId: "project-1", userId: "forn-1", role: "FORNECEDOR" }),
      makeMember({ id: "m-obs", projectId: "project-1", userId: "obs-1", role: "OBSERVADOR" }),
    ],
  });
  const repos = makeEapInMemoryRepos(store);
  const deps = { repos, runInTransaction: makeEapInMemoryTransactionRunner(repos, store) };
  return { store, deps, importEap: makeImportEapUseCase(deps) };
}

let line = 1;
function row(values: Partial<EapImportRow> & Pick<EapImportRow, "code" | "kind" | "name">): EapImportRow {
  line += 1;
  return { line, ...values };
}

function validRows() {
  line = 1;
  return [
    row({ code: "1", kind: "Fase", name: "Planejamento", responsible: "obs-1@igepps.test", plannedStart: "01/06/2026", plannedEnd: "30/06/2026", completionCriteria: "Plano aprovado" }),
    row({ code: "1.1", kind: "Tarefa", name: "Levantamento", responsible: "Fornecedor Um", plannedStart: "01/06/2026", plannedEnd: "12/06/2026" }),
    row({ code: "1.2", kind: "Marco", name: "Aprovação do plano", responsible: "forn-1@igepps.test", reviewer: "obs-1@igepps.test", milestoneType: "Aprovação", plannedEnd: "2026-06-30" }),
    row({ code: "2", kind: "fase", name: "Execução", responsible: "obs-1@igepps.test", plannedStart: "01/07/2026", plannedEnd: "31/07/2026" }),
    row({ code: "2.1", kind: "TAREFA", name: "Sem datas ainda" }),
  ];
}

const day = (value: string) => `${value}T15:00:00.000Z`;
const notEmpty = (error: unknown) => error instanceof HttpError && error.code === "EAP_IMPORT_PROJECT_NOT_EMPTY";

describe("Importação inicial de EAP por planilha", () => {
  it("pré-visualiza com o planejamento das fases informado na planilha e o consolidado à parte, sem gravar", async () => {
    const ctx = await setup();

    const result = await ctx.importEap(pmo, "project-1", { rows: validRows(), confirm: false });

    assert.equal(result.valid, true);
    assert.equal(result.committed, false);
    assert.deepEqual(result.summary, { phases: 2, tasks: 2, milestones: 1 });
    assert.deepEqual(result.items.map((item) => item.finalCode), ["1", "1.1", "1.2", "2", "2.1"]);
    const [phase] = result.items;
    assert.deepEqual([phase.plannedStartAt, phase.plannedEndAt], [day("2026-06-01"), day("2026-06-30")]);
    assert.deepEqual([phase.consolidatedStartAt, phase.consolidatedEndAt], [day("2026-06-01"), day("2026-06-30")]);
    assert.deepEqual(result.warnings, []);
    assert.equal(ctx.store.phases.length, 0);
    assert.equal(ctx.store.auditLogs.length, 0);
  });

  it("itens fora do período da fase geram aviso, sem alterar o planejamento informado", async () => {
    const ctx = await setup();
    const rows = validRows();
    rows[2] = { ...rows[2], plannedEnd: "10/07/2026" };

    const result = await ctx.importEap(pmo, "project-1", { rows, confirm: true });

    assert.equal(result.committed, true);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].line, 2);
    const phase = ctx.store.phases.find((item) => item.name === "Planejamento")!;
    assert.equal(phase.plannedEndAt?.toISOString(), day("2026-06-30"));
    assert.equal(phase.baselineEndAt?.toISOString(), day("2026-06-30"));
  });

  it("aponta os erros por linha e não grava quando há erros, mesmo com confirmação", async () => {
    const ctx = await setup();
    line = 1;
    const rows = [
      row({ code: "1", kind: "Fase", name: "Sem datas", responsible: "obs-1@igepps.test" }),
      row({ code: "1.1", kind: "Tarefa", name: "Datas invertidas", plannedStart: "10/06/2026", plannedEnd: "01/06/2026" }),
      row({ code: "1.1", kind: "Tarefa", name: "Código repetido" }),
      row({ code: "3.1", kind: "Marco", name: "Sem fase", plannedEnd: "01/07/2026" }),
      row({ code: "1.2", kind: "Marco", name: "Mesma pessoa", responsible: "obs-1@igepps.test", reviewer: "obs-1@igepps.test", plannedEnd: "31/02/2026" }),
      row({ code: "1.3", kind: "Tarefa", name: "Desconhecido", responsible: "ninguem@igepps.test" }),
      row({ code: "1.4", kind: "Entrega", name: "Tipo errado" }),
      row({ code: "1.5", kind: "Marco", name: "Fornecedor valida", responsible: "obs-1@igepps.test", reviewer: "forn-1@igepps.test", plannedStart: "01/06/2026", plannedEnd: "20/06/2026" }),
      row({ code: "1.6", kind: "Tarefa", name: "Coluna de marco", reviewer: "obs-1@igepps.test" }),
    ];

    const result = await ctx.importEap(pmo, "project-1", { rows, confirm: true });

    assert.equal(result.valid, false);
    assert.equal(result.committed, false);
    const byLine = (target: number) => result.errors.filter((error) => error.line === target).map((error) => error.field);
    assert.deepEqual(byLine(2), ["Início planejado"]);
    assert.deepEqual(byLine(3), ["Término planejado"]);
    assert.deepEqual(byLine(4), ["Código EAP"]);
    assert.deepEqual(byLine(5), ["Código EAP"]);
    assert.ok(byLine(6).includes("Término planejado"));
    assert.ok(byLine(6).includes("Gestor validador"));
    assert.deepEqual(byLine(7), ["Responsável"]);
    assert.deepEqual(byLine(8), ["Tipo"]);
    assert.deepEqual(byLine(9).sort(), ["Gestor validador", "Início planejado"]);
    assert.deepEqual(byLine(10), ["Gestor validador"]);
    assert.equal(ctx.store.phases.length, 0);
  });

  it("com confirmação grava tudo numa transação, com o planejamento da planilha, e registra a importação", async () => {
    const ctx = await setup();

    const result = await ctx.importEap(pmo, "project-1", { fileName: "eap.xlsx", rows: validRows(), confirm: true });

    assert.equal(result.committed, true);
    assert.equal(ctx.store.phases.length, 2);
    const imported = ctx.store.phases.find((phase) => phase.name === "Planejamento")!;
    assert.deepEqual([imported.sortOrder, imported.responsibleId], [0, "obs-1"]);
    assert.equal(imported.plannedStartAt?.toISOString(), day("2026-06-01"));
    assert.equal(imported.baselineEndAt?.toISOString(), day("2026-06-30"));
    const execution = ctx.store.phases.find((phase) => phase.name === "Execução")!;
    assert.equal(execution.plannedEndAt?.toISOString(), day("2026-07-31"));
    const milestone = ctx.store.milestones.find((item) => item.phaseId === imported.id)!;
    assert.deepEqual([milestone.type, milestone.presenterId, milestone.reviewerId, milestone.status], ["APROVACAO", "forn-1", "obs-1", "PENDENTE"]);
    const task = ctx.store.tasks.find((item) => item.phaseId === imported.id)!;
    assert.deepEqual([task.assigneeId, task.sortOrder, milestone.sortOrder], ["forn-1", 0, 1]);
    const entry = ctx.store.auditLogs.findLast((log) => log.entityType === "PROJECT");
    assert.deepEqual(
      [(entry?.payload as { kind: string }).kind, (entry?.payload as { fileName: string }).fileName],
      ["EAP_IMPORT", "eap.xlsx"],
    );
  });

  it("só é permitida em projeto sem itens na EAP: sem importação incremental", async () => {
    const ctx = await setup();
    await makeCreatePhaseUseCase(ctx.deps)(pmo, "project-1", { name: "Existente", responsibleId: "obs-1" });
    const before = ctx.store.phases.length;

    await assert.rejects(() => ctx.importEap(pmo, "project-1", { rows: validRows(), confirm: false }), notEmpty);
    await assert.rejects(() => ctx.importEap(pmo, "project-1", { rows: validRows(), confirm: true }), notEmpty);
    assert.equal(ctx.store.phases.length, before);
  });

  it("exige permissão de criar itens na EAP", async () => {
    const ctx = await setup();
    await assert.rejects(
      () => ctx.importEap(observer, "project-1", { rows: validRows(), confirm: true }),
      (error: unknown) => error instanceof HttpError && error.code === "EAP_CREATE_FORBIDDEN",
    );
    assert.equal(ctx.store.phases.length, 0);
  });

  it("aceita datas dd/mm/aaaa e aaaa-mm-dd e rejeita datas inexistentes", () => {
    assert.equal((parseImportDate("05/06/2026") as Date).toISOString(), day("2026-06-05"));
    assert.equal((parseImportDate("2026-06-05") as Date).toISOString(), day("2026-06-05"));
    assert.equal(parseImportDate("31/02/2026"), "invalid");
    assert.equal(parseImportDate(""), null);
  });
});

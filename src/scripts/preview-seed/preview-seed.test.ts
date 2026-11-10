import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { catalog } from "./catalog";
import { assessPreviewDatabase, PREVIEW_ID_PREFIX } from "./guard";

describe("seed de prévia: trava de segurança", () => {
  const url = (name: string, host = "localhost") => ({ DATABASE_URL: `postgresql://u:p@${host}:5432/${name}` });

  it("só aceita o banco gp_preview_97 em localhost", () => {
    assert.equal(assessPreviewDatabase(url("gp_preview_97")).ok, true);
    for (const name of ["gestao-projetos", "gp_iso_preview", "gp_test", "gp_preview_97_x", ""]) {
      assert.equal(assessPreviewDatabase(url(name)).ok, false, name);
    }
    assert.equal(assessPreviewDatabase(url("gp_preview_97", "db.exemplo.com")).ok, false);
    assert.equal(assessPreviewDatabase({ ...url("gp_preview_97"), NODE_ENV: "production" }).ok, false);
    assert.equal(assessPreviewDatabase({}).ok, false);
  });
});

describe("seed de prévia: coerência da massa", () => {
  const phaseIds = new Set(catalog.phases.map((item) => item.id));
  const day = (value: string | undefined) => value ?? null;

  it("todo registro tem o prefixo do seed, ids únicos e vínculos existentes", () => {
    const all = [...catalog.phases, ...catalog.tasks, ...catalog.milestones, ...catalog.deliveries, ...catalog.requests].map((item) => item.id);
    assert.equal(new Set(all).size, all.length);
    assert.ok(all.every((value) => value.startsWith(PREVIEW_ID_PREFIX)));
    assert.ok(catalog.tasks.every((item) => phaseIds.has(item.phaseId)));
    assert.ok(catalog.milestones.every((item) => phaseIds.has(item.phaseId)));
    const milestoneIds = new Set(catalog.milestones.map((item) => item.id));
    assert.ok(catalog.deliveries.every((item) => milestoneIds.has(item.milestoneId)));
    const taskIds = new Set(catalog.tasks.map((item) => item.id));
    for (const request of catalog.requests) {
      const target = request.target;
      if ("phaseId" in target) assert.ok(phaseIds.has(target.phaseId));
      if ("taskId" in target) assert.ok(taskIds.has(target.taskId));
      if ("milestoneId" in target) assert.ok(milestoneIds.has(target.milestoneId));
    }
  });

  it("quatro fases em situações diferentes: concluída, em andamento, atrasada e não iniciada", () => {
    const today = "2026-11-09";
    const kind = (phase: (typeof catalog.phases)[number]) =>
      phase.status === "CONCLUIDA" ? "concluida" : phase.status === "NAO_INICIADA" ? "nao-iniciada" : (phase.plannedEnd ?? "") < today ? "atrasada" : "andamento";
    assert.deepEqual(catalog.phases.map(kind).sort(), ["andamento", "atrasada", "concluida", "nao-iniciada"]);
  });

  it("datas e progresso coerentes: fim >= início, concluída com 100% e datas reais, sem real no que não começou", () => {
    for (const item of [...catalog.phases, ...catalog.tasks]) {
      for (const [start, end] of [[item.baselineStart, item.baselineEnd], [item.plannedStart, item.plannedEnd], [item.actualStart, item.actualEnd]] as const) {
        if (start && end) assert.ok(end >= start, item.id);
      }
      if (item.actualEnd) assert.ok(item.actualStart, `${item.id}: fim real exige início real`);
      if ("progressPercent" in item) {
        if (item.status === "CONCLUIDA") assert.equal(item.progressPercent, 100, item.id);
        if (item.status === "NAO_INICIADA") assert.ok(item.progressPercent === 0 && !item.actualStart, item.id);
        if (item.status === "EM_ANDAMENTO") assert.ok(item.progressPercent > 0 && item.progressPercent < 100, item.id);
      }
    }
  });

  it("prazo vigente diferente da linha de base só existe com uma reprogramação aprovada que leva ao valor vigente", () => {
    const approved = catalog.requests.filter((request) => request.status === "APROVADA");
    const withTarget = (kind: "phaseId" | "taskId" | "milestoneId", id: string) => approved.filter((request) => kind in request.target && (request.target as Record<string, string>)[kind] === id);
    for (const item of catalog.phases) {
      if (item.plannedEnd !== item.baselineEnd) assert.ok(withTarget("phaseId", item.id).some((r) => r.proposed === item.plannedEnd && r.baseline === day(item.baselineEnd)), item.id);
    }
    for (const item of catalog.tasks) {
      if (item.plannedEnd !== item.baselineEnd) assert.ok(withTarget("taskId", item.id).some((r) => r.proposed === item.plannedEnd && r.baseline === day(item.baselineEnd)), item.id);
    }
    for (const item of catalog.milestones) {
      if (item.plannedAt !== item.baselineAt) assert.ok(withTarget("milestoneId", item.id).some((r) => r.proposed === item.plannedAt && r.baseline === item.baselineAt), item.id);
    }
  });

  it("marcos aprovados e pendentes, rodadas coerentes e solicitações aprovadas, rejeitada e ao menos duas pendentes", () => {
    assert.ok(catalog.milestones.some((item) => item.status === "APROVADO") && catalog.milestones.some((item) => item.status === "PENDENTE"));
    for (const delivery of catalog.deliveries) {
      assert.equal(delivery.status === "ACEITA", Boolean(delivery.decidedAt), delivery.id);
    }
    const count = (status: string) => catalog.requests.filter((request) => request.status === status).length;
    assert.ok(count("APROVADA") >= 1 && count("REJEITADA") >= 1 && count("PENDENTE") >= 2);
    for (const request of catalog.requests) {
      assert.ok(request.justification.trim().length >= 10);
      if (request.status === "REJEITADA") assert.ok((request.decisionNote ?? "").trim().length >= 10);
      if (request.status === "PENDENTE") assert.ok(!request.reviewedAt && !request.decisionNote);
    }
    // No máximo uma solicitação pendente por objeto e campo (restrição do banco).
    const pending = catalog.requests.filter((request) => request.status === "PENDENTE").map((request) => JSON.stringify([request.target, request.field]));
    assert.equal(new Set(pending).size, pending.length);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthUser } from "../../lib/session";
import type { OverviewLayoutRepository } from "./overview-layout.repository";
import { overviewLayoutBodySchema, type OverviewWidget } from "./overview-layout.schema";
import { makeOverviewLayoutUseCases } from "./overview-layout.use-cases";

function memoryRepo(): OverviewLayoutRepository {
  const rows = new Map<string, OverviewWidget[]>();
  return {
    async find(userId) {
      return rows.get(userId) ?? null;
    },
    async save(userId, widgets) {
      rows.set(userId, widgets);
    },
    async remove(userId) {
      rows.delete(userId);
    },
  };
}

const user = (id: string) => ({ id }) as AuthUser;
const layout: OverviewWidget[] = [
  { id: "marcos", wide: true },
  { id: "sobre", wide: false },
];

describe("Layout pessoal da Visão Geral", () => {
  it("começa sem layout (padrão), salva, relê e restaura", async () => {
    const useCases = makeOverviewLayoutUseCases(memoryRepo());
    assert.deepEqual(await useCases.get(user("u1")), { widgets: null });
    assert.deepEqual(await useCases.save(user("u1"), layout), { widgets: layout });
    assert.deepEqual((await useCases.get(user("u1"))).widgets, layout);
    assert.deepEqual(await useCases.reset(user("u1")), { widgets: null });
    assert.deepEqual(await useCases.get(user("u1")), { widgets: null });
  });

  it("cada usuário só enxerga e altera o próprio layout", async () => {
    const useCases = makeOverviewLayoutUseCases(memoryRepo());
    await useCases.save(user("u1"), layout);
    assert.deepEqual(await useCases.get(user("u2")), { widgets: null });
    await useCases.save(user("u2"), [{ id: "resumo", wide: true }]);
    assert.deepEqual((await useCases.get(user("u1"))).widgets, layout);
    await useCases.reset(user("u2"));
    assert.deepEqual((await useCases.get(user("u1"))).widgets, layout);
  });

  it("guarda a altura junto à largura e à posição; layouts antigos sem altura continuam válidos", async () => {
    const useCases = makeOverviewLayoutUseCases(memoryRepo());
    const withHeight: OverviewWidget[] = [
      { id: "marcos", wide: true, height: "alta" },
      { id: "sobre", wide: false, height: "compacta" },
      { id: "resumo", wide: true },
    ];
    assert.deepEqual((await useCases.save(user("u1"), withHeight)).widgets, withHeight);
    assert.deepEqual((await useCases.get(user("u1"))).widgets, withHeight);
    assert.equal(overviewLayoutBodySchema.safeParse({ widgets: layout }).success, true);
    assert.deepEqual(overviewLayoutBodySchema.parse({ widgets: withHeight }).widgets, withHeight);
  });

  it("recusa altura desconhecida e mantém as quatro permitidas", () => {
    for (const height of ["auto", "compacta", "media", "alta"]) {
      assert.equal(overviewLayoutBodySchema.safeParse({ widgets: [{ id: "sobre", wide: false, height }] }).success, true, height);
    }
    assert.equal(overviewLayoutBodySchema.safeParse({ widgets: [{ id: "sobre", wide: false, height: "gigante" }] }).success, false);
    assert.equal(overviewLayoutBodySchema.safeParse({ widgets: [{ id: "sobre", wide: false, height: 280 }] }).success, false);
  });

  it("valida o corpo: só ids conhecidos, sem repetição e sem campos extras", () => {
    assert.equal(overviewLayoutBodySchema.safeParse({ widgets: layout }).success, true);
    assert.equal(overviewLayoutBodySchema.safeParse({ widgets: [{ id: "x", wide: false }] }).success, false);
    assert.equal(overviewLayoutBodySchema.safeParse({ widgets: [layout[0], layout[0]] }).success, false);
    assert.equal(overviewLayoutBodySchema.safeParse({ widgets: [] }).success, false);
    assert.equal(overviewLayoutBodySchema.safeParse({ widgets: layout, extra: 1 }).success, false);
  });
});

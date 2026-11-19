import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthUser } from "../../lib/session";
import type { SearchInput, SearchRepository } from "./search.repository";
import { searchQuerySchema, type SearchResult } from "./search.schema";
import { makeSearchUseCases } from "./search.use-cases";
import { escapeLike, excerpt, foldText, likePattern, MAX_WORDS, searchWords } from "./search.text";

const user = (id: string, role: AuthUser["role"]) => ({ id, name: id, email: `${id}@x.test`, role }) as AuthUser;
const hit = (kind: SearchResult["kind"], id: string): SearchResult => ({ kind, id, title: id, detail: null, projectId: "p1", projectName: "Projeto 1", destination: "OVERVIEW" });

function recordingRepo(items: SearchResult[] = []) {
  const calls: SearchInput[] = [];
  const repo: SearchRepository = {
    async search(input) {
      calls.push(input);
      return items;
    },
  };
  return { repo, calls };
}

describe("Texto da busca", () => {
  it("remove acentos e caixa sem mudar o tamanho do texto", () => {
    assert.equal(foldText("Homologação ÁÉÍÓÚ Çñ"), "homologacao aeiou cn");
    assert.equal(foldText("Ação").length, "Ação".length);
  });

  it("separa palavras, tira '#', repete uma vez só e limita a quantidade", () => {
    assert.deepEqual(searchWords("  Ata  #5646541 GLPI ata "), ["ata", "5646541", "glpi"]);
    assert.deepEqual(searchWords("demo.pmo@exemplo.com"), ["demo", "pmo", "exemplo", "com"]);
    assert.equal(searchWords("a b c d e f g h").length, MAX_WORDS);
    assert.deepEqual(searchWords("   #  "), []);
  });

  it("escapa curingas do LIKE para o termo valer como texto", () => {
    assert.equal(escapeLike("100%_a\\b"), "100\\%\\_a\\\\b");
    assert.equal(likePattern("ata"), "% ata%");
  });

  it("recorta um trecho ao redor do achado, com reticências", () => {
    const longText = `${"abc ".repeat(40)}firewall homologado ${"xyz ".repeat(40)}`;
    const part = excerpt(longText, ["firewall"], 60);
    assert.ok(part);
    assert.ok(part.includes("firewall"));
    assert.ok(part.startsWith("…") && part.endsWith("…"));
    assert.equal(excerpt("curto", ["x"]), "curto");
    assert.equal(excerpt(null, ["x"]), null);
    assert.equal(excerpt("   ", ["x"]), null);
  });
});

describe("Busca global: escopo e autorização", () => {
  it("ADMIN, PMO e COORDENADOR alcançam todos os projetos e as pessoas", async () => {
    for (const role of ["ADMIN", "PMO", "COORDENADOR"] as const) {
      const { repo, calls } = recordingRepo();
      await makeSearchUseCases(repo).search(user("u1", role), "ata", 5);
      assert.deepEqual(calls[0].scope, { all: true }, role);
      assert.equal(calls[0].includePeople, true, role);
    }
  });

  it("os demais perfis ficam restritos aos próprios projetos e não pesquisam pessoas", async () => {
    for (const role of ["GESTOR", "FORNECEDOR", "COLABORADOR"] as const) {
      const { repo, calls } = recordingRepo();
      await makeSearchUseCases(repo).search(user("u9", role), "ata", 5);
      assert.deepEqual(calls[0].scope, { all: false, userId: "u9" }, role);
      assert.equal(calls[0].includePeople, false, role);
    }
  });

  it("o escopo vem do usuário autenticado: o termo não consegue ampliá-lo", async () => {
    const { repo, calls } = recordingRepo();
    await makeSearchUseCases(repo).search(user("u9", "FORNECEDOR"), "' or true -- {all:true}", 5);
    assert.deepEqual(calls[0].scope, { all: false, userId: "u9" });
  });

  it("termo curto ou só com símbolos não consulta o banco", async () => {
    const { repo, calls } = recordingRepo([hit("PROJECT", "p")]);
    const useCases = makeSearchUseCases(repo);
    assert.deepEqual((await useCases.search(user("u1", "PMO"), "a", 5)).items, []);
    assert.deepEqual((await useCases.search(user("u1", "PMO"), " # # ", 5)).items, []);
    assert.equal(calls.length, 0);
  });

  it("ordena os resultados por tipo na ordem fixa, mantendo a ordem dentro do tipo", async () => {
    const { repo } = recordingRepo([hit("PERSON", "x"), hit("MINUTES", "a2"), hit("PROJECT", "p1"), hit("MINUTES", "a1"), hit("GLPI", "g")]);
    const response = await makeSearchUseCases(repo).search(user("u1", "PMO"), "teste", 5);
    assert.deepEqual(
      response.items.map((entry) => entry.id),
      ["p1", "g", "a2", "a1", "x"],
    );
  });
});

describe("Busca global: validação da consulta", () => {
  it("exige entre 2 e 100 caracteres e limita a quantidade por tipo", () => {
    assert.equal(searchQuerySchema.safeParse({ q: "a" }).success, false);
    assert.equal(searchQuerySchema.safeParse({ q: "x".repeat(101) }).success, false);
    assert.equal(searchQuerySchema.safeParse({ q: "ata" }).success, true);
    assert.equal(searchQuerySchema.parse({ q: "ata" }).perKind, 5);
    assert.equal(searchQuerySchema.safeParse({ q: "ata", perKind: 50 }).success, false);
    assert.equal(searchQuerySchema.safeParse({ q: "ata", extra: "1" }).success, false);
  });
});

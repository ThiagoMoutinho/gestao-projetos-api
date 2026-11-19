import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isUniqueViolation, UniqueConstraintError } from "./postgres-errors";

describe("isUniqueViolation", () => {
  it("reconhece o erro direto do driver (comportamento anterior)", () => {
    assert.equal(isUniqueViolation({ code: "23505" }), true);
  });

  it("reconhece o erro embrulhado pelo Drizzle em cause (um ou mais níveis)", () => {
    assert.equal(isUniqueViolation({ message: "Failed query", cause: { code: "23505" } }), true);
    assert.equal(isUniqueViolation({ cause: { cause: { code: "23505" } } }), true);
  });

  it("não confunde outros erros do banco nem valores sem código", () => {
    assert.equal(isUniqueViolation({ code: "23503" }), false); // chave estrangeira
    assert.equal(isUniqueViolation({ code: "23514" }), false); // CHECK
    assert.equal(isUniqueViolation({ cause: { code: "23503" } }), false);
    assert.equal(isUniqueViolation(new Error("qualquer erro")), false);
    assert.equal(isUniqueViolation(null), false);
    assert.equal(isUniqueViolation(undefined), false);
    assert.equal(isUniqueViolation("23505"), false);
  });

  it("não entra em laço com causas circulares", () => {
    const loop: { cause?: unknown } = {};
    loop.cause = loop;
    assert.equal(isUniqueViolation(loop), false);
  });

  it("UniqueConstraintError mantém o nome e a mensagem usados pelos casos de uso", () => {
    const error = new UniqueConstraintError();
    assert.equal(error.name, "UniqueConstraintError");
    assert.equal(error.message, "UNIQUE_CONSTRAINT");
  });
});

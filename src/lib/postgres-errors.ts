export class UniqueConstraintError extends Error {
  constructor() {
    super("UNIQUE_CONSTRAINT");
    this.name = "UniqueConstraintError";
  }
}

/** Violação de unicidade (23505). O Drizzle embrulha o erro do driver em `cause`, então a cadeia inteira é conferida. */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    if ("code" in current && current.code === "23505") {
      return true;
    }
    current = "cause" in current ? current.cause : null;
  }
  return false;
}

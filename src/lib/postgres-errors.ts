export class UniqueConstraintError extends Error {
  constructor() {
    super("UNIQUE_CONSTRAINT");
    this.name = "UniqueConstraintError";
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

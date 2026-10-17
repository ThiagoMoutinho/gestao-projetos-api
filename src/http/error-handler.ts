import type { FastifyInstance } from "fastify";

import { HttpError } from "../lib/http-error";

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({
        message: error.message,
        code: error.code,
      });
    }

    if (
      typeof error === "object" &&
      error !== null &&
      "validation" in error &&
      error.validation
    ) {
      return reply.status(400).send({
        message: "Dados inválidos.",
        code: "VALIDATION_ERROR",
      });
    }

    request.log.error(error);
    return reply.status(500).send({
      message: "Erro interno do servidor.",
      code: "INTERNAL_ERROR",
    });
  });
}

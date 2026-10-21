import fastifyCors from "@fastify/cors";
import fastifySwagger from "@fastify/swagger";
import fastifyApiReference from "@scalar/fastify-api-reference";
import { fromNodeHeaders } from "better-auth/node";
import Fastify from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  ZodTypeProvider,
} from "fastify-type-provider-zod";
import z from "zod";

import { db } from "./db";
import { registerErrorHandler } from "./http/error-handler";
import { auth } from "./lib/auth";
import { makeEapRoutes } from "./modules/eap/eap.routes";
import { makeEapModule } from "./modules/eap/factories/make-eap-controller";
import { makeProjectsModule } from "./modules/projects/factories/make-projects-controller";
import { makeProjectsRoutes } from "./modules/projects/projects.routes";

export async function buildApp() {
  const app = Fastify({
    logger: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);

  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: "Gestão de projetos API",
        description: "API para gestão de projetos",
        version: "1.0.0",
      },
      servers: [
        {
          url: "http://localhost:3000",
          description: "Servidor local",
        },
      ],
      tags: [
        { name: "Projetos", description: "Cadastro e consulta de projetos" },
        {
          name: "Participantes",
          description: "Participantes e funções do projeto",
        },
        { name: "EAP", description: "Estrutura analítica do projeto" },
        { name: "Me", description: "Recursos do usuário autenticado" },
      ],
      components: {
        securitySchemes: {
          cookieAuth: {
            type: "apiKey",
            in: "cookie",
            name: "better-auth.session_token",
          },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  await app.register(fastifyCors, {
    origin: ["http://localhost:3000", "http://localhost:3001"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
  });

  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    schema: {
      hide: true,
    },
    async handler(request, reply) {
      try {
        const url = new URL(request.url, `http://${request.headers.host}`);
        const headers = fromNodeHeaders(request.headers);
        const req = new Request(url.toString(), {
          method: request.method,
          headers,
          ...(request.body ? { body: JSON.stringify(request.body) } : {}),
        });
        const response = await auth.handler(req);
        reply.status(response.status);
        response.headers.forEach((value, key) => reply.header(key, value));
        return reply.send(response.body ? await response.text() : null);
      } catch (error) {
        app.log.error(error);
        return reply.status(500).send({
          error: "Internal authentication error",
          code: "AUTH_FAILURE",
        });
      }
    },
  });

  await app.register(fastifyApiReference, {
    routePrefix: "/docs",
    configuration: {
      sources: [
        {
          title: "Gestão de projetos API",
          slug: "gestao-de-projetos-api",
          url: "/swagger.json",
        },
        {
          title: "Auth API",
          slug: "auth-api",
          url: "/api/auth/open-api/generate-schema",
        },
      ],
    },
  });

  app.route({
    method: "GET",
    url: "/swagger.json",
    schema: {
      hide: true,
    },
    handler: () => {
      return app.swagger();
    },
  });

  app.route({
    method: "GET",
    url: "/",
    schema: {
      operationId: "getHelloWorld",
      description: "Hello World",
      tags: ["Hello World"],
      response: {
        200: z.object({
          message: z.string(),
        }),
      },
    },
    handler: () => {
      return { message: "Hello World" };
    },
  });

  app.get(
    "/admin",
    {
      schema: {
        hide: true,
      },
    },
    async (request, reply) => {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(request.headers),
      });

      if (!session) {
        return reply.status(401).send({
          message: "Você precisa estar autenticado.",
        });
      }

      if (session.user.role !== "ADMIN") {
        return reply.status(403).send({
          message: "Você não tem permissão para acessar esta área.",
        });
      }

      return reply.send({
        message: "Bem-vindo à área administrativa!",
        usuario: session.user.name,
        perfil: session.user.role,
      });
    },
  );

  const projectsController = makeProjectsModule(db);
  await app.register(makeProjectsRoutes(projectsController));

  const eapController = makeEapModule(db);
  await app.register(makeEapRoutes(eapController));

  return app;
}

import "dotenv/config";

// ESM
import Fastify from 'fastify'

import { jsonSchemaTransform, serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import z from "zod";

import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUI from '@fastify/swagger-ui';
import { auth } from "./lib/auth";
import { fromNodeHeaders } from "better-auth/node";
import fastifyCors from '@fastify/cors';
import fastifyApiReference from '@scalar/fastify-api-reference';

const app = Fastify({
  logger: true
})

app.route({
  method: ["GET", "POST"],
  url: "/api/auth/*",
  async handler(request, reply) {
    try {
      // Construct request URL
      const url = new URL(request.url, `http://${request.headers.host}`);
      
      // Convert Fastify headers to standard Headers object
      const headers = fromNodeHeaders(request.headers);
      // Create Fetch API-compatible request
      const req = new Request(url.toString(), {
        method: request.method,
        headers,
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      });
      // Process authentication request
      const response = await auth.handler(req);
      // Forward response to client
      reply.status(response.status);
      response.headers.forEach((value, key) => reply.header(key, value));
      return reply.send(response.body ? await response.text() : null);
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({ 
        error: "Internal authentication error",
        code: "AUTH_FAILURE"
      });
    }
  }
});

await app.register(fastifyApiReference, {
  routePrefix: '/docs',
  configuration: {
    sources: [
      {
        title: 'Gestão de projetos API',
        slug: 'gestao-de-projetos-api',
        url: '/swagger.json',
      },
      {
        title: 'Auth API',
        slug: 'auth-api',
        url: '/api/auth/open-api/generate-schema '
      }
    ]
  }
});

app.withTypeProvider<ZodTypeProvider>().route({
  method: 'GET',
  url: '/swagger.json',
  schema: {
    hide: true,
  },
  handler: () => {
    return app.swagger();
  }
});

await app.register(fastifySwagger, {
  openapi: {
    info: {
      title: 'Gestão de projetos API',
      description: 'API para gestão de projetos',
      version: '1.0.0',
    },
    servers: [{
      url: 'http://localhost:3000',
      description: 'Servidor local',
    }],
  },
  transform: jsonSchemaTransform,
});


await app.register(fastifyCors, {
  origin: 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});


app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);


app.withTypeProvider<ZodTypeProvider>().route({
  method: 'GET',
  url: "/",
  schema: {
    description: "Hello World",
    tags: ["Hello World"],
    response: {
      200: z.object({
        message: z.string(),
      }),
    }
  },
  handler: () => {
    return { message: "Hello World" };
  }
});

// Run the server!
app.listen({ port: Number(process.env.PORT) }, function (err, address) {
  if (err) {
    app.log.error(err)
    process.exit(1)
  }
  // Server is now listening on ${address}
})



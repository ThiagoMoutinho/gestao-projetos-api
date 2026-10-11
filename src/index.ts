import "dotenv/config";

// ESM
import Fastify from 'fastify'

import { jsonSchemaTransform, serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import z from "zod";

import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUI from '@fastify/swagger-ui';

const app = Fastify({
  logger: true
})

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

await app.register(fastifySwaggerUI, {
  routePrefix: '/docs',
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



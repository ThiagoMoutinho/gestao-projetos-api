import "dotenv/config";

// ESM
import Fastify from 'fastify'

import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import z from "zod";


const app = Fastify({
  logger: true
})

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


import "dotenv/config";

import { buildApp } from "./app";

const app = await buildApp();

app.listen({ port: Number(process.env.PORT) }, function (err) {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});

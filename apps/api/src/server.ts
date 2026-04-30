import { buildApp } from "./app.js";

async function start(): Promise<void> {
  const app = await buildApp();
  const port = app.config.API_PORT;

  try {
    await app.listen({
      host: "0.0.0.0",
      port
    });
    app.log.info({ port }, "API is running");
  } catch (error) {
    app.log.error(error, "API failed to start");
    process.exit(1);
  }
}

void start();


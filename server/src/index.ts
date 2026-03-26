import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";

const port = Number(process.env.PORT ?? 3017);
const host = process.env.HOST ?? "0.0.0.0";

const app = await buildServer();

const close = async () => {
  await app.close();
  closeDatabase();
};

process.on("SIGINT", () => {
  void close();
});

process.on("SIGTERM", () => {
  void close();
});

await app.listen({ port, host });

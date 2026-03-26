import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";

const port = Number(process.env.PORT ?? 3017);
const host = process.env.HOST ?? "127.0.0.1";
const dataRoot = process.env.FORGE_E2E_DATA_ROOT ?? (await mkdtemp(path.join(os.tmpdir(), "forge-e2e-")));

const app = await buildServer({ dataRoot });

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

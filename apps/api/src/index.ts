import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";
import { startForgeDiscoveryAdvertiser } from "./discovery-advertiser.js";

const port = Number(process.env.PORT ?? 4317);
const host = process.env.HOST ?? "0.0.0.0";
const basePath = process.env.FORGE_BASE_PATH ?? "/forge/";

const app = await buildServer();
const discoveryAdvertiser = await startForgeDiscoveryAdvertiser({ port, basePath });

const close = async () => {
  discoveryAdvertiser?.stop();
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

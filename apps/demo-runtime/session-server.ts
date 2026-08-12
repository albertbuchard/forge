import process from "node:process";

import { buildServer } from "../api/src/app.js";
import { closeDatabase } from "../api/src/db.js";
import { seedDemoDataIntoRuntime } from "../api/src/demo-data.js";

const rootIndex = process.argv.indexOf("--root");
const portIndex = process.argv.indexOf("--port");
const dataRoot = rootIndex >= 0 ? process.argv[rootIndex + 1] : null;
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : NaN);

if (!dataRoot || !Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("The demo session requires one explicit data root and port.");
}

await seedDemoDataIntoRuntime(dataRoot);
const app = await buildServer({ dataRoot, seedDemoData: false, peerRuntime: false, devrageMetricSync: false });

const close = async () => {
  await app.close();
  closeDatabase();
};
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());

await app.listen({ host: "127.0.0.1", port });
process.stdout.write(`FORGE_DEMO_READY=${port}\n`);

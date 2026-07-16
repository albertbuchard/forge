import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { createConnectivityService } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { SafeLogger } from "../src/logger.js";

const mode = process.argv[2];
if (mode !== "--write" && mode !== "--check") {
  throw new Error("Usage: export-openapi.ts --write|--check");
}

const config = loadConfig({
  FORGE_CONNECTIVITY_DATABASE_PATH: ":memory:",
  FORGE_CONNECTIVITY_LOG_LEVEL: "silent"
});
const service = await createConnectivityService({
  config,
  logger: new SafeLogger("silent")
});

try {
  const document = service.app.swagger();
  const serialized = `${JSON.stringify(document, null, 2)}\n`;
  const outputPath = path.resolve(
    import.meta.dirname,
    "../openapi/openapi.json"
  );

  if (mode === "--write") {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, serialized, "utf8");
  } else {
    const existing = await readFile(outputPath, "utf8").catch(() => "");
    if (existing !== serialized) {
      throw new Error(
        "openapi/openapi.json is stale; run npm run openapi:write"
      );
    }
  }
} finally {
  await service.close();
}

import { performance } from "node:perf_hooks";

async function main() {
  const dataRoot = process.env.FORGE_PEOPLE_PERF_DATA_ROOT;
  const port = Number.parseInt(process.env.FORGE_PEOPLE_PERF_PORT ?? "", 10);
  const host = "127.0.0.1";
  if (!dataRoot || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      "People performance server requires an isolated data root and port."
    );
  }

  const startedAt = performance.now();
  const [{ buildServer }, { closeDatabase }] = await Promise.all([
    import("../../apps/api/src/app.ts"),
    import("../../apps/api/src/db.ts")
  ]);
  const app = await buildServer({
    dataRoot,
    taskRunWatchdog: false,
    devrageMetricSync: false,
    peerRuntime: false
  });
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await app.close();
    closeDatabase();
  };

  process.on("message", (message) => {
    if (!message || typeof message !== "object") return;
    if (message.type === "memory") {
      if (message.collect && typeof globalThis.gc === "function") {
        globalThis.gc();
      }
      process.send?.({
        type: "memory",
        requestId: message.requestId,
        memory: process.memoryUsage(),
        sampledAt: new Date().toISOString()
      });
      return;
    }
    if (message.type === "shutdown") {
      void close()
        .then(() => {
          process.exitCode = 0;
          if (process.connected) {
            process.send?.({ type: "closed" }, () => {
              process.disconnect();
              process.exit(0);
            });
          } else {
            process.exit(0);
          }
        })
        .catch((error) => {
          process.send?.({
            type: "fatal",
            message: error instanceof Error ? error.message : String(error)
          });
          process.exitCode = 1;
        });
    }
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      void close().finally(() => {
        process.exit(0);
      });
    });
  }

  await app.listen({ host, port });
  process.send?.({
    type: "ready",
    pid: process.pid,
    port,
    startupMs: performance.now() - startedAt
  });
}

main().catch((error) => {
  process.send?.({
    type: "fatal",
    message:
      error instanceof Error ? (error.stack ?? error.message) : String(error)
  });
  process.exitCode = 1;
});

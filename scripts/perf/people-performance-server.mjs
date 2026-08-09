import { performance } from "node:perf_hooks";
import { setImmediate as nextEventLoopTurn } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { getHeapSpaceStatistics } from "node:v8";

async function main() {
  const dataRoot = process.env.FORGE_PEOPLE_PERF_DATA_ROOT;
  const compiledAppEntry =
    process.env.FORGE_PEOPLE_PERF_COMPILED_APP_ENTRY?.trim();
  const compiledDatabaseEntry =
    process.env.FORGE_PEOPLE_PERF_COMPILED_DATABASE_ENTRY?.trim();
  const port = Number.parseInt(process.env.FORGE_PEOPLE_PERF_PORT ?? "", 10);
  const host = "127.0.0.1";
  if (
    !dataRoot ||
    !compiledAppEntry?.endsWith(".js") ||
    !compiledDatabaseEntry?.endsWith(".js") ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    throw new Error(
      "People performance server requires an isolated data root, compiled JavaScript runtime, and port."
    );
  }

  const startedAt = performance.now();
  const [{ buildServer }, { closeDatabase }] = await Promise.all([
    import(pathToFileURL(compiledAppEntry).href),
    import(pathToFileURL(compiledDatabaseEntry).href)
  ]);
  let securityRuntime = null;
  const app = await buildServer({
    dataRoot,
    taskRunWatchdog: false,
    devrageMetricSync: false,
    peerRuntime: false,
    onSecurityRuntimeReady(runtime) {
      securityRuntime = runtime;
    }
  });
  if (!securityRuntime) {
    throw new Error("People performance security runtime is unavailable.");
  }
  const ownerEpoch =
    securityRuntime.store.readOwnerSecurityEpoch("user_operator");
  if (!ownerEpoch) {
    throw new Error("People performance owner security state is unavailable.");
  }
  const operatorSession = securityRuntime.browserSessions.create(
    {
      kind: "operator_session",
      subjectId: "user_operator",
      ownerId: "user_operator",
      clientId: null,
      installationId: null,
      audience: securityRuntime.audience,
      scopes: ["*"],
      profile: "operator",
      ownerSecurityEpoch: ownerEpoch,
      clientSecurityEpoch: null,
      authenticatedAt: new Date().toISOString()
    },
    { processBound: true }
  );
  const operatorSessionCookie = `forge_session=${encodeURIComponent(operatorSession.sessionToken)}`;
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await app.close();
    closeDatabase();
  };

  const sampleMemory = async (message) => {
    if (message.collect && typeof globalThis.gc === "function") {
      globalThis.gc();
      await nextEventLoopTurn();
      globalThis.gc();
      await nextEventLoopTurn();
    }
    process.send?.({
      type: "memory",
      requestId: message.requestId,
      memory: process.memoryUsage(),
      resourceUsage: process.resourceUsage(),
      heapSpaces: getHeapSpaceStatistics(),
      sampledAt: new Date().toISOString()
    });
  };

  process.on("message", (message) => {
    if (!message || typeof message !== "object") return;
    if (message.type === "memory") {
      void sampleMemory(message).catch((error) => {
        process.send?.({
          type: "fatal",
          message: error instanceof Error ? error.message : String(error)
        });
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
    startupMs: performance.now() - startedAt,
    runtime: {
      loader: "compiled_javascript",
      containsTypeScriptLoader: false
    },
    operatorSessionCookie
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

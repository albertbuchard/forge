#!/usr/bin/env node

import { createConnectivityService, type ConnectivityService } from "./app.js";
import { loadConfig, type ConnectivityConfig } from "./config.js";
import { SafeLogger } from "./logger.js";

let config: ConnectivityConfig | undefined;
let logger = new SafeLogger("info");
let service: ConnectivityService | undefined;
let serviceClosePromise: Promise<void> | undefined;
const serviceCreation = Promise.withResolvers<void>();
let shuttingDown = false;

function shutdownWasRequested(): boolean {
  return shuttingDown;
}

function raiseExitCode(exitCode: number): void {
  const currentExitCode =
    typeof process.exitCode === "number" ? process.exitCode : 0;
  process.exitCode = Math.max(currentExitCode, exitCode);
}

function closeService(): Promise<void> {
  if (service === undefined) {
    return Promise.resolve();
  }
  serviceClosePromise ??= service.close();
  return serviceClosePromise;
}

async function shutdown(
  signal?: "SIGINT" | "SIGTERM",
  exitCode = 0
): Promise<void> {
  if (shuttingDown) {
    raiseExitCode(exitCode);
    return;
  }
  shuttingDown = true;
  const forceExit = setTimeout(() => {
    logger.fatal("SHUTDOWN_TIMEOUT");
    process.exit(1);
  }, config?.server.shutdownTimeoutMs ?? 10_000);
  forceExit.unref();

  try {
    await serviceCreation.promise;
    await closeService();
    logger.shutdown(signal);
    raiseExitCode(exitCode);
  } catch {
    logger.fatal("SHUTDOWN_FAILED");
    process.exitCode = 1;
  } finally {
    clearTimeout(forceExit);
  }
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.once("uncaughtException", () => {
  logger.fatal("UNCAUGHT_EXCEPTION");
  void shutdown(undefined, 1);
});
process.once("unhandledRejection", () => {
  logger.fatal("UNHANDLED_REJECTION");
  void shutdown(undefined, 1);
});

try {
  config = loadConfig();
  logger = new SafeLogger(config.logging.level);
  service = await createConnectivityService({ config, logger });
  serviceCreation.resolve();
  if (shutdownWasRequested()) {
    await closeService();
  } else {
    await service.listen();
    if (shutdownWasRequested()) {
      await closeService();
    } else {
      logger.startup();
    }
  }
} catch {
  serviceCreation.resolve();
  if (shutdownWasRequested()) {
    raiseExitCode(1);
  } else {
    logger.fatal("STARTUP_FAILED");
    await shutdown(undefined, 1);
  }
}

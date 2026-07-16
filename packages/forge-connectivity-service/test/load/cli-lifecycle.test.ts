import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";

it("starts and closes the CLI cleanly on SIGTERM", async (testContext) => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "forge-connectivity-cli-")
  );
  const port = await availablePort();
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith("FORGE_CONNECTIVITY_")
    )
  );
  const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
    cwd: path.resolve(import.meta.dirname, "../.."),
    env: {
      ...environment,
      FORGE_CONNECTIVITY_DATABASE_PATH: path.join(
        directory,
        "connectivity.sqlite"
      ),
      FORGE_CONNECTIVITY_HOST: "127.0.0.1",
      FORGE_CONNECTIVITY_LOG_LEVEL: "info",
      FORGE_CONNECTIVITY_PORT: String(port)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  testContext.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await once(child, "exit");
    }
    await rm(directory, { force: true, recursive: true });
  });

  await waitForOutput(
    () => stdout.includes('"event":"service_started"'),
    child,
    () => stderr
  );
  assert.equal(child.kill("SIGTERM"), true);
  const [exitCode, signal] = (await once(child, "exit")) as [
    number | null,
    NodeJS.Signals | null
  ];

  assert.equal(exitCode, 0, stderr);
  assert.equal(signal, null);
  assert.match(stdout, /"event":"service_stopped"/);
  assert.match(stdout, /"signal":"SIGTERM"/);
});

async function availablePort(): Promise<number> {
  const server = net.createServer();
  server.unref();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  return port;
}

async function waitForOutput(
  predicate: () => boolean,
  child: ReturnType<typeof spawn>,
  stderr: () => string
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`CLI exited before startup: ${stderr()}`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`CLI startup timed out: ${stderr()}`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

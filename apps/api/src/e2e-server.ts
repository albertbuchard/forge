import { randomUUID } from "node:crypto";
import path from "node:path";
import { readdir, unlink, writeFile } from "node:fs/promises";
import { applicationSecurityRuntimeForTest, buildServer } from "./app.js";
import { closeDatabase } from "./db.js";
import { validateIsolatedE2eRuntime } from "./security/e2e-runtime-guard.js";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const runtime = validateIsolatedE2eRuntime(process.env, repoRoot);

const app = await buildServer({ dataRoot: runtime.dataRoot });
const security = applicationSecurityRuntimeForTest(app);
const ownerEpoch = security.store.readOwnerSecurityEpoch("user_operator");
if (ownerEpoch === null) {
  throw new Error("The isolated E2E runtime has no operator security epoch.");
}
const authorityRunId = randomUUID();
const authorities = Array.from({ length: 128 }, () =>
  security.browserSessions.create(
    {
      kind: "operator_session",
      subjectId: "user_operator",
      ownerId: "user_operator",
      clientId: null,
      installationId: null,
      audience: security.audience,
      scopes: ["*"],
      profile: "operator",
      ownerSecurityEpoch: ownerEpoch,
      clientSecurityEpoch: null,
      authenticatedAt: new Date().toISOString()
    },
    {
      idleLifetimeSeconds: 60 * 60,
      absoluteLifetimeSeconds: 60 * 60,
      processBound: true
    }
  )
);
let closePromise: Promise<void> | null = null;
const close = () => {
  if (closePromise) {
    return closePromise;
  }
  closePromise = (async () => {
    for (const authority of authorities) {
      security.browserSessions.revoke(authority.sessionToken);
    }
    await unlink(runtime.authorityPath).catch(() => undefined);
    const claimPrefix = `.forge-e2e-authority-claim-${authorityRunId}-`;
    for (const entry of await readdir(runtime.dataRoot).catch(() => [])) {
      if (entry.startsWith(claimPrefix)) {
        await unlink(path.join(runtime.dataRoot, entry)).catch(() => undefined);
      }
    }
    try {
      await app.close();
    } finally {
      closeDatabase();
    }
  })();
  return closePromise;
};

process.on("SIGINT", () => {
  void close().catch((error) => {
    process.stderr.write(
      `Forge isolated E2E shutdown failed: ${
        error instanceof Error ? error.message : String(error)
      }\n`
    );
    process.exitCode = 1;
  });
});

process.on("SIGTERM", () => {
  void close().catch((error) => {
    process.stderr.write(
      `Forge isolated E2E shutdown failed: ${
        error instanceof Error ? error.message : String(error)
      }\n`
    );
    process.exitCode = 1;
  });
});

try {
  await writeFile(
    runtime.authorityPath,
    `${JSON.stringify({
      schema: "forge-e2e-browser-authority/1",
      runId: authorityRunId,
      authorities: authorities.map(({ sessionToken, csrfToken }) => ({
        sessionToken,
        csrfToken
      }))
    })}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 }
  );
  await app.listen({ port: runtime.port, host: runtime.host });
} catch (error) {
  await close();
  throw error;
}

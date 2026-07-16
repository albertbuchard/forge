import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { createArtifactFromUpload } from "./services/artifacts.js";

type Worker = {
  child: ChildProcessWithoutNullStreams;
  waitFor: (marker: string) => Promise<void>;
  completed: () => boolean;
  result: Promise<Record<string, unknown>>;
};

function observeWorker(child: ChildProcessWithoutNullStreams): Worker {
  let stdout = "";
  let stderr = "";
  let done = false;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const result = new Promise<Record<string, unknown>>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      done = true;
      if (code !== 0) {
        reject(
          new Error(`Artifact worker exited ${code}: ${stderr}\n${stdout}`)
        );
        return;
      }
      const line = stdout
        .split("\n")
        .map((entry) => entry.trim())
        .find((entry) => entry.startsWith("RESULT "));
      if (!line) {
        reject(new Error(`Artifact worker returned no result: ${stdout}`));
        return;
      }
      resolve(
        JSON.parse(line.slice("RESULT ".length)) as Record<string, unknown>
      );
    });
  });
  return {
    child,
    completed: () => done,
    result,
    waitFor: (marker) =>
      new Promise<void>((resolve, reject) => {
        const poll = () => {
          if (stdout.includes(marker)) {
            resolve();
            return;
          }
          if (done) {
            reject(
              new Error(
                `Artifact worker exited before ${marker}: ${stderr}\n${stdout}`
              )
            );
            return;
          }
          setTimeout(poll, 5);
        };
        poll();
      })
  };
}

function cleanupWorker(dataRoot: string) {
  const dbUrl = pathToFileURL(path.resolve("apps/api/src/db.ts")).href;
  const artifactsUrl = pathToFileURL(
    path.resolve("apps/api/src/services/artifacts.ts")
  ).href;
  const script = `
    import { rm } from "node:fs/promises";
    import { configureDatabase, closeDatabase } from ${JSON.stringify(dbUrl)};
    import { reconcilePendingArtifactBlobCleanups } from ${JSON.stringify(artifactsUrl)};
    configureDatabase({ dataRoot: process.env.ARTIFACT_RACE_ROOT, seedDemoData: false });
    try {
      const dispositions = await reconcilePendingArtifactBlobCleanups({
        removeArtifactUploadFile: async (target) => {
          process.stdout.write("DELETE_READY\\n");
          await new Promise((resolve) => process.stdin.once("data", resolve));
          await rm(target, { force: true });
        }
      });
      process.stdout.write("RESULT " + JSON.stringify({ ok: true, dispositions }) + "\\n");
    } catch (error) {
      process.stdout.write("RESULT " + JSON.stringify({ ok: false, message: String(error?.message ?? error) }) + "\\n");
    } finally {
      closeDatabase();
    }
  `;
  return observeWorker(
    spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", script],
      {
        cwd: process.cwd(),
        env: { ...process.env, ARTIFACT_RACE_ROOT: dataRoot },
        stdio: ["pipe", "pipe", "pipe"]
      }
    )
  );
}

function uploadWorker(dataRoot: string, contentBase64: string) {
  const dbUrl = pathToFileURL(path.resolve("apps/api/src/db.ts")).href;
  const artifactsUrl = pathToFileURL(
    path.resolve("apps/api/src/services/artifacts.ts")
  ).href;
  const script = `
    import { configureDatabase, closeDatabase } from ${JSON.stringify(dbUrl)};
    import { createArtifactFromUpload } from ${JSON.stringify(artifactsUrl)};
    configureDatabase({ dataRoot: process.env.ARTIFACT_RACE_ROOT, seedDemoData: false });
    process.stdout.write("UPLOAD_STARTED\\n");
    try {
      const result = await createArtifactFromUpload({
        idempotencyKey: "artifact-cross-process-winner",
        title: "Cross-process winner",
        originalFileName: "race.txt",
        contentBase64: process.env.ARTIFACT_RACE_CONTENT
      }, { source: "ui", actor: "Artifact race worker" });
      process.stdout.write("RESULT " + JSON.stringify({ ok: true, artifactId: result.artifact.id }) + "\\n");
    } catch (error) {
      process.stdout.write("RESULT " + JSON.stringify({ ok: false, code: error?.code ?? null, message: String(error?.message ?? error) }) + "\\n");
    } finally {
      closeDatabase();
    }
  `;
  return observeWorker(
    spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", script],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ARTIFACT_RACE_ROOT: dataRoot,
          ARTIFACT_RACE_CONTENT: contentBase64
        },
        stdio: ["pipe", "pipe", "pipe"]
      }
    )
  );
}

test(
  "cross-process cleanup excludes a same-blob metadata commit until deletion completes",
  { timeout: 30_000 },
  async () => {
    const rootDir = await mkdtemp(
      path.join(os.tmpdir(), "forge-artifact-cross-process-")
    );
    const app = await buildServer({
      dataRoot: rootDir,
      seedDemoData: true,
      devrageMetricSync: false
    });
    let cleaner: Worker | null = null;
    let uploader: Worker | null = null;
    try {
      const contentBase64 = Buffer.from(
        "shared-data-root cleanup and commit race",
        "utf8"
      ).toString("base64");
      await assert.rejects(
        createArtifactFromUpload(
          {
            idempotencyKey: "artifact-cross-process-pending",
            title: "Cross-process pending cleanup",
            originalFileName: "race.txt",
            contentBase64
          },
          { source: "ui", actor: "Artifact race setup" },
          {
            beforeArtifactMetadataCommit: () => {
              throw Object.assign(new Error("leave cleanup pending"), {
                code: "artifact_test_leave_cleanup_pending"
              });
            },
            removeArtifactUploadFile: async () => {
              throw Object.assign(new Error("defer cleanup to worker"), {
                code: "artifact_test_deferred_cleanup"
              });
            }
          }
        )
      );
      const pending = getDatabase()
        .prepare(
          `SELECT cleanup.storage_key, provenance.blob_created_by_operation
           FROM artifact_pending_blob_cleanups AS cleanup
           INNER JOIN artifact_pending_blob_cleanup_provenance AS provenance
             ON provenance.cleanup_id = cleanup.id`
        )
        .get() as {
        storage_key: string;
        blob_created_by_operation: number;
      };
      assert.equal(pending.blob_created_by_operation, 1);

      cleaner = cleanupWorker(rootDir);
      await cleaner.waitFor("DELETE_READY\n");
      uploader = uploadWorker(rootDir, contentBase64);
      await uploader.waitFor("UPLOAD_STARTED\n");
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(
        uploader.completed(),
        false,
        "the second process must wait while cleanup owns the storage-key lock"
      );

      cleaner.child.stdin.end("CONTINUE\n");
      const [cleanupResult, uploadResult] = await Promise.all([
        cleaner.result,
        uploader.result
      ]);
      assert.equal(cleanupResult.ok, true, JSON.stringify(cleanupResult));
      assert.equal(uploadResult.ok, true, JSON.stringify(uploadResult));
      const artifactId = String(uploadResult.artifactId);
      const committed = getDatabase()
        .prepare("SELECT storage_key, storage_path FROM artifacts WHERE id = ?")
        .get(artifactId) as
        | { storage_key: string; storage_path: string }
        | undefined;
      assert.ok(committed);
      assert.equal(committed.storage_key, pending.storage_key);
      await access(committed.storage_path);
      const counts = getDatabase()
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM artifact_pending_blob_cleanups) AS pending,
             (SELECT COUNT(*) FROM artifact_pending_blob_cleanup_provenance)
               AS provenance`
        )
        .get() as { pending: number; provenance: number };
      assert.deepEqual({ ...counts }, { pending: 0, provenance: 0 });
    } finally {
      cleaner?.child.kill("SIGKILL");
      uploader?.child.kill("SIGKILL");
      await app.close();
      closeDatabase();
      await rm(rootDir, { recursive: true, force: true });
    }
  }
);

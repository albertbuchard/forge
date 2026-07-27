import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";

type TestApp = Awaited<ReturnType<typeof buildServer>>;

type DownloadOperation = {
  responses: Record<string, { content?: Record<string, unknown> }>;
};

type ArtifactDownloadPath = {
  get: DownloadOperation;
  post: DownloadOperation;
};

const operatorCookie = issueTestOperatorSessionCookie;

test("Artifact download OpenAPI media type matches plaintext and encrypted runtime responses", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-artifact-download-contract-")
  );
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: true,
    devrageMetricSync: false
  });
  try {
    const cookie = await operatorCookie(app);
    const openApi = await app.inject({
      method: "GET",
      url: "/api/v1/openapi.json",
      headers: { cookie }
    });
    assert.equal(openApi.statusCode, 200, openApi.body);
    const downloadPath = (
      openApi.json() as {
        paths: Record<string, ArtifactDownloadPath | undefined>;
      }
    ).paths["/api/v1/artifacts/{id}/download"];
    assert.ok(downloadPath);
    for (const method of ["get", "post"] as const) {
      assert.deepEqual(
        Object.keys(downloadPath[method].responses["200"]?.content ?? {}),
        ["application/octet-stream"]
      );
    }

    const plaintext = Buffer.from("download contract plaintext", "utf8");
    const plaintextUpload = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers: { cookie },
      payload: {
        idempotencyKey: "artifact-download-contract-plaintext",
        originalFileName: "download-contract.txt",
        declaredMimeType: "text/plain",
        contentBase64: plaintext.toString("base64")
      }
    });
    assert.equal(plaintextUpload.statusCode, 201, plaintextUpload.body);
    const plaintextId = (plaintextUpload.json() as { artifact: { id: string } })
      .artifact.id;
    const plaintextDownload = await app.inject({
      method: "GET",
      url: `/api/v1/artifacts/${plaintextId}/download`,
      headers: { cookie }
    });
    assert.equal(plaintextDownload.statusCode, 200, plaintextDownload.body);
    assert.equal(
      plaintextDownload.headers["content-type"],
      "application/octet-stream"
    );
    assert.equal(plaintextDownload.rawPayload.equals(plaintext), true);

    const password = "artifact download contract passphrase";
    const encryptedUpload = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers: { cookie },
      payload: {
        idempotencyKey: "artifact-download-contract-encrypted",
        originalFileName: "download-contract-encrypted.txt",
        declaredMimeType: "text/plain",
        contentBase64: plaintext.toString("base64"),
        contentProtection: { mode: "password_encrypted", password }
      }
    });
    assert.equal(encryptedUpload.statusCode, 201, encryptedUpload.body);
    const encryptedId = (encryptedUpload.json() as { artifact: { id: string } })
      .artifact.id;
    const encryptedDownload = await app.inject({
      method: "POST",
      url: `/api/v1/artifacts/${encryptedId}/download`,
      headers: { cookie },
      payload: { password }
    });
    assert.equal(encryptedDownload.statusCode, 200, encryptedDownload.body);
    assert.equal(
      encryptedDownload.headers["content-type"],
      "application/octet-stream"
    );
    assert.equal(encryptedDownload.rawPayload.equals(plaintext), true);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

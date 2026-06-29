import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";

async function issueOperatorSessionCookie(
  app: Awaited<ReturnType<typeof buildServer>>
) {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/auth/operator-session",
    headers: { host: "127.0.0.1:4317" }
  });
  assert.equal(response.statusCode, 200);
  const cookie = response.cookies[0];
  assert.ok(cookie);
  return `${cookie.name}=${cookie.value}`;
}

async function createAgentToken(input: {
  app: Awaited<ReturnType<typeof buildServer>>;
  cookie: string;
  label: string;
  trustLevel: "standard" | "trusted" | "autonomous";
  scopes: string[];
}) {
  const response = await input.app.inject({
    method: "POST",
    url: "/api/v1/settings/tokens",
    headers: { cookie: input.cookie },
    payload: {
      label: input.label,
      agentLabel: input.label,
      trustLevel: input.trustLevel,
      scopes: input.scopes
    }
  });
  assert.equal(response.statusCode, 201);
  return (response.json() as { token: { token: string } }).token.token;
}

test("artifact store uses trusted upload, static scan, generic links, and human-only download", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-artifacts-api-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const untrustedToken = await createAgentToken({
      app,
      cookie,
      label: "Untrusted Artifact Agent",
      trustLevel: "standard",
      scopes: ["artifact.create", "artifact.uploadBytes", "artifact.readMetadata"]
    });
    const trustedToken = await createAgentToken({
      app,
      cookie,
      label: "Trusted Artifact Agent",
      trustLevel: "trusted",
      scopes: [
        "artifact.create",
        "artifact.uploadBytes",
        "artifact.readMetadata",
        "artifact.updateMetadata",
        "artifact.link"
      ]
    });

    const unsafeCsv = "name,value\nformula,=HYPERLINK(\"https://example.com\")\n";
    const untrustedUpload = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers: {
        authorization: `Bearer ${untrustedToken}`,
        "x-forge-source": "agent",
        "x-forge-actor": "Untrusted Artifact Agent"
      },
      payload: {
        originalFileName: "unsafe.csv",
        contentBase64: Buffer.from(unsafeCsv, "utf8").toString("base64")
      }
    });
    assert.equal(untrustedUpload.statusCode, 403);
    assert.equal(
      (untrustedUpload.json() as { code: string }).code,
      "artifact_untrusted_agent"
    );

    const upload = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers: {
        authorization: `Bearer ${trustedToken}`,
        "x-forge-source": "agent",
        "x-forge-actor": "Trusted Artifact Agent"
      },
      payload: {
        title: "Risk worksheet",
        shortDescription: "Formula-like CSV used to test artifact scanning.",
        description: "Uploaded by a trusted token and linked through generic entity_links.",
        originalFileName: "risk-sheet.csv",
        declaredMimeType: "text/csv",
        contentBase64: Buffer.from(unsafeCsv, "utf8").toString("base64"),
        sourceLabel: "artifact test fixture",
        links: [
          {
            entityType: "goal",
            entityId: "goal_artifact_test",
            relationship: "evidence"
          }
        ]
      }
    });
    assert.equal(upload.statusCode, 201);
    const uploadBody = upload.json() as {
      artifact: {
        id: string;
        storagePath: string;
        dangerLevel: string;
        dangerScore: number;
        formatFamily: string;
        links: Array<{
          sourceEntityType: string;
          sourceEntityId: string;
          targetEntityType: string;
          targetEntityId: string;
          anchorKey: string | null;
          relationship: string;
          createdByActor: string | null;
          createdAt: string;
        }>;
        scanResults: { findings: Array<{ code: string }> };
      };
    };
    assert.equal(uploadBody.artifact.formatFamily, "spreadsheet");
    assert.equal(uploadBody.artifact.dangerLevel, "moderate");
    assert.ok(uploadBody.artifact.dangerScore >= 35);
    assert.ok(
      uploadBody.artifact.scanResults.findings.some(
        (finding) => finding.code === "spreadsheet_formula_like_text"
      )
    );
    assert.equal(uploadBody.artifact.links.length, 1);
    assert.equal(uploadBody.artifact.links[0]?.sourceEntityType, "artifact");
    assert.equal(uploadBody.artifact.links[0]?.sourceEntityId, uploadBody.artifact.id);
    assert.equal(uploadBody.artifact.links[0]?.targetEntityType, "goal");
    assert.equal(uploadBody.artifact.links[0]?.targetEntityId, "goal_artifact_test");
    assert.equal(uploadBody.artifact.links[0]?.anchorKey, null);
    assert.equal(uploadBody.artifact.links[0]?.relationship, "evidence");
    assert.equal(uploadBody.artifact.links[0]?.createdByActor, "Trusted Artifact Agent");
    await access(uploadBody.artifact.storagePath);

    const linkedList = await app.inject({
      method: "GET",
      url: "/api/v1/artifacts?linkedEntityType=goal&linkedEntityId=goal_artifact_test",
      headers: { authorization: `Bearer ${trustedToken}` }
    });
    assert.equal(linkedList.statusCode, 200);
    assert.ok(
      (linkedList.json() as { artifacts: Array<{ id: string }> }).artifacts.some(
        (artifact) => artifact.id === uploadBody.artifact.id
      )
    );

    const tokenDownload = await app.inject({
      method: "GET",
      url: `/api/v1/artifacts/${uploadBody.artifact.id}/download`,
      headers: { authorization: `Bearer ${trustedToken}` }
    });
    assert.equal(tokenDownload.statusCode, 401);

    const humanDownload = await app.inject({
      method: "GET",
      url: `/api/v1/artifacts/${uploadBody.artifact.id}/download`,
      headers: { cookie }
    });
    assert.equal(humanDownload.statusCode, 200);
    assert.equal(humanDownload.body, unsafeCsv);
    assert.match(
      humanDownload.headers["content-disposition"] as string,
      /attachment; filename="risk-sheet\.csv"/
    );

    const hardDelete = await app.inject({
      method: "POST",
      url: "/api/v1/entities/delete",
      headers: { cookie },
      payload: {
        operations: [
          {
            entityType: "artifact",
            id: uploadBody.artifact.id,
            mode: "hard",
            reason: "metadata-only test cleanup"
          }
        ]
      }
    });
    assert.equal(hardDelete.statusCode, 200);
    assert.equal(
      (hardDelete.json() as { results: Array<{ ok: boolean }> }).results[0]?.ok,
      true
    );

    const afterDelete = await app.inject({
      method: "GET",
      url: `/api/v1/artifacts/${uploadBody.artifact.id}`,
      headers: { cookie }
    });
    assert.equal(afterDelete.statusCode, 404);
    await access(uploadBody.artifact.storagePath);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("artifact repair migration restores shared entity_links for existing artifact databases and image upload", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-artifacts-repair-"));
  const databasePath = path.join(rootDir, "forge.sqlite");
  const initialApp = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  await initialApp.close();
  closeDatabase();

  const sqlite = new DatabaseSync(databasePath);
  try {
    sqlite.exec(`
      DROP TABLE IF EXISTS entity_links;
      DELETE FROM migrations WHERE id = '073_artifact_entity_links_repair.sql';
    `);
  } finally {
    sqlite.close();
  }

  const repairedApp = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  try {
    const cookie = await issueOperatorSessionCookie(repairedApp);
    const listBeforeUpload = await repairedApp.inject({
      method: "GET",
      url: "/api/v1/artifacts",
      headers: { cookie }
    });
    assert.equal(listBeforeUpload.statusCode, 200);

    const pngBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      "base64"
    );
    const upload = await repairedApp.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers: { cookie },
      payload: {
        title: "Tiny evidence image",
        shortDescription: "One-pixel PNG used to verify image artifact upload.",
        originalFileName: "tiny-proof.png",
        declaredMimeType: "image/png",
        contentBase64: pngBytes.toString("base64"),
        sourceLabel: "artifact repair migration test",
        links: [
          {
            entityType: "project",
            entityId: "project_forge_mobile",
            relationship: "evidence"
          }
        ]
      }
    });
    assert.equal(upload.statusCode, 201);
    const uploadBody = upload.json() as {
      artifact: {
        id: string;
        formatFamily: string;
        detectedExtension: string;
        links: Array<{ targetEntityType: string; targetEntityId: string }>;
      };
    };
    assert.equal(uploadBody.artifact.formatFamily, "image");
    assert.equal(uploadBody.artifact.detectedExtension, "png");
    assert.equal(uploadBody.artifact.links[0]?.targetEntityType, "project");
    assert.equal(uploadBody.artifact.links[0]?.targetEntityId, "project_forge_mobile");

    const linkedList = await repairedApp.inject({
      method: "GET",
      url: "/api/v1/artifacts?linkedEntityType=project&linkedEntityId=project_forge_mobile",
      headers: { cookie }
    });
    assert.equal(linkedList.statusCode, 200);
    assert.ok(
      (linkedList.json() as { artifacts: Array<{ id: string }> }).artifacts.some(
        (artifact) => artifact.id === uploadBody.artifact.id
      )
    );
  } finally {
    await repairedApp.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";

function getArtifactStoragePath(artifactId: string): string {
  const row = getDatabase()
    .prepare("SELECT storage_path FROM artifacts WHERE id = ?")
    .get(artifactId) as { storage_path: string } | undefined;
  assert.ok(row);
  return row.storage_path;
}

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
      scopes: [
        "artifact.create",
        "artifact.uploadBytes",
        "artifact.readMetadata"
      ]
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

    const unsafeCsv = 'name,value\nformula,=HYPERLINK("https://example.com")\n';
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
        description:
          "Uploaded by a trusted token and linked through generic entity_links.",
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
    assert.equal(
      uploadBody.artifact.links[0]?.sourceEntityId,
      uploadBody.artifact.id
    );
    assert.equal(uploadBody.artifact.links[0]?.targetEntityType, "goal");
    assert.equal(
      uploadBody.artifact.links[0]?.targetEntityId,
      "goal_artifact_test"
    );
    assert.equal(uploadBody.artifact.links[0]?.anchorKey, null);
    assert.equal(uploadBody.artifact.links[0]?.relationship, "evidence");
    assert.equal(
      uploadBody.artifact.links[0]?.createdByActor,
      "Trusted Artifact Agent"
    );
    assert.equal("storagePath" in uploadBody.artifact, false);
    const storagePath = getArtifactStoragePath(uploadBody.artifact.id);
    await access(storagePath);

    const linkedList = await app.inject({
      method: "GET",
      url: "/api/v1/artifacts?linkedEntityType=goal&linkedEntityId=goal_artifact_test",
      headers: { authorization: `Bearer ${trustedToken}` }
    });
    assert.equal(linkedList.statusCode, 200);
    assert.ok(
      (
        linkedList.json() as { artifacts: Array<{ id: string }> }
      ).artifacts.some((artifact) => artifact.id === uploadBody.artifact.id)
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

    const softDelete = await app.inject({
      method: "POST",
      url: "/api/v1/entities/delete",
      headers: { cookie },
      payload: {
        operations: [
          {
            entityType: "artifact",
            id: uploadBody.artifact.id,
            mode: "soft",
            reason: "operator archived the artifact metadata"
          }
        ]
      }
    });
    assert.equal(softDelete.statusCode, 200);
    assert.equal(
      (softDelete.json() as { results: Array<{ ok: boolean }> }).results[0]?.ok,
      true
    );

    const afterSoftDelete = await app.inject({
      method: "GET",
      url: `/api/v1/artifacts/${uploadBody.artifact.id}`,
      headers: { cookie }
    });
    assert.equal(afterSoftDelete.statusCode, 404);

    const afterSoftDeleteList = await app.inject({
      method: "GET",
      url: "/api/v1/artifacts?linkedEntityType=goal&linkedEntityId=goal_artifact_test",
      headers: { cookie }
    });
    assert.equal(afterSoftDeleteList.statusCode, 200);
    assert.equal(
      (
        afterSoftDeleteList.json() as { artifacts: Array<{ id: string }> }
      ).artifacts.some((artifact) => artifact.id === uploadBody.artifact.id),
      false
    );

    const restore = await app.inject({
      method: "POST",
      url: "/api/v1/entities/restore",
      headers: { cookie },
      payload: {
        operations: [
          {
            entityType: "artifact",
            id: uploadBody.artifact.id
          }
        ]
      }
    });
    assert.equal(restore.statusCode, 200);
    assert.equal(
      (restore.json() as { results: Array<{ ok: boolean }> }).results[0]?.ok,
      true
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
    await access(storagePath);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("artifact store supports human password encryption without exposing passwords to agents", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-artifacts-encrypted-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const trustedToken = await createAgentToken({
      app,
      cookie,
      label: "Trusted Artifact Agent",
      trustLevel: "trusted",
      scopes: [
        "artifact.create",
        "artifact.uploadBytes",
        "artifact.readMetadata",
        "artifact.updateMetadata"
      ]
    });
    const csv = "name,value\nsecret,42\n";
    const password = "operator sample passphrase";
    const upload = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers: { cookie },
      payload: {
        title: "Encrypted worksheet",
        originalFileName: "encrypted.csv",
        declaredMimeType: "text/csv",
        contentBase64: Buffer.from(csv, "utf8").toString("base64"),
        contentProtection: {
          mode: "password_encrypted",
          password,
          passwordHint: "sample hint"
        }
      }
    });
    assert.equal(upload.statusCode, 201);
    const uploadBody = upload.json() as {
      artifact: {
        id: string;
        contentSha256: string;
        storedContentSha256: string;
        byteSize: number;
        storedByteSize: number;
        contentProtection: {
          mode: string;
          passwordHint: string | null;
          kdfParams: {
            memlimit: number;
            opslimit: number;
            parallelism: number;
          };
        };
      };
    };
    assert.equal(
      uploadBody.artifact.contentProtection.mode,
      "password_encrypted"
    );
    assert.equal(
      uploadBody.artifact.contentProtection.passwordHint,
      "sample hint"
    );
    assert.equal(
      uploadBody.artifact.contentProtection.kdfParams.memlimit >=
        19 * 1024 * 1024,
      true
    );
    assert.equal(
      uploadBody.artifact.contentProtection.kdfParams.opslimit >= 2,
      true
    );
    assert.equal(
      uploadBody.artifact.contentProtection.kdfParams.parallelism,
      1
    );
    assert.notEqual(
      uploadBody.artifact.contentSha256,
      uploadBody.artifact.storedContentSha256
    );
    assert.ok(
      uploadBody.artifact.storedByteSize > uploadBody.artifact.byteSize
    );
    assert.equal(JSON.stringify(uploadBody).includes(password), false);
    assert.equal("storagePath" in uploadBody.artifact, false);
    assert.equal(
      (await readFile(getArtifactStoragePath(uploadBody.artifact.id))).equals(
        Buffer.from(csv, "utf8")
      ),
      false
    );

    const readMetadata = await app.inject({
      method: "GET",
      url: `/api/v1/artifacts/${uploadBody.artifact.id}`,
      headers: { authorization: `Bearer ${trustedToken}` }
    });
    assert.equal(readMetadata.statusCode, 200);
    assert.equal(
      (
        readMetadata.json() as {
          artifact: { contentProtection: { mode: string } };
        }
      ).artifact.contentProtection.mode,
      "password_encrypted"
    );
    assert.equal(readMetadata.body.includes(password), false);

    const tokenPasswordDownload = await app.inject({
      method: "POST",
      url: `/api/v1/artifacts/${uploadBody.artifact.id}/download`,
      headers: { authorization: `Bearer ${trustedToken}` },
      payload: { password }
    });
    assert.equal(tokenPasswordDownload.statusCode, 401);

    const getDownload = await app.inject({
      method: "GET",
      url: `/api/v1/artifacts/${uploadBody.artifact.id}/download`,
      headers: { cookie }
    });
    assert.equal(getDownload.statusCode, 409);
    assert.equal(
      (getDownload.json() as { code: string }).code,
      "artifact_password_required"
    );

    const missingPassword = await app.inject({
      method: "POST",
      url: `/api/v1/artifacts/${uploadBody.artifact.id}/download`,
      headers: { cookie },
      payload: {}
    });
    assert.equal(missingPassword.statusCode, 409);
    assert.equal(
      (missingPassword.json() as { code: string }).code,
      "artifact_password_required"
    );

    const wrongPassword = await app.inject({
      method: "POST",
      url: `/api/v1/artifacts/${uploadBody.artifact.id}/download`,
      headers: { cookie },
      payload: { password: "wrong sample passphrase" }
    });
    assert.equal(wrongPassword.statusCode, 403);
    assert.equal(
      (wrongPassword.json() as { code: string }).code,
      "artifact_wrong_password"
    );

    const correctPassword = await app.inject({
      method: "POST",
      url: `/api/v1/artifacts/${uploadBody.artifact.id}/download`,
      headers: { cookie },
      payload: { password }
    });
    assert.equal(correctPassword.statusCode, 200);
    assert.equal(correctPassword.body, csv);

    const rescan = await app.inject({
      method: "POST",
      url: `/api/v1/artifacts/${uploadBody.artifact.id}/scan`,
      headers: { cookie }
    });
    assert.equal(rescan.statusCode, 409);
    assert.equal(
      (rescan.json() as { code: string }).code,
      "artifact_content_encrypted"
    );

    const agentEncryptedUpload = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers: {
        authorization: `Bearer ${trustedToken}`,
        "x-forge-source": "agent",
        "x-forge-actor": "Trusted Artifact Agent"
      },
      payload: {
        originalFileName: "agent-secret.csv",
        contentBase64: Buffer.from(csv, "utf8").toString("base64"),
        contentProtection: { mode: "password_encrypted", password }
      }
    });
    assert.equal(agentEncryptedUpload.statusCode, 403);
    assert.equal(
      (agentEncryptedUpload.json() as { code: string }).code,
      "artifact_password_rejected_for_agent"
    );

    const plaintextUpload = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers: { cookie },
      payload: {
        title: "Plain worksheet",
        originalFileName: "plain.csv",
        declaredMimeType: "text/csv",
        contentBase64: Buffer.from(csv, "utf8").toString("base64")
      }
    });
    assert.equal(plaintextUpload.statusCode, 201);
    const plaintextId = (plaintextUpload.json() as { artifact: { id: string } })
      .artifact.id;
    const encryptExisting = await app.inject({
      method: "POST",
      url: `/api/v1/artifacts/${plaintextId}/encrypt`,
      headers: { cookie },
      payload: { password, passwordHint: "existing hint" }
    });
    assert.equal(encryptExisting.statusCode, 200);
    assert.equal(
      (
        encryptExisting.json() as {
          artifact: {
            contentProtection: { mode: string; passwordHint: string | null };
          };
        }
      ).artifact.contentProtection.mode,
      "password_encrypted"
    );
    assert.equal(
      (
        encryptExisting.json() as {
          artifact: { contentProtection: { passwordHint: string | null } };
        }
      ).artifact.contentProtection.passwordHint,
      "existing hint"
    );
    assert.equal(encryptExisting.body.includes(password), false);

    const doubleEncrypt = await app.inject({
      method: "POST",
      url: `/api/v1/artifacts/${plaintextId}/encrypt`,
      headers: { cookie },
      payload: { password }
    });
    assert.equal(doubleEncrypt.statusCode, 409);
    assert.equal(
      (doubleEncrypt.json() as { code: string }).code,
      "artifact_already_encrypted"
    );

    const audit = await app.inject({
      method: "GET",
      url: `/api/v1/artifacts/${plaintextId}/audit`,
      headers: { cookie }
    });
    assert.equal(audit.statusCode, 200);
    assert.equal(audit.body.includes(password), false);
    assert.ok(audit.body.includes("artifact.encrypted"));
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("artifact listing is paginated and keeps filters bounded for large stores", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-artifacts-scale-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    for (let index = 0; index < 65; index += 1) {
      const upload = await app.inject({
        method: "POST",
        url: "/api/v1/artifacts",
        headers: { cookie },
        payload: {
          title: `Scale fixture ${String(index).padStart(2, "0")}`,
          shortDescription: "Scale fixture artifact.",
          originalFileName: `scale-${index}.csv`,
          declaredMimeType: "text/csv",
          contentBase64: Buffer.from(
            `name,value\nrow,${index}\n`,
            "utf8"
          ).toString("base64"),
          sourceLabel: "Artifact scale fixture",
          links:
            index === 12
              ? [
                  {
                    entityType: "goal",
                    entityId: "goal_artifact_scale",
                    relationship: "evidence"
                  }
                ]
              : []
        }
      });
      assert.equal(upload.statusCode, 201);
    }

    const firstPage = await app.inject({
      method: "GET",
      url: "/api/v1/artifacts?query=Scale%20fixture&limit=25&offset=0",
      headers: { cookie }
    });
    assert.equal(firstPage.statusCode, 200);
    const firstBody = firstPage.json() as {
      artifacts: Array<{ id: string; links: unknown[] }>;
      total: number;
      limit: number;
      offset: number;
      hasMore: boolean;
    };
    assert.equal(firstBody.artifacts.length, 25);
    assert.equal(firstBody.total, 65);
    assert.equal(firstBody.limit, 25);
    assert.equal(firstBody.offset, 0);
    assert.equal(firstBody.hasMore, true);
    assert.ok(
      firstBody.artifacts.every((artifact) => Array.isArray(artifact.links))
    );

    const lastPage = await app.inject({
      method: "GET",
      url: "/api/v1/artifacts?query=Scale%20fixture&limit=25&offset=50",
      headers: { cookie }
    });
    assert.equal(lastPage.statusCode, 200);
    const lastBody = lastPage.json() as {
      artifacts: Array<{ id: string }>;
      total: number;
      limit: number;
      offset: number;
      hasMore: boolean;
    };
    assert.equal(lastBody.artifacts.length, 15);
    assert.equal(lastBody.total, 65);
    assert.equal(lastBody.limit, 25);
    assert.equal(lastBody.offset, 50);
    assert.equal(lastBody.hasMore, false);

    const linkedPage = await app.inject({
      method: "GET",
      url: "/api/v1/artifacts?linkedEntityType=goal&linkedEntityId=goal_artifact_scale&limit=10&offset=0",
      headers: { cookie }
    });
    assert.equal(linkedPage.statusCode, 200);
    const linkedBody = linkedPage.json() as {
      artifacts: Array<{
        id: string;
        links: Array<{ targetEntityId: string }>;
      }>;
      total: number;
      hasMore: boolean;
    };
    assert.equal(linkedBody.total, 1);
    assert.equal(linkedBody.artifacts.length, 1);
    assert.equal(linkedBody.hasMore, false);
    assert.equal(
      linkedBody.artifacts[0]?.links[0]?.targetEntityId,
      "goal_artifact_scale"
    );

    const oversizedLinkReplacement = await app.inject({
      method: "POST",
      url: `/api/v1/artifacts/${linkedBody.artifacts[0]?.id}/links`,
      headers: { cookie },
      payload: {
        links: Array.from({ length: 101 }, (_, index) => ({
          entityType: "note",
          entityId: `note_${index}`,
          relationship: "related"
        }))
      }
    });
    assert.equal(oversizedLinkReplacement.statusCode, 400);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("artifact repair migration restores shared entity_links for existing artifact databases and image upload", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-artifacts-repair-")
  );
  const databasePath = path.join(rootDir, "forge.sqlite");
  const initialApp = await buildServer({
    dataRoot: rootDir,
    seedDemoData: true
  });

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

  const repairedApp = await buildServer({
    dataRoot: rootDir,
    seedDemoData: true
  });
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
    assert.equal(
      uploadBody.artifact.links[0]?.targetEntityId,
      "project_forge_mobile"
    );

    const linkedList = await repairedApp.inject({
      method: "GET",
      url: "/api/v1/artifacts?linkedEntityType=project&linkedEntityId=project_forge_mobile",
      headers: { cookie }
    });
    assert.equal(linkedList.statusCode, 200);
    assert.ok(
      (
        linkedList.json() as { artifacts: Array<{ id: string }> }
      ).artifacts.some((artifact) => artifact.id === uploadBody.artifact.id)
    );
  } finally {
    await repairedApp.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";

type Schema = {
  additionalProperties?: boolean;
  default?: number;
  enum?: string[];
  maximum?: number;
  maxLength?: number;
  minimum?: number;
  minLength?: number;
  pattern?: string;
  properties?: Record<string, Schema>;
};

type Operation = {
  description?: string;
  parameters?: Array<{
    in?: string;
    name?: string;
    schema?: Schema;
  }>;
  responses?: Record<
    string,
    {
      headers?: Record<string, { schema?: Schema }>;
    }
  >;
};

test("OpenAPI publishes exact Artifact upload retry and queue bounds", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-artifact-upload-openapi-")
  );
  const app = await buildServer({ dataRoot, seedDemoData: false });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/openapi.json"
    });
    assert.equal(response.statusCode, 200);
    const document = response.json() as {
      components: { schemas: Record<string, Schema> };
      paths: Record<string, { get?: Operation; post?: Operation }>;
    };
    const upload = document.paths["/api/v1/artifacts"]?.post;
    const uploadInput = document.components.schemas.ArtifactUploadInput;
    const idempotencyHeader = upload?.parameters?.find(
      (parameter) => parameter.name === "Idempotency-Key"
    );
    const listLimit = document.paths[
      "/api/v1/artifacts"
    ]?.get?.parameters?.find((parameter) => parameter.name === "limit")?.schema;

    assert.equal(uploadInput?.additionalProperties, false);
    for (const schema of [
      uploadInput?.properties?.idempotencyKey,
      idempotencyHeader?.schema
    ]) {
      assert.equal(schema?.minLength, 8);
      assert.equal(schema?.maxLength, 200);
      assert.equal(schema?.pattern, "^[A-Za-z0-9._:-]+$");
    }
    assert.equal(idempotencyHeader?.in, "header");
    assert.equal(uploadInput?.properties?.contentBase64?.minLength, 4);
    assert.equal(
      uploadInput?.properties?.contentBase64?.pattern,
      "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
    );
    assert.deepEqual(
      [listLimit?.minimum, listLimit?.maximum, listLimit?.default],
      [1, 100, 100]
    );
    assert.deepEqual(
      upload?.responses?.["200"]?.headers?.["Idempotency-Replayed"]?.schema
        ?.enum,
      ["true"]
    );
    assert.deepEqual(
      upload?.responses?.["201"]?.headers?.["Idempotency-Replayed"]?.schema
        ?.enum,
      ["false"]
    );
    assert.ok(upload?.responses?.["409"]);
    assert.match(
      upload?.description ?? "",
      /identical plaintext.*separate metadata/i
    );
    assert.match(upload?.description ?? "", /trusted\/autonomous agent token/i);
    assert.match(
      upload?.description ?? "",
      /canonical owner.*actingForUserId.*uploadedByUserId.*single scoped user/i
    );
    assert.match(
      upload?.description ?? "",
      /encrypted replay.*password decrypts.*wrong password.*artifact_wrong_password/i
    );
    assert.match(
      upload?.description ?? "",
      /encrypted uploads.*independent randomized ciphertext representations/i
    );
    assert.match(upload?.description ?? "", /never returns.*byte locator/i);
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

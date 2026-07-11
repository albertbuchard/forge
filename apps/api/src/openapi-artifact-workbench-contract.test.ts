import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";

type JsonSchema = {
  $ref?: string;
  additionalProperties?: boolean;
  default?: number;
  enum?: unknown[];
  maxItems?: number;
  maxLength?: number;
  maximum?: number;
  minLength?: number;
  minimum?: number;
  properties?: Record<string, JsonSchema>;
  required?: string[];
};

type OpenApiOperation = {
  parameters?: Array<{ name?: string; schema?: JsonSchema }>;
  requestBody?: {
    content?: { "application/json"?: { schema?: JsonSchema } };
  };
  responses?: Record<
    string,
    { content?: { "application/json"?: { schema?: JsonSchema } } }
  >;
};

type OpenApiPath = {
  get?: OpenApiOperation;
  post?: OpenApiOperation;
  patch?: OpenApiOperation;
  delete?: OpenApiOperation;
  parameters?: Array<{ name?: string; schema?: JsonSchema }>;
};

test("OpenAPI matches artifact bounds and bounded history response contracts", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-openapi-artifact-workbench-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/openapi.json"
    });
    assert.equal(response.statusCode, 200);
    const document = response.json() as {
      components: { schemas: Record<string, JsonSchema> };
      paths: Record<string, OpenApiPath>;
    };
    const schemas = document.components.schemas;

    const metadataPatchProperties =
      schemas.ArtifactMetadataPatchInput?.properties ?? {};
    assert.equal(metadataPatchProperties.artifactState, undefined);
    assert.equal(metadataPatchProperties.downloadPolicy, undefined);
    assert.equal(metadataPatchProperties.links?.maxItems, 100);
    assert.equal(schemas.ArtifactUploadInput?.properties?.links?.maxItems, 100);

    const linkProperties = schemas.EntityLinkInput?.properties ?? {};
    assert.deepEqual(
      {
        entityType: [
          linkProperties.entityType?.minLength,
          linkProperties.entityType?.maxLength
        ],
        entityId: [
          linkProperties.entityId?.minLength,
          linkProperties.entityId?.maxLength
        ],
        anchorKey: linkProperties.anchorKey?.maxLength,
        relationship: linkProperties.relationship?.maxLength
      },
      {
        entityType: [1, 64],
        entityId: [1, 512],
        anchorKey: 256,
        relationship: 64
      }
    );

    const linkMutation = document.paths["/api/v1/artifacts/{id}/links"]?.post;
    assert.equal(
      linkMutation?.requestBody?.content?.["application/json"]?.schema
        ?.properties?.links?.maxItems,
      100
    );

    const versionPath = document.paths["/api/v1/artifacts/{id}/versions"];
    const versionOperation = versionPath?.get;
    const versionLimit = versionPath?.parameters?.find(
      (parameter) => parameter.name === "limit"
    )?.schema;
    assert.deepEqual(
      [versionLimit?.minimum, versionLimit?.maximum, versionLimit?.default],
      [1, 100, 50]
    );
    assert.equal(
      versionOperation?.responses?.["200"]?.content?.["application/json"]
        ?.schema?.$ref,
      "#/components/schemas/ArtifactVersionPage"
    );
    assert.deepEqual(schemas.ArtifactVersionPage?.required, [
      "versions",
      "total",
      "limit",
      "offset",
      "hasMore"
    ]);

    const auditOperation = document.paths["/api/v1/artifacts/{id}/audit"]?.get;
    assert.equal(
      auditOperation?.responses?.["200"]?.content?.["application/json"]?.schema
        ?.$ref,
      "#/components/schemas/ArtifactAuditEventPage"
    );

    const workbenchRuns =
      document.paths["/api/v1/workbench/flows/{id}/runs"]?.get;
    const workbenchLimit = workbenchRuns?.parameters?.find(
      (parameter) => parameter.name === "limit"
    )?.schema;
    assert.deepEqual(
      [
        workbenchLimit?.minimum,
        workbenchLimit?.maximum,
        workbenchLimit?.default
      ],
      [1, 100, 20]
    );
    assert.equal(
      workbenchRuns?.responses?.["200"]?.content?.["application/json"]?.schema
        ?.$ref,
      "#/components/schemas/WorkbenchRunPage"
    );
    assert.deepEqual(schemas.WorkbenchRunPage?.required, [
      "runs",
      "total",
      "limit",
      "offset",
      "hasMore"
    ]);
    assert.equal(schemas.WorkbenchRun?.additionalProperties, false);
    assert.ok(schemas.WorkbenchRun?.required?.includes("connectorId"));

    const flowDetail = document.paths["/api/v1/workbench/flows/{id}"]?.get;
    const flowDetailSchema =
      flowDetail?.responses?.["200"]?.content?.["application/json"]?.schema;
    assert.ok(flowDetailSchema?.required?.includes("total"));
    assert.ok(flowDetailSchema?.required?.includes("conversation"));

    const nodeList =
      document.paths["/api/v1/workbench/flows/{id}/runs/{runId}/nodes"]?.get;
    const nodeListSchema =
      nodeList?.responses?.["200"]?.content?.["application/json"]?.schema;
    assert.deepEqual(nodeListSchema?.required, ["flow", "nodeResults"]);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

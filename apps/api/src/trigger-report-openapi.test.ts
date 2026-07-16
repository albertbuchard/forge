import assert from "node:assert/strict";
import test from "node:test";

import { buildOpenApiDocument } from "./openapi.js";

type Operation = {
  parameters?: Array<{
    name?: string;
    in?: string;
    schema?: Record<string, unknown>;
  }>;
  requestBody?: {
    content?: {
      "application/json"?: { schema?: { $ref?: string } };
    };
  };
  responses?: Record<string, unknown>;
};

test("trigger report OpenAPI exposes bounded pages and exact mutation contracts", () => {
  const document = buildOpenApiDocument() as unknown as {
    paths: Record<string, Record<string, Operation>>;
    components: { schemas: Record<string, Record<string, unknown>> };
  };
  const collection = document.paths["/api/v1/psyche/reports"];
  const detail = document.paths["/api/v1/psyche/reports/{id}"];

  assert.ok(collection);
  assert.ok(detail);
  assert.deepEqual(
    collection.get.parameters?.map(({ name, in: location }) => [
      name,
      location
    ]),
    [
      ["limit", "query"],
      ["cursor", "query"],
      ["userId", "query"],
      ["userIds", "query"]
    ]
  );
  assert.equal(
    collection.post.requestBody?.content?.["application/json"]?.schema?.$ref,
    "#/components/schemas/TriggerReportCreateInput"
  );
  assert.equal(
    collection.post.parameters?.find(
      (parameter) => parameter.name === "Idempotency-Key"
    )?.schema?.maxLength,
    128
  );
  assert.ok(collection.post.responses?.["409"]);
  assert.equal(
    detail.patch.requestBody?.content?.["application/json"]?.schema?.$ref,
    "#/components/schemas/TriggerReportPatchInput"
  );
  assert.ok(detail.patch.responses?.["409"]);
  assert.ok(detail.get.responses?.["404"]);
  assert.ok(detail.delete.responses?.["404"]);

  const report = document.components.schemas.TriggerReport;
  const reportRequired = report.required as string[];
  for (const field of [
    "bodyCues",
    "memoryClarity",
    "reflection",
    "hypothesis",
    "hypothesisFit",
    "hypothesisCorrection",
    "interpretationConsent",
    "revision",
    "userId",
    "user",
    "ownerUserId",
    "ownerUser",
    "assigneeUserIds",
    "assignees"
  ]) {
    assert.ok(reportRequired.includes(field), field);
  }

  const createInput = document.components.schemas.TriggerReportCreateInput;
  assert.equal(createInput.additionalProperties, false);
  assert.deepEqual(createInput.required, ["title"]);
  const createProperties = createInput.properties as Record<
    string,
    Record<string, unknown>
  >;
  assert.deepEqual(createProperties.memoryClarity?.enum, [
    "unspecified",
    "clear",
    "partial",
    "uncertain"
  ]);
  assert.equal(createProperties.memoryClarity?.default, "unspecified");
  const patchInput = document.components.schemas.TriggerReportPatchInput;
  assert.equal(patchInput.additionalProperties, false);
  assert.deepEqual(patchInput.required, ["expectedRevision"]);
  const page = document.components.schemas.TriggerReportPage;
  assert.deepEqual(page.required, [
    "reports",
    "total",
    "limit",
    "nextCursor",
    "hasMore"
  ]);
});

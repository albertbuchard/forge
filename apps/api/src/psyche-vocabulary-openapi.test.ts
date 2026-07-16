import assert from "node:assert/strict";
import test from "node:test";
import { buildOpenApiDocument } from "./openapi.js";

test("PSY-09 OpenAPI publishes exact vocabulary schemas and route semantics", () => {
  const document = buildOpenApiDocument() as {
    components: { schemas: Record<string, Record<string, unknown>> };
    paths: Record<
      string,
      Record<
        string,
        {
          description?: string;
          parameters?: Array<{ name?: string }>;
          requestBody?: {
            content?: Record<string, { schema?: { $ref?: string } }>;
          };
          responses?: Record<string, unknown>;
        }
      >
    >;
  };

  for (const schemaName of ["EventType", "EmotionDefinition"]) {
    const schema = document.components.schemas[schemaName] as {
      additionalProperties?: boolean;
      required?: string[];
      properties?: Record<string, unknown>;
    };
    assert.equal(schema.additionalProperties, false);
    for (const field of [
      "userId",
      "user",
      "ownerUserId",
      "ownerUser",
      "assigneeUserIds",
      "assignees"
    ]) {
      assert.ok(schema.required?.includes(field), `${schemaName}.${field}`);
      assert.ok(schema.properties?.[field], `${schemaName}.${field}`);
    }
    assert.match(
      (schema.properties?.userId as { description?: string } | undefined)
        ?.description ?? "",
      /Effective owner.*Built-in.*null/i
    );
  }

  for (const schemaName of [
    "EventTypeCreateInput",
    "EventTypePatchInput",
    "EmotionDefinitionCreateInput",
    "EmotionDefinitionPatchInput"
  ]) {
    const schema = document.components.schemas[schemaName] as {
      additionalProperties?: boolean;
      properties?: Record<string, unknown>;
    };
    assert.equal(schema.additionalProperties, false, schemaName);
    assert.equal(schema.properties?.aliases, undefined, schemaName);
    assert.ok(schema.properties?.userId, `${schemaName}.userId`);
  }

  const batchCreate = document.components.schemas.BatchCreateEntitiesInput as {
    properties?: {
      operations?: {
        items?: {
          properties?: Record<string, { description?: string }>;
        };
      };
    };
  };
  assert.match(
    batchCreate.properties?.operations?.items?.properties?.idempotencyKey
      ?.description ?? "",
    /Stable key.*exact retry.*hard deletion/i
  );
  const batchSearch = document.components.schemas.BatchSearchEntitiesInput as {
    properties?: {
      searches?: {
        items?: {
          properties?: Record<string, { description?: string }>;
        };
      };
    };
  };
  assert.match(
    batchSearch.properties?.searches?.items?.properties?.userIds?.description ??
      "",
    /effective owner scope.*built-ins remain visible/i
  );

  const routeCases = [
    {
      collection: "/api/v1/psyche/event-types",
      detail: "/api/v1/psyche/event-types/{id}",
      createSchema: "#/components/schemas/EventTypeCreateInput",
      patchSchema: "#/components/schemas/EventTypePatchInput"
    },
    {
      collection: "/api/v1/psyche/emotions",
      detail: "/api/v1/psyche/emotions/{id}",
      createSchema: "#/components/schemas/EmotionDefinitionCreateInput",
      patchSchema: "#/components/schemas/EmotionDefinitionPatchInput"
    }
  ];
  for (const routeCase of routeCases) {
    const collection = document.paths[routeCase.collection];
    const detail = document.paths[routeCase.detail];
    assert.ok(collection?.get?.description?.includes("batch"));
    assert.match(collection?.get?.description ?? "", /requires psyche\.read/i);
    assert.ok(
      collection?.post?.description?.includes("Built-ins remain read-only")
    );
    assert.match(
      collection?.post?.description ?? "",
      /requires psyche\.write.*NFKC default case folding/is
    );
    assert.ok(collection?.post?.description?.includes("Idempotency-Key"));
    for (const errorCode of [
      "psyche_vocabulary_duplicate",
      "psyche_vocabulary_label_in_bin",
      "idempotency_conflict",
      "psyche_vocabulary_idempotency_target_in_bin",
      "psyche_vocabulary_idempotency_target_deleted"
    ]) {
      assert.ok(
        collection?.post?.description?.includes(errorCode),
        `${routeCase.collection} ${errorCode}`
      );
    }
    assert.equal(
      collection?.post?.requestBody?.content?.["application/json"]?.schema
        ?.$ref,
      routeCase.createSchema
    );
    assert.ok(
      collection?.post?.parameters?.some(
        (item) => item.name === "Idempotency-Key"
      )
    );
    assert.ok(collection?.post?.responses?.["409"]);
    assert.ok(detail?.get?.parameters?.some((item) => item.name === "id"));
    assert.match(detail?.get?.description ?? "", /requires psyche\.read/i);
    assert.equal(
      detail?.patch?.requestBody?.content?.["application/json"]?.schema?.$ref,
      routeCase.patchSchema
    );
    assert.match(
      detail?.patch?.description ?? "",
      /(stored event wording|raw emotion label)/
    );
    assert.match(detail?.patch?.description ?? "", /requires psyche\.write/i);
    assert.ok(
      detail?.delete?.description?.includes("Built-ins cannot be deleted")
    );
    assert.ok(detail?.delete?.parameters?.some((item) => item.name === "mode"));
    assert.ok(detail?.delete?.responses?.["409"]);
    assert.match(
      detail?.delete?.description ?? "",
      /hard deletion.*permanently consumes.*psyche_vocabulary_idempotency_target_deleted/is
    );
  }

  const batchScopeCases = [
    ["/api/v1/entities/search", /base read or write.*psyche\.read/is],
    ["/api/v1/entities/create", /base write.*psyche\.write/is],
    ["/api/v1/entities/update", /base write.*psyche\.write/is],
    ["/api/v1/entities/delete", /base write.*psyche\.write/is],
    ["/api/v1/entities/restore", /base write.*psyche\.write/is]
  ] as const;
  for (const [path, expectation] of batchScopeCases) {
    assert.match(document.paths[path]?.post?.description ?? "", expectation);
    assert.ok(document.paths[path]?.post?.responses?.["403"]);
  }
});

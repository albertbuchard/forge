import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildOpenApiDocument } from "./openapi.js";
import {
  createPreferenceContextSchema,
  createPreferenceItemSchema,
  enqueueEntityPreferenceItemSchema,
  mergePreferenceContextsSchema,
  startPreferenceGameSchema,
  submitAbsoluteSignalSchema,
  updatePreferenceScoreSchema,
  updatePreferenceCatalogItemSchema,
  updatePreferenceCatalogSchema
} from "./preferences-types.js";

test("OpenAPI publishes the precise preference catalog contract and lifecycle", () => {
  type CatalogSchema = {
    additionalProperties?: boolean;
    required?: string[];
    properties: Record<string, unknown>;
  };
  type CatalogOpenApiDocument = {
    components: { schemas: Record<string, CatalogSchema> };
    paths: {
      "/api/v1/preferences/catalogs": {
        get: {
          parameters: Array<{
            name: string;
            schema: {
              maximum?: number;
              default?: number;
              maxLength?: number;
            };
          }>;
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    required: string[];
                    properties: Record<string, unknown>;
                  };
                };
              };
            };
          };
        };
        post: {
          requestBody: {
            content: { "application/json": { schema: { $ref: string } } };
          };
        };
      };
      "/api/v1/preferences/catalogs/{id}": {
        delete: { description: string };
      };
      "/api/v1/preferences/catalog-items": {
        get: {
          parameters: Array<{
            name: string;
            schema: {
              maximum?: number;
              default?: number;
              maxLength?: number;
            };
          }>;
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    required: string[];
                    properties: Record<string, unknown>;
                  };
                };
              };
            };
          };
        };
        post: {
          requestBody: {
            content: { "application/json": { schema: { $ref: string } } };
          };
        };
      };
      "/api/v1/preferences/catalog-items/{id}": {
        get: {
          parameters: Array<{ in: string; name: string; required: boolean }>;
        };
        patch: {
          requestBody: {
            content: { "application/json": { schema: { $ref: string } } };
          };
        };
        delete: { description: string };
      };
    };
  };
  const document = buildOpenApiDocument() as unknown as CatalogOpenApiDocument;
  const schemas = document.components.schemas;
  const create = schemas.PreferenceCatalogCreateInput;
  const catalog = schemas.PreferenceCatalog;
  const item = schemas.PreferenceCatalogItem;
  const itemCreate = schemas.PreferenceCatalogItemCreateInput;
  const itemPatch = schemas.PreferenceCatalogItemPatchInput;
  assert.equal(create.additionalProperties, false);
  assert.deepEqual(create.required, ["userId", "domain", "title"]);
  for (const field of ["scopeIn", "scopeOut", "links"]) {
    assert.ok(create.properties[field]);
    assert.ok(catalog.properties[field]);
  }
  for (const field of [
    "userId",
    "createdSource",
    "createdByActor",
    "archived"
  ]) {
    assert.ok(catalog.properties[field]);
  }
  for (const field of ["itemCount", "itemsTruncated"]) {
    assert.ok(catalog.required?.includes(field));
    assert.ok(catalog.properties[field]);
  }
  assert.equal(item.additionalProperties, false);
  assert.deepEqual(itemCreate.required, ["catalogId", "label"]);
  assert.equal(itemPatch.additionalProperties, false);
  assert.equal(itemPatch.properties.catalogId, undefined);
  assert.deepEqual(updatePreferenceCatalogSchema.parse({}), {});
  assert.deepEqual(updatePreferenceCatalogItemSchema.parse({}), {});
  for (const field of ["description", "tags", "featureWeights"]) {
    assert.equal(
      (itemPatch.properties[field] as { default?: unknown }).default,
      undefined
    );
  }
  assert.equal(
    (
      schemas.PreferenceCatalogPatchInput.properties.links as {
        default?: unknown;
      }
    ).default,
    undefined
  );
  for (const field of [
    "id",
    "catalogId",
    "label",
    "description",
    "tags",
    "featureWeights",
    "position",
    "archived",
    "createdAt",
    "updatedAt"
  ]) {
    assert.ok(item.required?.includes(field));
    assert.ok(item.properties[field]);
  }
  assert.equal(
    document.paths["/api/v1/preferences/catalogs"].post.requestBody.content[
      "application/json"
    ].schema.$ref,
    "#/components/schemas/PreferenceCatalogCreateInput"
  );
  assert.match(
    document.paths["/api/v1/preferences/catalogs/{id}"].delete.description,
    /idempotently[\s\S]*reversible settings bin/i
  );
  const catalogGet = document.paths["/api/v1/preferences/catalogs"].get;
  const catalogLimit = catalogGet.parameters.find(
    (parameter) => parameter.name === "limit"
  );
  assert.equal(catalogLimit?.schema.maximum, 100);
  assert.equal(catalogLimit?.schema.default, 24);
  assert.ok(
    catalogGet.parameters.some((parameter) => parameter.name === "domain")
  );
  assert.deepEqual(
    catalogGet.responses["200"].content["application/json"].schema.required,
    [
      "catalogs",
      "limit",
      "offset",
      "hasMore",
      "nextOffset",
      "previousOffset",
      "snapshotAt",
      "nextCursor"
    ]
  );
  assert.equal(
    catalogGet.parameters.find((parameter) => parameter.name === "cursor")
      ?.schema.maxLength,
    2048
  );

  const itemRoutes = document.paths["/api/v1/preferences/catalog-items"];
  const itemLimit = itemRoutes.get.parameters.find(
    (parameter) => parameter.name === "limit"
  );
  assert.equal(itemLimit?.schema.maximum, 200);
  assert.equal(itemLimit?.schema.default, 24);
  assert.equal(
    itemRoutes.get.parameters.find((parameter) => parameter.name === "cursor")
      ?.schema.maxLength,
    2048
  );
  assert.deepEqual(
    itemRoutes.get.responses["200"].content["application/json"].schema.required,
    [
      "items",
      "limit",
      "offset",
      "hasMore",
      "nextOffset",
      "previousOffset",
      "snapshotAt",
      "nextCursor"
    ]
  );
  assert.equal(
    itemRoutes.post.requestBody.content["application/json"].schema.$ref,
    "#/components/schemas/PreferenceCatalogItemCreateInput"
  );
  const itemDetail = document.paths["/api/v1/preferences/catalog-items/{id}"];
  assert.deepEqual(itemDetail.get.parameters[0], {
    in: "path",
    name: "id",
    required: true,
    schema: { type: "string", minLength: 1 }
  });
  assert.equal(
    itemDetail.patch.requestBody.content["application/json"].schema.$ref,
    "#/components/schemas/PreferenceCatalogItemPatchInput"
  );
  assert.match(
    itemDetail.delete.description,
    /reversible settings bin[\s\S]*ownership[\s\S]*links/i
  );
});

test("OpenAPI closes preference judgment and signal response schemas", () => {
  const document = buildOpenApiDocument() as unknown as {
    components: {
      schemas: Record<
        string,
        {
          additionalProperties: boolean;
          required: string[];
          properties: Record<string, unknown>;
        }
      >;
    };
    paths: Record<
      string,
      {
        post: {
          responses: {
            "201": {
              content: {
                "application/json": {
                  schema: {
                    properties: Record<string, { $ref: string }>;
                  };
                };
              };
            };
          };
        };
      }
    >;
  };
  const judgmentReference =
    document.paths["/api/v1/preferences/judgments"]!.post.responses["201"]
      .content["application/json"].schema.properties.judgment!;
  const signalReference =
    document.paths["/api/v1/preferences/signals"]!.post.responses["201"]
      .content["application/json"].schema.properties.signal!;
  const scoreReference =
    document.paths["/api/v1/preferences/signals"]!.post.responses["201"]
      .content["application/json"].schema.properties.score!;
  const judgment =
    document.components.schemas[judgmentReference.$ref.split("/").at(-1)!]!;
  const signal =
    document.components.schemas[signalReference.$ref.split("/").at(-1)!]!;
  const score =
    document.components.schemas[scoreReference.$ref.split("/").at(-1)!]!;

  assert.equal(judgment.additionalProperties, false);
  assert.equal(signal.additionalProperties, false);
  assert.equal(score.additionalProperties, false);
  for (const field of ["source", "userId", "contextId", "createdAt"]) {
    assert.ok(judgment.required.includes(field));
    assert.ok(judgment.properties[field]);
  }
  for (const field of [
    "ownerUserId",
    "actor",
    "modelWeight",
    "source",
    "signalType"
  ]) {
    assert.ok(signal.required.includes(field));
    assert.ok(signal.properties[field]);
  }
  assert.ok(score.required.includes("effectiveSignal"));
  assert.ok(score.properties.effectiveSignal);
});

test("OpenAPI publishes a closed and complete Preferences route inventory", () => {
  type Schema = {
    type?: string;
    $ref?: string;
    additionalProperties?: boolean;
    required?: string[];
    nullable?: boolean;
    anyOf?: Schema[];
    maximum?: number;
    default?: number;
    properties?: Record<string, Schema>;
  };
  type Operation = {
    parameters?: Array<{
      in: string;
      name: string;
      required?: boolean;
      schema: Schema;
    }>;
    requestBody?: {
      content: { "application/json": { schema: Schema } };
    };
    responses: Record<
      string,
      { content?: { "application/json"?: { schema: Schema } } }
    >;
  };
  const document = buildOpenApiDocument() as unknown as {
    components: { schemas: Record<string, Schema> };
    paths: Record<
      string,
      Partial<Record<"get" | "post" | "patch" | "delete", Operation>>
    >;
  };
  const resolveSchema = (schema: Schema) =>
    schema.$ref
      ? document.components.schemas[schema.$ref.split("/").at(-1)!]!
      : schema;
  const expected = {
    "/api/v1/preferences/workspace": ["get"],
    "/api/v1/preferences/workspace/refresh": ["post"],
    "/api/v1/preferences/game/start": ["post"],
    "/api/v1/preferences/catalogs": ["get", "post"],
    "/api/v1/preferences/catalogs/{id}": ["get", "patch", "delete"],
    "/api/v1/preferences/catalog-items": ["get", "post"],
    "/api/v1/preferences/catalog-items/{id}": ["get", "patch", "delete"],
    "/api/v1/preferences/contexts": ["get", "post"],
    "/api/v1/preferences/contexts/{id}": ["get", "patch", "delete"],
    "/api/v1/preferences/contexts/merge": ["post"],
    "/api/v1/preferences/items": ["get", "post"],
    "/api/v1/preferences/items/{id}": ["get", "patch", "delete"],
    "/api/v1/preferences/items/from-entity": ["post"],
    "/api/v1/preferences/judgments": ["post"],
    "/api/v1/preferences/signals": ["post"],
    "/api/v1/preferences/items/{id}/score": ["patch"]
  } as const;
  const expectedErrorStatuses = {
    "/api/v1/preferences/workspace": {
      get: ["400", "401", "403", "404", "500"]
    },
    "/api/v1/preferences/workspace/refresh": {
      post: ["400", "401", "403", "404", "500"]
    },
    "/api/v1/preferences/game/start": {
      post: ["400", "401", "403", "404", "500"]
    },
    "/api/v1/preferences/catalogs": {
      get: ["400", "401", "403", "500"],
      post: ["400", "401", "403", "404", "409", "500"]
    },
    "/api/v1/preferences/catalogs/{id}": {
      get: ["401", "403", "404", "500"],
      patch: ["400", "401", "403", "404", "409", "500"],
      delete: ["401", "403", "404", "500"]
    },
    "/api/v1/preferences/catalog-items": {
      get: ["400", "401", "403", "500"],
      post: ["400", "401", "403", "404", "409", "500"]
    },
    "/api/v1/preferences/catalog-items/{id}": {
      get: ["401", "403", "404", "500"],
      patch: ["400", "401", "403", "404", "409", "500"],
      delete: ["401", "403", "404", "500"]
    },
    "/api/v1/preferences/contexts": {
      get: ["400", "401", "403", "500"],
      post: ["400", "401", "403", "404", "500"]
    },
    "/api/v1/preferences/contexts/{id}": {
      get: ["401", "403", "404", "500"],
      patch: ["400", "401", "403", "404", "500"],
      delete: ["400", "401", "403", "404", "500"]
    },
    "/api/v1/preferences/contexts/merge": {
      post: ["400", "401", "403", "404", "500"]
    },
    "/api/v1/preferences/items": {
      get: ["400", "401", "403", "500"],
      post: ["400", "401", "403", "404", "409", "500"]
    },
    "/api/v1/preferences/items/{id}": {
      get: ["401", "403", "404", "500"],
      patch: ["400", "401", "403", "404", "409", "500"],
      delete: ["401", "403", "404", "500"]
    },
    "/api/v1/preferences/items/from-entity": {
      post: ["400", "401", "403", "404", "500"]
    },
    "/api/v1/preferences/judgments": {
      post: ["400", "401", "403", "404", "409", "500"]
    },
    "/api/v1/preferences/signals": {
      post: ["400", "401", "403", "404", "500"]
    },
    "/api/v1/preferences/items/{id}/score": {
      patch: ["400", "401", "403", "404", "500"]
    }
  } as const;
  const actual = Object.fromEntries(
    Object.entries(document.paths)
      .filter(([route]) => route.startsWith("/api/v1/preferences/"))
      .map(([route, operations]) => [
        route,
        Object.keys(operations).filter((method) =>
          ["get", "post", "patch", "delete"].includes(method)
        )
      ])
  );
  assert.deepEqual(actual, expected);

  for (const [route, methods] of Object.entries(expected)) {
    for (const method of methods) {
      const operation = document.paths[route]![method]!;
      const expectedStatuses = (
        expectedErrorStatuses[
          route as keyof typeof expectedErrorStatuses
        ] as Record<string, readonly string[]>
      )[method]!;
      assert.deepEqual(
        Object.keys(operation.responses)
          .filter((status) => !status.startsWith("2"))
          .sort(),
        [...expectedStatuses].sort(),
        `${method.toUpperCase()} ${route} must publish exact error statuses`
      );
      if (route.includes("{id}")) {
        assert.ok(
          operation.parameters?.some(
            (parameter) =>
              parameter.in === "path" &&
              parameter.name === "id" &&
              parameter.required === true
          ),
          `${method.toUpperCase()} ${route} must publish its id path parameter`
        );
      }
      if (operation.requestBody) {
        const requestSchema = resolveSchema(
          operation.requestBody.content["application/json"].schema
        );
        assert.equal(
          requestSchema.additionalProperties,
          false,
          `${method.toUpperCase()} ${route} request must reject unknown fields`
        );
      }
      for (const [status, response] of Object.entries(operation.responses)) {
        if (
          !status.startsWith("2") ||
          !response.content?.["application/json"]
        ) {
          continue;
        }
        assert.equal(
          resolveSchema(response.content["application/json"].schema)
            .additionalProperties,
          false,
          `${method.toUpperCase()} ${route} ${status} response must be closed`
        );
      }
    }
  }

  const workspaceParameters =
    document.paths["/api/v1/preferences/workspace"]!.get!.parameters!;
  assert.deepEqual(
    workspaceParameters.find((parameter) => parameter.name === "itemLimit")
      ?.schema,
    { type: "integer", minimum: 1, maximum: 100, default: 50 }
  );
  assert.deepEqual(
    workspaceParameters.find((parameter) => parameter.name === "itemOffset")
      ?.schema,
    { type: "integer", minimum: 0, default: 0 }
  );
  assert.deepEqual(
    workspaceParameters.find((parameter) => parameter.name === "historyLimit")
      ?.schema,
    { type: "integer", minimum: 1, maximum: 100, default: 50 }
  );
  const judgmentIdempotency = document.paths[
    "/api/v1/preferences/judgments"
  ]!.post!.parameters!.find(
    (parameter) => parameter.name === "Idempotency-Key"
  );
  assert.equal(judgmentIdempotency?.in, "header");
  assert.equal(judgmentIdempotency?.required, false);
  assert.equal(
    (judgmentIdempotency?.schema as Schema & { maxLength?: number }).maxLength,
    128
  );
  const scorePatch = document.components.schemas.PreferenceScorePatchInput!;
  for (const field of ["manualStatus", "manualScore", "confidenceLock"]) {
    assert.ok(
      scorePatch.properties?.[field]?.anyOf?.some(
        (variant) => variant.type === "null"
      )
    );
  }
});

test("Preferences body validators reject fields omitted from the closed OpenAPI contract", () => {
  const cases: Array<{
    schema: { parse: (input: unknown) => unknown };
    input: Record<string, unknown>;
  }> = [
    {
      schema: createPreferenceContextSchema,
      input: { userId: "user_operator", domain: "projects", name: "Work" }
    },
    {
      schema: mergePreferenceContextsSchema,
      input: { sourceContextId: "context_a", targetContextId: "context_b" }
    },
    {
      schema: createPreferenceItemSchema,
      input: { userId: "user_operator", domain: "projects", label: "Choice" }
    },
    {
      schema: enqueueEntityPreferenceItemSchema,
      input: {
        userId: "user_operator",
        domain: "projects",
        entityType: "goal",
        entityId: "goal_1"
      }
    },
    {
      schema: submitAbsoluteSignalSchema,
      input: {
        userId: "user_operator",
        domain: "projects",
        contextId: "context_1",
        itemId: "item_1",
        signalType: "favorite"
      }
    },
    {
      schema: updatePreferenceScoreSchema,
      input: {
        userId: "user_operator",
        domain: "projects",
        contextId: "context_1",
        manualScore: null
      }
    },
    {
      schema: startPreferenceGameSchema,
      input: { userId: "user_operator", domain: "projects" }
    }
  ];
  for (const { schema, input } of cases) {
    assert.throws(() => schema.parse({ ...input, unknownField: true }));
  }
});

test("Preferences documentation names the actual shared batch routes", async () => {
  const documentation = await readFile(
    new URL("../../../docs/reference/preferences-system.md", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(documentation, /\/api\/v1\/entities\/batch\//);
  for (const operation of ["create", "update", "delete", "restore", "search"]) {
    assert.match(documentation, new RegExp(`/api/v1/entities/${operation}`));
  }
});

test("Preferences docs and plugin skills publish the reversible concept lifecycle", async () => {
  const documentation = await readFile(
    new URL("../../../docs/reference/preferences-system.md", import.meta.url),
    "utf8"
  );
  const hermesSource = await readFile(
    new URL("../../../plugins/hermes/skill.md", import.meta.url),
    "utf8"
  );
  const hermesPackagedSource = await readFile(
    new URL("../../../plugins/hermes/forge_hermes/skill.md", import.meta.url),
    "utf8"
  );
  const openClawSource = await readFile(
    new URL(
      "../../../plugins/openclaw/skills/forge-openclaw/SKILL.md",
      import.meta.url
    ),
    "utf8"
  );
  assert.equal(hermesPackagedSource, hermesSource);
  for (const source of [hermesSource, openClawSource]) {
    assert.match(
      source,
      /Preference catalogs and catalog items move to the reversible Settings Bin/
    );
    assert.match(
      source,
      /contexts and standalone preference items delete immediately/
    );
    assert.doesNotMatch(source, /catalog items delete immediately/i);
  }
  for (const route of [
    "/api/v1/preferences/workspace",
    "/api/v1/preferences/workspace/refresh",
    "/api/v1/preferences/game/start",
    "/api/v1/preferences/catalogs",
    "/api/v1/preferences/catalog-items",
    "/api/v1/preferences/contexts",
    "/api/v1/preferences/contexts/merge",
    "/api/v1/preferences/items",
    "/api/v1/preferences/items/from-entity",
    "/api/v1/preferences/judgments",
    "/api/v1/preferences/signals",
    "/api/v1/preferences/items/:id/score"
  ]) {
    assert.match(documentation, new RegExp(route.replaceAll("/", "\\/")));
  }
});

test("OpenAPI publishes the exact batch entity request bounds and retry contract", () => {
  type Schema = {
    minItems?: number;
    maxItems?: number;
    maximum?: number;
    properties?: Record<string, Schema>;
    items?: Schema;
    $ref?: string;
  };
  type BatchOpenApiDocument = {
    components: { schemas: Record<string, Schema> };
    paths: Record<
      string,
      {
        post: {
          requestBody: {
            content: { "application/json": { schema: { $ref: string } } };
          };
        };
      }
    >;
  };
  const document = buildOpenApiDocument() as unknown as BatchOpenApiDocument;
  const expected = {
    create: ["BatchCreateEntitiesInput", "operations", 100],
    update: ["BatchUpdateEntitiesInput", "operations", 100],
    delete: ["BatchDeleteEntitiesInput", "operations", 100],
    restore: ["BatchRestoreEntitiesInput", "operations", 100],
    search: ["BatchSearchEntitiesInput", "searches", 50]
  } as const;

  for (const [operation, [schemaName, arrayName, maxItems]] of Object.entries(
    expected
  )) {
    const schema = document.components.schemas[schemaName];
    const operations = schema?.properties?.[arrayName];
    assert.equal(operations?.minItems, 1);
    assert.equal(operations?.maxItems, maxItems);
    assert.equal(
      document.paths[`/api/v1/entities/${operation}`]?.post.requestBody.content[
        "application/json"
      ].schema.$ref,
      `#/components/schemas/${schemaName}`
    );
  }

  const createOperation =
    document.components.schemas.BatchCreateEntitiesInput?.properties?.operations
      ?.items;
  assert.equal(
    createOperation?.properties?.idempotencyKey?.maxItems,
    undefined
  );
  assert.equal(
    (
      createOperation?.properties?.idempotencyKey as Schema & {
        maxLength?: number;
      }
    )?.maxLength,
    128
  );
  assert.equal(
    document.components.schemas.BatchSearchEntitiesInput?.properties?.searches
      ?.items?.properties?.limit?.maximum,
    200
  );
});

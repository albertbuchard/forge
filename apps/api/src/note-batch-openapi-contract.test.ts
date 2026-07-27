import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";
import { buildOpenApiDocument } from "./openapi.js";

type OpenApiSchema = {
  $ref?: string;
  additionalProperties?: boolean | OpenApiSchema;
  const?: unknown;
  description?: string;
  enum?: unknown[];
  examples?: unknown[];
  items?: OpenApiSchema;
  oneOf?: OpenApiSchema[];
  anyOf?: OpenApiSchema[];
  allOf?: OpenApiSchema[];
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
  title?: string;
  type?: string;
};

type OpenApiDocument = {
  components: {
    schemas: Record<string, OpenApiSchema>;
  };
  paths: Record<
    string,
    {
      post?: {
        responses?: Record<
          string,
          {
            description?: string;
            content?: {
              "application/json"?: {
                schema?: OpenApiSchema;
              };
            };
          }
        >;
      };
    }
  >;
};

function resultItemRef(document: OpenApiDocument, route: string) {
  const responseSchema =
    document.paths[route]?.post?.responses?.["200"]?.content?.[
      "application/json"
    ]?.schema;
  return responseSchema?.properties?.results?.items?.$ref;
}

function assertRuntimeResponseMatches(
  document: OpenApiDocument,
  route: string,
  payload: unknown
) {
  const responseSchema =
    document.paths[route]?.post?.responses?.["200"]?.content?.[
      "application/json"
    ]?.schema;
  assert.ok(responseSchema, `missing 200 response schema for ${route}`);
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateFormats: false
  });
  const validate = ajv.compile({
    ...responseSchema,
    components: document.components
  });
  assert.equal(
    validate(payload),
    true,
    `${route} response does not match OpenAPI: ${ajv.errorsText(
      validate.errors,
      {
        separator: "\n"
      }
    )}`
  );
}

const issueOperatorSessionCookie = issueTestOperatorSessionCookie;

test("batch routes publish distinct mutation and search result contracts", () => {
  const document = buildOpenApiDocument() as unknown as OpenApiDocument;
  const mutationRoutes = [
    "/api/v1/entities/create",
    "/api/v1/entities/update",
    "/api/v1/entities/delete",
    "/api/v1/entities/restore"
  ];

  for (const route of mutationRoutes) {
    assert.equal(
      resultItemRef(document, route),
      "#/components/schemas/BatchEntityMutationResult"
    );
    const description =
      document.paths[route]?.post?.responses?.["200"]?.description ?? "";
    assert.match(description, /earlier.*rolled_back.*undone/i);
    assert.match(description, /later.*skipped.*not_executed/i);
    assert.match(description, /failing operation keeps its original error/i);
  }

  assert.equal(
    resultItemRef(document, "/api/v1/entities/search"),
    "#/components/schemas/BatchEntitySearchResult"
  );
  assert.equal(document.components.schemas.BatchEntityResult, undefined);
});

test("batch result components match runtime success, failure, and search shapes", () => {
  const document = buildOpenApiDocument() as unknown as OpenApiDocument;
  const schemas = document.components.schemas;
  const mutation = schemas.BatchEntityMutationResult;
  const search = schemas.BatchEntitySearchResult;
  const match = schemas.BatchEntitySearchMatch;
  const error = schemas.BatchEntityOperationError;

  assert.deepEqual(mutation.required, ["ok", "entityType"]);
  assert.equal(mutation.additionalProperties, false);
  assert.equal(
    mutation.properties?.entityType?.$ref,
    "#/components/schemas/CrudEntityType"
  );
  assert.equal(
    mutation.properties?.deletedRecord?.$ref,
    "#/components/schemas/DeletedEntityRecord"
  );
  assert.equal(
    mutation.properties?.projection?.$ref,
    "#/components/schemas/CalendarProjectionResult"
  );
  assert.equal(
    mutation.properties?.error?.$ref,
    "#/components/schemas/BatchEntityOperationError"
  );
  assert.deepEqual(mutation.oneOf?.[0]?.required, ["id", "entity"]);
  assert.equal(mutation.oneOf?.[0]?.properties?.ok?.const, true);
  assert.deepEqual(mutation.oneOf?.[1]?.required, ["error"]);
  assert.equal(mutation.oneOf?.[1]?.properties?.ok?.const, false);

  assert.deepEqual(search.required, ["ok", "matches"]);
  assert.equal(search.additionalProperties, false);
  assert.equal(search.properties?.ok?.const, true);
  assert.equal(search.properties?.entityType, undefined);
  assert.equal(
    search.properties?.matches?.items?.$ref,
    "#/components/schemas/BatchEntitySearchMatch"
  );

  assert.deepEqual(match.required, ["deleted", "entityType", "id", "entity"]);
  assert.equal(match.additionalProperties, false);
  assert.equal(
    match.properties?.deletedRecord?.$ref,
    "#/components/schemas/DeletedEntityRecord"
  );

  assert.deepEqual(error.required, ["code", "message"]);
  assert.equal(error.additionalProperties, false);
  for (const field of [
    "operationType",
    "entityType",
    "clientRef",
    "routeHint",
    "toolHint",
    "summary",
    "issues",
    "missingRequiredFields",
    "invalidValueGuidance",
    "allowedTopLevelFields",
    "minimalExamplePayload"
  ]) {
    assert.ok(error.properties?.[field], `missing error field ${field}`);
  }
  assert.ok(error.properties?.code?.examples?.includes("rolled_back"));
  assert.ok(error.properties?.code?.examples?.includes("not_executed"));
  assert.equal(
    error.properties?.issues?.items?.$ref,
    "#/components/schemas/BatchEntityValidationIssue"
  );
  assert.equal(
    error.properties?.invalidValueGuidance?.items?.$ref,
    "#/components/schemas/BatchEntityInvalidValueGuidance"
  );
  assert.equal(
    error.properties?.minimalExamplePayload?.additionalProperties,
    true
  );
  assert.deepEqual(schemas.BatchEntityValidationIssue.required, [
    "path",
    "message"
  ]);
  assert.equal(schemas.BatchEntityValidationIssue.additionalProperties, false);
  assert.deepEqual(schemas.BatchEntityInvalidValueGuidance.required, [
    "path",
    "allowedValues",
    "message"
  ]);
  assert.equal(
    schemas.BatchEntityInvalidValueGuidance.additionalProperties,
    false
  );
});

test("assembled batch route responses validate against the published OpenAPI schemas", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-note-batch-openapi-runtime-")
  );
  const app = await buildServer({
    dataRoot,
    seedDemoData: false,
    devrageMetricSync: false,
    peerRuntime: false
  });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const document = buildOpenApiDocument() as unknown as OpenApiDocument;
    const injectBatch = async (
      route: string,
      payload: Record<string, unknown>
    ) => {
      const response = await app.inject({
        method: "POST",
        url: route,
        headers: { cookie },
        payload
      });
      assert.equal(response.statusCode, 200, response.body);
      const body = response.json();
      assertRuntimeResponseMatches(document, route, body);
      return body as {
        results: Array<{
          ok: boolean;
          id?: string;
          entity?: { revisionHash?: string };
          error?: { code: string };
          matches?: Array<{ id: string; deleted: boolean }>;
        }>;
      };
    };

    const created = await injectBatch("/api/v1/entities/create", {
      operations: [
        {
          entityType: "note",
          data: {
            title: "OpenAPI runtime evidence",
            contentMarkdown: "The live response must match the contract."
          }
        }
      ]
    });
    const noteId = created.results[0]?.id;
    const revisionHash = created.results[0]?.entity?.revisionHash;
    assert.ok(noteId);
    assert.ok(revisionHash);

    await injectBatch("/api/v1/entities/update", {
      operations: [
        {
          entityType: "note",
          id: noteId,
          patch: {
            title: "Updated OpenAPI runtime evidence",
            expectedRevisionHash: revisionHash
          }
        }
      ]
    });

    const validationFailure = await injectBatch("/api/v1/entities/create", {
      operations: [{ entityType: "task", data: { title: "" } }]
    });
    assert.equal(
      validationFailure.results[0]?.error?.code,
      "validation_failed"
    );

    const atomicFailure = await injectBatch("/api/v1/entities/create", {
      atomic: true,
      operations: [
        {
          entityType: "goal",
          data: {
            title: "OpenAPI rollback evidence",
            description: "This must be rolled back."
          }
        },
        { entityType: "task", data: { title: "" } },
        {
          entityType: "project",
          data: { title: "OpenAPI skipped evidence" }
        }
      ]
    });
    assert.deepEqual(
      atomicFailure.results.map((result) => result.error?.code),
      ["rolled_back", "validation_failed", "not_executed"]
    );

    await injectBatch("/api/v1/entities/delete", {
      operations: [{ entityType: "note", id: noteId }]
    });
    const deletedSearch = await injectBatch("/api/v1/entities/search", {
      searches: [
        {
          entityTypes: ["note"],
          ids: [noteId],
          includeDeleted: true,
          limit: 10
        }
      ]
    });
    assert.deepEqual(
      deletedSearch.results[0]?.matches?.map((match) => ({
        id: match.id,
        deleted: match.deleted
      })),
      [{ id: noteId, deleted: true }]
    );

    await injectBatch("/api/v1/entities/restore", {
      operations: [{ entityType: "note", id: noteId }]
    });
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

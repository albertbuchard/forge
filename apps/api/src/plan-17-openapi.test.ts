import assert from "node:assert/strict";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { buildOpenApiDocument } from "./openapi.js";

type OpenApiSchema = {
  $ref?: string;
  additionalProperties?: boolean;
  maxItems?: number;
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
  type?: string;
};

type OpenApiDocument = {
  components: { schemas: Record<string, OpenApiSchema> };
  paths: Record<
    string,
    {
      post?: {
        requestBody?: {
          content?: {
            "application/json"?: { schema?: OpenApiSchema };
          };
        };
      };
    }
  >;
};

function requestSchemaRef(document: OpenApiDocument, route: string) {
  return document.paths[route]?.post?.requestBody?.content?.["application/json"]
    ?.schema?.$ref;
}

function compileComponent(document: OpenApiDocument, name: string) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateFormats: false
  });
  const validate = ajv.compile({
    $ref: `#/components/schemas/${name}`,
    components: document.components
  });
  return { ajv, validate };
}

test("PLAN-17 OpenAPI routes reference separate complete and release inputs", () => {
  const document = buildOpenApiDocument() as unknown as OpenApiDocument;

  assert.equal(
    requestSchemaRef(document, "/api/v1/task-runs/{id}/complete"),
    "#/components/schemas/TaskRunCompleteInput"
  );
  assert.equal(
    requestSchemaRef(document, "/api/v1/task-runs/{id}/release"),
    "#/components/schemas/TaskRunReleaseInput"
  );
  assert.equal(document.components.schemas.TaskRunFinishInput, undefined);
});

test("PLAN-17 OpenAPI complete and release inputs have exact structural parity", () => {
  const document = buildOpenApiDocument() as unknown as OpenApiDocument;
  const complete = document.components.schemas.TaskRunCompleteInput;
  const release = document.components.schemas.TaskRunReleaseInput;

  assert.equal(complete.additionalProperties, false);
  assert.equal(release.additionalProperties, false);
  assert.deepEqual(Object.keys(release.properties ?? {}).sort(), [
    "actor",
    "closeoutNote",
    "note"
  ]);
  assert.deepEqual(Object.keys(complete.properties ?? {}).sort(), [
    "actor",
    "closeoutNote",
    "completionReport",
    "gitRefs",
    "note"
  ]);
  assert.equal(
    complete.properties?.completionReport?.$ref,
    "#/components/schemas/CompletionReportInput"
  );
  assert.equal(
    complete.properties?.gitRefs?.maxItems,
    document.components.schemas.TaskCreateInput.properties?.gitRefs?.maxItems
  );
  assert.equal(release.properties?.completionReport, undefined);
  assert.equal(release.properties?.gitRefs, undefined);
});

test("PLAN-17 assembled OpenAPI validates complete evidence and rejects it on release", () => {
  const document = buildOpenApiDocument() as unknown as OpenApiDocument;
  const closeout = {
    actor: "Codex",
    note: "Finished",
    completionReport: {
      workSummary: "Implemented PLAN-17 closeout.",
      modifiedFiles: ["apps/api/src/openapi.ts"],
      linkedGitRefIds: ["draft-ref-17"]
    },
    gitRefs: [
      {
        id: "draft-ref-17",
        provider: "github",
        repository: "albertbuchard/forge",
        refType: "commit",
        refValue: "abc123",
        url: "https://github.com/albertbuchard/forge/commit/abc123"
      }
    ],
    closeoutNote: {
      contentMarkdown: "Evidence is linked to the task.",
      links: [
        {
          entityType: "artifact",
          entityId: "artifact_plan_17"
        }
      ]
    }
  };

  const completeValidator = compileComponent(document, "TaskRunCompleteInput");
  assert.equal(
    completeValidator.validate(closeout),
    true,
    completeValidator.ajv.errorsText(completeValidator.validate.errors)
  );

  const releaseValidator = compileComponent(document, "TaskRunReleaseInput");
  assert.equal(releaseValidator.validate(closeout), false);
  assert.match(
    releaseValidator.ajv.errorsText(releaseValidator.validate.errors),
    /additional properties/i
  );
  assert.equal(
    releaseValidator.validate({
      actor: closeout.actor,
      note: closeout.note,
      closeoutNote: closeout.closeoutNote
    }),
    true,
    releaseValidator.ajv.errorsText(releaseValidator.validate.errors)
  );
});

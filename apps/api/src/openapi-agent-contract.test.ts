import assert from "node:assert/strict";
import test from "node:test";
import { buildOpenApiDocument } from "./openapi.js";

type JsonSchema = {
  type?: string;
  format?: string;
  minItems?: number;
  minLength?: number;
  minimum?: number;
  maximum?: number;
  const?: string;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
};

type OpenApiOperation = {
  tags?: string[];
  parameters?: Array<{
    name?: string;
    in?: string;
    required?: boolean;
    schema?: JsonSchema;
  }>;
};

type OpenApiDocument = {
  components: { schemas: Record<string, JsonSchema> };
  paths: Record<string, Record<string, OpenApiOperation>>;
};

function schemaAllowsNull(schema: JsonSchema | undefined) {
  return (
    schema?.type === "null" || schema?.anyOf?.some(schemaAllowsNull) === true
  );
}

function nonNullBranch(schema: JsonSchema | undefined) {
  return schema?.anyOf?.find((branch) => branch.type !== "null") ?? schema;
}

test("OpenAPI publishes one consistent questionnaire tag pair and every required id path parameter", () => {
  const document = buildOpenApiDocument() as unknown as OpenApiDocument;
  const operations = [
    document.paths["/api/v1/psyche/questionnaires/{id}/runs"]?.post,
    document.paths["/api/v1/psyche/questionnaire-runs/{id}"]?.get,
    document.paths["/api/v1/psyche/questionnaire-runs/{id}"]?.patch,
    document.paths["/api/v1/psyche/questionnaire-runs/{id}/complete"]?.post
  ];

  for (const operation of operations) {
    assert.deepEqual(operation?.tags, ["Questionnaires", "Psyche"]);
    assert(
      operation?.parameters?.some(
        (parameter) =>
          parameter.name === "id" &&
          parameter.in === "path" &&
          parameter.required === true &&
          parameter.schema?.type === "string"
      )
    );
  }
});

test("OpenAPI publishes selected calendar URLs and provider-specific credentials exactly", () => {
  const document = buildOpenApiDocument() as unknown as OpenApiDocument;
  const schema = document.components.schemas.CalendarConnectionMutationInput;
  const selectedCalendarUrls = schema.properties?.selectedCalendarUrls;

  assert.deepEqual(selectedCalendarUrls, {
    type: "array",
    minItems: 1,
    items: { type: "string", format: "uri" }
  });
  assert.deepEqual(schema.properties?.serverUrl, {
    type: "string",
    format: "uri"
  });
  assert.deepEqual(nonNullBranch(schema.properties?.forgeCalendarUrl), {
    type: "string",
    format: "uri"
  });
  assert.deepEqual(schema.required, [
    "provider",
    "label",
    "selectedCalendarUrls"
  ]);

  const credentialRequirements = Object.fromEntries(
    (schema.oneOf ?? []).map((branch) => [
      branch.properties?.provider?.const,
      branch.required?.filter((field) => field !== "provider")
    ])
  );
  assert.deepEqual(credentialRequirements, {
    google: ["authSessionId"],
    apple: ["username", "password"],
    caldav: ["serverUrl", "username", "password"],
    microsoft: ["authSessionId"],
    macos_local: ["sourceId"]
  });
});

test("OpenAPI does not publish nutrition inputs that the runtime parser rejects", () => {
  const document = buildOpenApiDocument() as unknown as OpenApiDocument;
  const schemas = document.components.schemas;
  const foodLog = schemas.NutritionFoodLogInput;
  const foodLogPatch = schemas.NutritionFoodLogPatchInput;
  const mealItem = schemas.NutritionMealItemInput;

  assert.equal(foodLog.properties?.items?.minItems, 1);
  assert.equal(foodLogPatch.properties?.items?.minItems, undefined);
  assert.equal(schemaAllowsNull(foodLog.properties?.mealLabel), false);
  assert.equal(schemaAllowsNull(foodLog.properties?.notes), false);
  assert.deepEqual(mealItem.properties?.unit, {
    type: "string",
    minLength: 1
  });
  assert.equal(schemaAllowsNull(mealItem.properties?.unit), false);

  const scoreFieldsBySchema = {
    NutritionBodyCheckinInput: ["clothingFitScore"],
    NutritionAppearanceCheckinInput: [
      "facePuffiness",
      "leanness",
      "muscularity",
      "posture",
      "bloatingLook",
      "confidenceScore"
    ],
    NutritionSubjectiveCheckinInput: [
      "hunger",
      "fullness",
      "cravings",
      "mood",
      "energy",
      "focus",
      "stress",
      "sleepiness",
      "crashScore"
    ],
    NutritionGutCheckinInput: [
      "bloating",
      "gas",
      "reflux",
      "abdominalPain",
      "urgency",
      "nausea",
      "constipation",
      "diarrhea"
    ]
  } as const;
  for (const [schemaName, scoreNames] of Object.entries(scoreFieldsBySchema)) {
    for (const scoreName of scoreNames) {
      assert.deepEqual(
        nonNullBranch(schemas[schemaName]?.properties?.[scoreName]),
        {
          type: "integer",
          minimum: 0,
          maximum: 10
        }
      );
    }
  }

  for (const schemaName of Object.keys(scoreFieldsBySchema)) {
    assert.equal(
      schemaAllowsNull(schemas[schemaName]?.properties?.notes),
      false
    );
  }
});

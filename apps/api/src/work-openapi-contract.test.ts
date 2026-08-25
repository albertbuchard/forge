import assert from "node:assert/strict";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

import { buildOpenApiDocument } from "./openapi.js";

type Schema = {
  $ref?: string;
  additionalProperties?: boolean;
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  type?: string | string[];
  [key: string]: unknown;
};

type Operation = {
  description?: string;
  requestBody?: {
    content?: { "application/json"?: { schema?: Schema } };
  };
  responses?: Record<string, unknown>;
  security?: Array<Record<string, unknown[]>>;
  tags?: string[];
};

type Document = {
  components: { schemas: Record<string, Schema> };
  paths: Record<
    string,
    Partial<Record<"get" | "post" | "patch" | "put" | "delete", Operation>>
  >;
};

const expectedWorkPaths = [
  "/api/v1/work",
  "/api/v1/work/applications",
  "/api/v1/work/applications/{id}",
  "/api/v1/work/applications/{id}/events",
  "/api/v1/work/applications/{id}/transitions",
  "/api/v1/work/campaigns",
  "/api/v1/work/campaigns/{campaignId}/opportunities/{opportunityId}/evaluations",
  "/api/v1/work/campaigns/{id}",
  "/api/v1/work/campaigns/{id}/criteria",
  "/api/v1/work/check-ins",
  "/api/v1/work/context",
  "/api/v1/work/engagements",
  "/api/v1/work/engagements/{id}",
  "/api/v1/work/imports/apply",
  "/api/v1/work/imports/preview",
  "/api/v1/work/imports/{id}/rollback",
  "/api/v1/work/imports/{id}/rollback-preview",
  "/api/v1/work/metrics/definitions",
  "/api/v1/work/metrics/trends",
  "/api/v1/work/offers/{id}/accept",
  "/api/v1/work/opportunities",
  "/api/v1/work/opportunities/upsert",
  "/api/v1/work/opportunities/{id}",
  "/api/v1/work/organizations",
  "/api/v1/work/organizations/{id}",
  "/api/v1/work/relationships/{entityType}/{id}",
  "/api/v1/work/search-runs",
  "/api/v1/work/search-runs/{id}",
  "/api/v1/work/settings",
  "/api/v1/work/settings/opportunity-search",
  "/api/v1/work/supporting/{kind}",
  "/api/v1/work/supporting/{kind}/{id}",
  "/api/v1/work/transmissions/previews",
  "/api/v1/work/transmissions/previews/{id}/request-approval",
  "/api/v1/work/transmissions/verified-submissions",
  "/api/v1/work/{entityType}/{id}/archive",
  "/api/v1/work/{entityType}/{id}/restore"
].sort();

function document() {
  return buildOpenApiDocument() as unknown as Document;
}

function requestSchema(
  spec: Document,
  path: string,
  method: "post" | "patch" | "put"
) {
  return spec.paths[path]?.[method]?.requestBody?.content?.["application/json"]
    ?.schema;
}

function compile(spec: Document, component: string) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateFormats: false
  });
  const validate = ajv.compile({
    $ref: `#/components/schemas/${component}`,
    components: spec.components
  });
  return { ajv, validate };
}

test("Work OpenAPI publishes the complete permanent-Work and opportunity route surface", () => {
  const spec = document();
  const workPaths = Object.keys(spec.paths)
    .filter(
      (path) => path === "/api/v1/work" || path.startsWith("/api/v1/work/")
    )
    .sort();
  assert.deepEqual(workPaths, expectedWorkPaths);

  for (const path of workPaths) {
    for (const [method, operation] of Object.entries(spec.paths[path] ?? {})) {
      assert.deepEqual(
        operation.tags,
        ["Work"],
        `${method.toUpperCase()} ${path}`
      );
      assert.ok(
        operation.description?.trim(),
        `${method.toUpperCase()} ${path}`
      );
      assert.ok(operation.security?.length, `${method.toUpperCase()} ${path}`);
      assert.ok(
        operation.responses?.["200"] ||
          operation.responses?.["201"] ||
          operation.responses?.["202"]
      );
      assert.ok(operation.responses?.["401"] || operation.responses?.["403"]);
    }
  }
});

test("Work OpenAPI binds mutations to strict typed request contracts", () => {
  const spec = document();
  const expectedRefs: Array<[string, "post" | "patch" | "put", string]> = [
    [
      "/api/v1/work/engagements",
      "post",
      "#/components/schemas/WorkEngagementInput"
    ],
    [
      "/api/v1/work/campaigns",
      "post",
      "#/components/schemas/OpportunityCampaignInput"
    ],
    ["/api/v1/work/check-ins", "post", "#/components/schemas/WorkCheckInInput"],
    [
      "/api/v1/work/opportunities/upsert",
      "post",
      "#/components/schemas/JobOpportunityInput"
    ],
    [
      "/api/v1/work/applications",
      "post",
      "#/components/schemas/JobApplicationInput"
    ],
    [
      "/api/v1/work/applications/{id}/transitions",
      "post",
      "#/components/schemas/JobApplicationTransitionInput"
    ],
    [
      "/api/v1/work/transmissions/previews",
      "post",
      "#/components/schemas/WorkTransmissionPreviewInput"
    ],
    [
      "/api/v1/work/transmissions/verified-submissions",
      "post",
      "#/components/schemas/WorkVerifiedSubmissionInput"
    ],
    [
      "/api/v1/work/imports/preview",
      "post",
      "#/components/schemas/WorkImportManifest"
    ]
  ];
  for (const [path, method, ref] of expectedRefs) {
    assert.equal(
      requestSchema(spec, path, method)?.$ref,
      ref,
      `${method} ${path}`
    );
  }

  for (const [path, item] of Object.entries(spec.paths)) {
    if (path !== "/api/v1/work" && !path.startsWith("/api/v1/work/")) continue;
    for (const method of ["post", "patch", "put"] as const) {
      const operation = item[method];
      if (!operation) continue;
      const schema = requestSchema(spec, path, method);
      assert.ok(schema, `${method.toUpperCase()} ${path} lacks a JSON body`);
      if (!schema?.$ref) {
        assert.equal(
          schema?.additionalProperties,
          false,
          `${method.toUpperCase()} ${path} accepts undeclared properties`
        );
      }
    }
  }
});

test("Work OpenAPI validators accept representative inputs and reject malformed or underspecified mutations", () => {
  const spec = document();

  const engagement = compile(spec, "WorkEngagementInput");
  assert.equal(
    engagement.validate({
      title: "Concurrent research appointment",
      status: "current",
      engagementType: "appointment",
      workModel: "hybrid",
      noticePeriod: { value: 3, unit: "months", unknown: false },
      compensation: {
        base: {
          amount: 120000,
          currency: "CHF",
          basis: "gross",
          period: "year",
          unknown: false
        }
      },
      provenance: { sourceKind: "user" }
    }),
    true,
    engagement.ajv.errorsText(engagement.validate.errors)
  );
  assert.equal(
    engagement.validate({ title: "Role", homeAddress: "not accepted" }),
    false
  );
  assert.equal(engagement.validate({ status: "current" }), false);

  const checkIn = compile(spec, "WorkCheckInInput");
  assert.equal(
    checkIn.validate({
      engagementId: "engagement_1",
      timezone: "Europe/Zurich",
      sourceKind: "user_entered",
      confirmationState: "confirmed",
      observations: [
        {
          metricDefinitionId: "metric_1",
          numericValue: 4,
          missingState: "observed"
        }
      ],
      provenance: { sourceKind: "user" },
      idempotencyKey: "check-in-1"
    }),
    true,
    checkIn.ajv.errorsText(checkIn.validate.errors)
  );
  assert.equal(
    checkIn.validate({
      engagementId: "engagement_1",
      timezone: "UTC",
      observations: [],
      idempotencyKey: "empty-observations"
    }),
    false
  );

  const submission = compile(spec, "WorkVerifiedSubmissionInput");
  const submissionBase = {
    authorizationIdentity: "authorization_1",
    previewDigest: "a".repeat(64),
    factualDescription: "The destination returned a receipt.",
    idempotencyKey: "verified-submission-1"
  };
  assert.equal(submission.validate(submissionBase), false);
  assert.equal(
    submission.validate({ ...submissionBase, trackingIdentifier: "ATS-100" }),
    true,
    submission.ajv.errorsText(submission.validate.errors)
  );
  assert.equal(
    submission.validate({
      ...submissionBase,
      trackingIdentifier: "ATS-100",
      password: "not part of the contract"
    }),
    false
  );
});

test("Private import OpenAPI is operator-only, insert-only, and excludes subjective metric payloads", () => {
  const spec = document();
  const preview = spec.paths["/api/v1/work/imports/preview"]?.post;
  const apply = spec.paths["/api/v1/work/imports/apply"]?.post;
  assert.deepEqual(preview?.security, [{ operatorSession: [] }]);
  assert.deepEqual(apply?.security, [{ operatorSession: [] }]);
  assert.match(preview?.description ?? "", /prohibited private data/i);
  assert.match(apply?.description ?? "", /No subjective Work metric/i);

  const manifest = compile(spec, "WorkImportManifest");
  const valid = {
    schemaVersion: 1,
    source: {
      label: "Private source",
      digest: "b".repeat(64),
      observedAt: "2026-08-25T09:00:00.000Z"
    },
    ownerUserId: "user_operator",
    engagements: [
      {
        title: "Current appointment",
        status: "current",
        provenance: { sourceKind: "import" }
      }
    ]
  };
  assert.equal(
    manifest.validate(valid),
    true,
    manifest.ajv.errorsText(manifest.validate.errors)
  );
  assert.equal(
    manifest.validate({
      ...valid,
      metricObservations: [
        { metricKey: "overall_satisfaction", numericValue: 5 }
      ]
    }),
    false
  );
  assert.equal(
    manifest.validate({
      ...valid,
      source: { ...valid.source, password: "not accepted" }
    }),
    false
  );
});

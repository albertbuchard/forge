import assert from "node:assert/strict";
import test from "node:test";
import { buildOpenApiDocument } from "./openapi.js";
import {
  PEER_API_SCHEMAS,
  type PeerApiOperationId
} from "./peer-api-schemas.js";
import { PEER_ROUTE_CONTRACTS } from "./peer-route-contract.js";

type OpenApiOperation = {
  operationId?: string;
  tags?: string[];
  requestBody?: unknown;
  responses?: Record<string, unknown>;
  "x-forge-principal-classes"?: string[];
  "x-forge-required-scopes"?: string[];
  "x-forge-human-only"?: boolean;
  "x-forge-mcp-exposed"?: boolean;
};

type OpenApiDocument = {
  paths: Record<string, Record<string, OpenApiOperation>>;
  tags: Array<{ name: string }>;
  components: {
    schemas: Record<string, unknown> & {
      CrudEntityType: { enum: string[] };
    };
  };
};

const expectedSuccessFields: Record<PeerApiOperationId, readonly string[]> = {
  listPeopleReadModel: ["people", "page"],
  getPersonContext: ["context"],
  scanPeopleWikiCandidates: ["candidates", "root", "page", "scan"],
  enrichPeopleWikiCandidates: [
    "llmAvailable",
    "enriched",
    "profile",
    "suggestions"
  ],
  previewPeopleWikiAssociations: ["preview"],
  applyPeopleWikiAssociations: ["previewId", "replayed", "results"],
  createPeerCompanionEnrollmentOptions: [
    "protocol",
    "challengeId",
    "challenge",
    "enrollmentAttemptId",
    "pairingSessionId",
    "ownerUserId",
    "device",
    "issuedAt",
    "expiresAt"
  ],
  verifyPeerCompanionEnrollment: [
    "protocol",
    "enrollmentId",
    "keyId",
    "pairingSessionId",
    "ownerUserId",
    "device",
    "scopes",
    "capabilities",
    "authorizedOperations",
    "enrolledAt",
    "legacyBootstrapDisabledAt",
    "legacyBootstrapAccepted"
  ],
  getPeerHumanPresenceStatus: ["methods", "credentials", "peerCore"],
  createPeerHumanPresenceOptions: ["challengeId"],
  verifyPeerHumanPresence: ["approved", "expiresAt"],
  revokePeerHumanPresenceCredential: ["revoked", "credentialId"],
  createPeerInvitation: ["invitation"],
  getPeerInvitationStatus: ["invitation"],
  cancelPeerInvitation: ["canceled", "invitationId"],
  acceptScannedPeerPairing: ["request"],
  confirmPeerPairing: ["relationshipId", "request"],
  listPeerRequests: ["requests", "page"],
  acceptPeerRequest: ["request"],
  rejectPeerRequest: ["request"],
  listPeerRelationships: ["relationships", "page"],
  getPeerRelationship: ["relationship", "devices", "grants", "sync"],
  revokePeerRelationship: ["relationship"],
  listPeerDevices: ["devices", "boundedAt", "truncated"],
  approvePeerDevice: ["device"],
  removePeerDevice: ["device"],
  previewPeerGrant: ["preview"],
  proposePeerGrant: ["grant", "versionHash"],
  listPeerGrants: ["grants", "page"],
  acceptPeerGrant: ["grant", "versionHash"],
  counterPeerGrant: ["grant", "versionHash"],
  revokePeerGrant: ["grant", "versionHash"],
  getPeerSyncStatus: ["sync", "peerCore"],
  requestPeerResync: ["requested", "envelopeIds"],
  getPeerDiagnostics: ["diagnostics", "peerCore", "page"],
  interpretPersonQuestion: ["interpretation"],
  executePersonQuestion: ["result", "durationMs"],
  listPersonQuestionHistory: ["questions", "page"]
};

function decodePointerSegment(segment: string) {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

function resolvePointer(document: unknown, pointer: string): unknown {
  assert.match(pointer, /^#(?:\/|$)/u);
  let current = document;
  for (const encoded of pointer.slice(2).split("/")) {
    if (encoded.length === 0) continue;
    const segment = decodePointerSegment(encoded);
    if (Array.isArray(current)) {
      assert.match(segment, /^(?:0|[1-9][0-9]*)$/u);
      current = current[Number(segment)];
    } else {
      assert.ok(current !== null && typeof current === "object");
      current = (current as Record<string, unknown>)[segment];
    }
    assert.notEqual(
      current,
      undefined,
      `Unresolved OpenAPI pointer ${pointer}`
    );
  }
  return current;
}

function resolvedSchema(document: OpenApiDocument, schema: unknown): unknown {
  if (
    schema !== null &&
    typeof schema === "object" &&
    typeof (schema as { $ref?: unknown }).$ref === "string"
  ) {
    return resolvePointer(document, (schema as { $ref: string }).$ref);
  }
  return schema;
}

function rootSchemaVariants(
  document: OpenApiDocument,
  schema: unknown
): Array<Record<string, unknown>> {
  const resolved = resolvedSchema(document, schema);
  assert.ok(resolved !== null && typeof resolved === "object");
  const object = resolved as Record<string, unknown>;
  const variants = object.anyOf ?? object.oneOf;
  if (Array.isArray(variants)) {
    return variants.flatMap((variant) => rootSchemaVariants(document, variant));
  }
  return [object];
}

function assertNoPermissiveObjects(
  document: OpenApiDocument,
  value: unknown,
  path = "schema",
  visitedReferences = new Set<string>()
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoPermissiveObjects(
        document,
        entry,
        `${path}/${index}`,
        visitedReferences
      )
    );
    return;
  }
  if (value === null || typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  if (typeof object.$ref === "string") {
    if (visitedReferences.has(object.$ref)) return;
    visitedReferences.add(object.$ref);
    assertNoPermissiveObjects(
      document,
      resolvePointer(document, object.$ref),
      object.$ref,
      visitedReferences
    );
    return;
  }
  assert.notEqual(
    object.additionalProperties,
    true,
    `${path} must not allow arbitrary object properties`
  );
  for (const [key, nested] of Object.entries(object)) {
    assertNoPermissiveObjects(
      document,
      nested,
      `${path}/${key}`,
      visitedReferences
    );
  }
}

function openApiPath(path: string) {
  return path.replace(/:([A-Za-z][A-Za-z0-9]*)/g, "{$1}");
}

test("OpenAPI publishes the exact People and peer route contract", () => {
  const document = buildOpenApiDocument() as OpenApiDocument;
  const declaredTags = new Set(document.tags.map((tag) => tag.name));

  assert.equal(PEER_ROUTE_CONTRACTS.length, 38);
  assert.ok(document.components.schemas.CrudEntityType.enum.includes("person"));
  for (const contract of PEER_ROUTE_CONTRACTS) {
    const path = openApiPath(contract.path);
    const operation = document.paths[path]?.[contract.method.toLowerCase()];
    assert.ok(operation, `${contract.method} ${path} is missing from OpenAPI`);
    assert.equal(operation.operationId, contract.operationId);
    assert.deepEqual(operation.tags, [contract.tag]);
    assert.ok(declaredTags.has(contract.tag));
    assert.deepEqual(operation["x-forge-principal-classes"], [
      ...contract.principalClasses
    ]);
    assert.deepEqual(operation["x-forge-required-scopes"], [
      ...contract.requiredScopes
    ]);
    assert.equal(operation["x-forge-human-only"], contract.humanOnly);
    assert.equal(operation["x-forge-mcp-exposed"], contract.mcpExposed);
    const operationId = contract.operationId as PeerApiOperationId;
    const successStatus = String(PEER_API_SCHEMAS[operationId].success.status);
    const successResponse = operation.responses?.[successStatus] as
      | {
          content?: {
            "application/json"?: { schema?: unknown };
          };
        }
      | undefined;
    assert.ok(
      successResponse,
      `${operationId} is missing HTTP ${successStatus}`
    );
    assert.equal(
      Object.keys(operation.responses ?? {}).filter((status) =>
        /^2[0-9]{2}$/u.test(status)
      ).length,
      1,
      `${operationId} must publish one canonical success status`
    );
    const successSchema = successResponse.content?.["application/json"]?.schema;
    assert.deepEqual(successSchema, {
      $ref: `#/components/schemas/${operationId[0]!.toUpperCase()}${operationId.slice(1)}Success`
    });
    for (const variant of rootSchemaVariants(document, successSchema)) {
      const required = variant.required;
      assert.ok(
        Array.isArray(required),
        `${operationId} success variants must declare required fields`
      );
      for (const field of expectedSuccessFields[operationId]) {
        assert.ok(
          required.includes(field),
          `${operationId} success response must require ${field}`
        );
      }
    }
    const componentName = `${operationId[0]!.toUpperCase()}${operationId.slice(1)}Success`;
    assertNoPermissiveObjects(
      document,
      document.components.schemas[componentName],
      `#/components/schemas/${componentName}`
    );
  }
  assert.equal(
    Object.keys(document.components.schemas).filter((name) =>
      name.endsWith("Success")
    ).length,
    PEER_ROUTE_CONTRACTS.length
  );
});

test("mutating peer routes publish bounded request contracts", () => {
  const document = buildOpenApiDocument() as {
    paths: Record<string, Record<string, OpenApiOperation>>;
  };
  const bodylessOperations = new Set([
    "revokePeerHumanPresenceCredential",
    "cancelPeerInvitation"
  ]);

  for (const contract of PEER_ROUTE_CONTRACTS) {
    if (
      contract.method !== "POST" ||
      bodylessOperations.has(contract.operationId)
    ) {
      continue;
    }
    const operation =
      document.paths[openApiPath(contract.path)]?.[
        contract.method.toLowerCase()
      ];
    assert.ok(
      operation?.requestBody,
      `${contract.operationId} must publish its JSON request body`
    );
  }
});

test("People list OpenAPI documents revision-bound cursors and restartable conflicts", () => {
  const document = buildOpenApiDocument() as OpenApiDocument;
  const operation = document.paths["/api/v1/people"]?.get;
  assert.ok(operation);

  const parameters = (operation as { parameters?: unknown[] }).parameters;
  assert.ok(Array.isArray(parameters));
  const cursor = parameters.find(
    (parameter) =>
      parameter !== null &&
      typeof parameter === "object" &&
      (parameter as { name?: unknown }).name === "cursor"
  ) as { schema?: { description?: unknown } } | undefined;
  assert.match(
    String(cursor?.schema?.description),
    /owner-scoped People read-model revision/u
  );

  const conflict = operation.responses?.["409"] as {
    description?: unknown;
    content?: {
      "application/json"?: {
        schema?: {
          required?: unknown;
          properties?: Record<string, { enum?: unknown }>;
        };
      };
    };
  };
  assert.match(String(conflict.description), /restart from the first page/iu);
  const schema = conflict.content?.["application/json"]?.schema;
  assert.deepEqual(schema?.required, [
    "code",
    "error",
    "statusCode",
    "restartRequired"
  ]);
  assert.deepEqual(schema?.properties?.code?.enum, [
    "people_cursor_snapshot_changed",
    "people_snapshot_busy"
  ]);
  assert.deepEqual(schema?.properties?.restartRequired?.enum, [true]);
});

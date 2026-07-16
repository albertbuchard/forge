import assert from "node:assert/strict";
import test from "node:test";
import {
  PEER_API_SCHEMAS,
  listPeopleQuerySchema,
  peerHumanPresenceOptionsSchema,
  peopleWikiAssociationPreviewSchema,
  personQuestionInterpretSchema,
  requestPeerResyncSchema
} from "./peer-api-schemas.js";
import { PEER_ROUTE_CONTRACTS } from "./peer-route-contract.js";

test("every People and peer operation has one strict runtime schema", () => {
  assert.deepEqual(
    Object.keys(PEER_API_SCHEMAS).sort(),
    PEER_ROUTE_CONTRACTS.map((route) => route.operationId).sort()
  );
  for (const route of PEER_ROUTE_CONTRACTS) {
    const schema = PEER_API_SCHEMAS[route.operationId];
    const params = Object.fromEntries(
      Array.from(route.path.matchAll(/:([A-Za-z][A-Za-z0-9]*)/g), (match) => [
        match[1]!,
        `${match[1]}_1`
      ])
    );
    assert.equal(
      schema.params.safeParse(params).success,
      true,
      route.operationId
    );
    assert.equal(
      schema.params.safeParse({ ...params, unexpected: "value" }).success,
      false,
      `${route.operationId} params must reject unknown keys`
    );
    if (route.method === "POST") {
      assert.ok(schema.body, `${route.operationId} requires a body schema`);
    }
  }
});

test("query booleans parse false without JavaScript truthiness widening", () => {
  const parsed = listPeopleQuerySchema.parse({
    hasUpcomingSharedContext: "false"
  });
  assert.equal(parsed.hasUpcomingSharedContext, false);
  assert.equal(
    listPeopleQuerySchema.safeParse({ hasUpcomingSharedContext: "no" }).success,
    false
  );
  assert.equal(listPeopleQuerySchema.safeParse({ limit: 101 }).success, false);
});

test("Wiki decisions require the exact fields and versions needed by the reviewed action", () => {
  const base = {
    wikiPageId: "wiki_1",
    expectedWikiVersion: "version_1"
  };
  assert.equal(
    peopleWikiAssociationPreviewSchema.safeParse({
      peopleRootPageId: "wiki_root",
      decisions: [{ ...base, action: "associate" }]
    }).success,
    false
  );
  assert.equal(
    peopleWikiAssociationPreviewSchema.safeParse({
      peopleRootPageId: "wiki_root",
      decisions: [
        {
          ...base,
          action: "associate",
          personId: "person_1",
          expectedPersonVersion: "person_version_1"
        }
      ]
    }).success,
    true
  );
  assert.equal(
    peopleWikiAssociationPreviewSchema.safeParse({
      peopleRootPageId: "wiki_root",
      decisions: [
        { ...base, action: "skip", displayName: "Unexpected mutation" }
      ]
    }).success,
    false
  );
});

test("presence options bind an exact protected action and ceremony prerequisites", () => {
  const action = {
    ownerUserId: "user_owner",
    method: "POST" as const,
    routePath: "/api/v1/peers/invitations",
    pathParams: {},
    expectedVersion: null,
    body: {
      label: "Jon",
      expiresInSeconds: 300,
      privacyMode: "fastest",
      transportKinds: ["iroh"],
      idempotencyKey: "invite:test:0001"
    }
  };
  assert.equal(
    peerHumanPresenceOptionsSchema.safeParse({
      ceremony: "authenticate",
      action
    }).success,
    true
  );
  assert.equal(
    peerHumanPresenceOptionsSchema.safeParse({
      ceremony: "register",
      action
    }).success,
    false
  );
  assert.equal(
    peerHumanPresenceOptionsSchema.safeParse({
      ceremony: "companion_consent",
      action
    }).success,
    false
  );
});

test("typed questions require a real time zone and resync is projection-bounded", () => {
  assert.equal(
    personQuestionInterpretSchema.safeParse({
      question: "What is Jon doing next Monday?",
      timeZone: "Europe/Zurich"
    }).success,
    true
  );
  assert.equal(
    personQuestionInterpretSchema.safeParse({
      question: "What is Jon doing next Monday?",
      timeZone: "Not/AZone"
    }).success,
    false
  );
  assert.equal(
    requestPeerResyncSchema.safeParse({
      expectedRelationshipVersion: "version_2",
      projectionIds: [],
      idempotencyKey: "resync:test:00001"
    }).success,
    false
  );
});

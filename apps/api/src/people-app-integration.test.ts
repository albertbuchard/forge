import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";
import { PEER_ROUTE_CONTRACTS } from "./peer-route-contract.js";

const issueOperatorSessionCookie = issueTestOperatorSessionCookie;

async function createAgentToken(input: {
  app: Awaited<ReturnType<typeof buildServer>>;
  cookie: string;
  label: string;
  scopes: string[];
}) {
  const response = await input.app.inject({
    method: "POST",
    url: "/api/v1/settings/tokens",
    headers: { cookie: input.cookie },
    payload: {
      label: input.label,
      agentLabel: input.label,
      trustLevel: "trusted",
      scopes: input.scopes
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { token: { token: string } }).token.token;
}

test("the assembled Forge server exposes Person batch CRUD and the People read model", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-people-app-integration-")
  );
  const app = await buildServer({
    dataRoot,
    seedDemoData: false,
    taskRunWatchdog: false,
    devrageMetricSync: false
  });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    for (const contract of PEER_ROUTE_CONTRACTS) {
      assert.equal(
        app.hasRoute({ method: contract.method, url: contract.path }),
        true,
        `${contract.method} ${contract.path} is not registered on the assembled server.`
      );
    }
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: { cookie },
      payload: {
        operations: [
          {
            entityType: "person",
            clientRef: "jon",
            data: {
              userId: "user_operator",
              displayName: "Jon Example",
              description: "Private context that must not appear in the list.",
              relationshipCategory: "friend"
            }
          }
        ]
      }
    });
    assert.equal(created.statusCode, 200, created.body);
    const createBody = created.json() as {
      results: Array<{ ok: boolean; id?: string }>;
    };
    assert.equal(createBody.results[0]?.ok, true, created.body);
    assert.ok(createBody.results[0]?.id);

    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/people?limit=20&source=both&sort=display_name&direction=asc",
      headers: { cookie }
    });
    assert.equal(listed.statusCode, 200, listed.body);
    const listBody = listed.json() as {
      people: Array<{ id: string; displayName: string; description: string }>;
      page: { limit: number; hasMore: boolean; nextCursor: string | null };
    };
    assert.equal(listBody.people.length, 1);
    assert.equal(listBody.people[0]?.id, createBody.results[0]?.id);
    assert.equal(listBody.people[0]?.displayName, "Jon Example");
    assert.equal(listBody.people[0]?.description, "");
    assert.deepEqual(listBody.page, {
      limit: 20,
      hasMore: false,
      nextCursor: null
    });
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("batch entity routes enforce People scopes and redact Person fields", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-people-batch-security-")
  );
  const app = await buildServer({
    dataRoot,
    seedDemoData: false,
    taskRunWatchdog: false,
    devrageMetricSync: false
  });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const ordinaryToken = await createAgentToken({
      app,
      cookie,
      label: "Ordinary entity agent",
      scopes: ["read", "write"]
    });
    const peopleToken = await createAgentToken({
      app,
      cookie,
      label: "Basic People agent",
      scopes: ["read", "write", "people:read:basic", "people:write"]
    });
    const privatePeopleToken = await createAgentToken({
      app,
      cookie,
      label: "Private People agent",
      scopes: [
        "read",
        "people:read:basic",
        "people:read:private",
        "people:read:contacts",
        "people:read:sensitive"
      ]
    });

    const deniedCreate = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: { authorization: `Bearer ${ordinaryToken}` },
      payload: {
        operations: [
          {
            entityType: "person",
            data: { userId: "user_operator", displayName: "Denied Person" }
          }
        ]
      }
    });
    assert.equal(deniedCreate.statusCode, 403);

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: { authorization: `Bearer ${peopleToken}` },
      payload: {
        operations: [
          {
            entityType: "person",
            data: {
              userId: "user_operator",
              displayName: "Scoped Person",
              description: "Private description",
              privateNotes: "Sensitive note",
              contacts: [
                {
                  kind: "email",
                  label: "Personal",
                  value: "scoped@example.test"
                }
              ]
            }
          }
        ]
      }
    });
    assert.equal(created.statusCode, 200, created.body);
    const createdEntity = (
      created.json() as {
        results: Array<{
          ok: boolean;
          entity: {
            description: string;
            privateNotes: string;
            contacts: unknown[];
          };
        }>;
      }
    ).results[0]!.entity;
    assert.equal(createdEntity.description, "");
    assert.equal(createdEntity.privateNotes, "");
    assert.deepEqual(createdEntity.contacts, []);

    const implicitSearch = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: { authorization: `Bearer ${ordinaryToken}` },
      payload: { searches: [{ query: "Scoped Person" }] }
    });
    assert.equal(implicitSearch.statusCode, 200, implicitSearch.body);
    const implicitMatches = (
      implicitSearch.json() as {
        results: Array<{ matches: Array<{ entityType: string }> }>;
      }
    ).results.flatMap((result) => result.matches);
    assert.equal(
      implicitMatches.some((match) => match.entityType === "person"),
      false
    );

    const deniedExplicitSearch = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: { authorization: `Bearer ${ordinaryToken}` },
      payload: { searches: [{ entityTypes: ["person"] }] }
    });
    assert.equal(deniedExplicitSearch.statusCode, 403);

    const basicSearch = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: { authorization: `Bearer ${peopleToken}` },
      payload: { searches: [{ entityTypes: ["person"] }] }
    });
    assert.equal(basicSearch.statusCode, 200, basicSearch.body);
    const basicEntity = (
      basicSearch.json() as {
        results: Array<{
          matches: Array<{
            entity: {
              description: string;
              privateNotes: string;
              contacts: unknown[];
            };
          }>;
        }>;
      }
    ).results[0]!.matches[0]!.entity;
    assert.equal(basicEntity.description, "");
    assert.equal(basicEntity.privateNotes, "");
    assert.deepEqual(basicEntity.contacts, []);

    const privateSearch = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: { authorization: `Bearer ${privatePeopleToken}` },
      payload: { searches: [{ entityTypes: ["person"] }] }
    });
    assert.equal(privateSearch.statusCode, 200, privateSearch.body);
    const privateEntity = (
      privateSearch.json() as {
        results: Array<{
          matches: Array<{
            entity: {
              description: string;
              privateNotes: string;
              contacts: unknown[];
            };
          }>;
        }>;
      }
    ).results[0]!.matches[0]!.entity;
    assert.equal(privateEntity.description, "Private description");
    assert.equal(privateEntity.privateNotes, "Sensitive note");
    assert.equal(privateEntity.contacts.length, 1);
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("Person batch payloads use the authorized general entity-link graph in both directions", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-people-batch-links-")
  );
  const app = await buildServer({
    dataRoot,
    seedDemoData: false,
    taskRunWatchdog: false,
    devrageMetricSync: false
  });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const goalResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: { cookie },
      payload: {
        operations: [
          {
            entityType: "goal",
            data: { userId: "user_operator", title: "Shared context goal" }
          }
        ]
      }
    });
    assert.equal(goalResponse.statusCode, 200, goalResponse.body);
    const goalId = (
      goalResponse.json() as { results: Array<{ id: string; ok: boolean }> }
    ).results[0]!.id;

    const personResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: { cookie },
      payload: {
        operations: [
          {
            entityType: "person",
            data: {
              userId: "user_operator",
              displayName: "Linked Person",
              links: [
                {
                  entityType: "goal",
                  entityId: goalId,
                  relationship: "supports"
                }
              ]
            }
          }
        ]
      }
    });
    assert.equal(personResponse.statusCode, 200, personResponse.body);
    const personResult = (
      personResponse.json() as {
        results: Array<{
          ok: boolean;
          id: string;
          entity: {
            links: Array<{
              sourceEntityType: string;
              targetEntityType: string;
              targetEntityId: string;
              relationship: string;
            }>;
          };
        }>;
      }
    ).results[0]!;
    assert.equal(personResult.ok, true, personResponse.body);
    assert.equal(personResult.entity.links.length, 1);
    assert.equal(personResult.entity.links[0]?.sourceEntityType, "person");
    assert.equal(personResult.entity.links[0]?.targetEntityType, "goal");
    assert.equal(personResult.entity.links[0]?.targetEntityId, goalId);
    assert.equal(personResult.entity.links[0]?.relationship, "supports");
    const personId = personResult.id;

    const linkedSearch = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: { cookie },
      payload: {
        searches: [
          {
            entityTypes: ["person"],
            linkedTo: { entityType: "goal", id: goalId }
          }
        ]
      }
    });
    assert.equal(linkedSearch.statusCode, 200, linkedSearch.body);
    assert.equal(
      (
        linkedSearch.json() as {
          results: Array<{ matches: Array<{ id: string }> }>;
        }
      ).results[0]!.matches[0]!.id,
      personId
    );

    const deleteGoal = await app.inject({
      method: "POST",
      url: "/api/v1/entities/delete",
      headers: { cookie },
      payload: {
        operations: [{ entityType: "goal", id: goalId, mode: "soft" }]
      }
    });
    assert.equal(deleteGoal.statusCode, 200, deleteGoal.body);
    assert.equal(
      (deleteGoal.json() as { results: Array<{ ok: boolean }> }).results[0]!
        .ok,
      true
    );
    const linkedWhileDeleted = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: { cookie },
      payload: {
        searches: [
          {
            entityTypes: ["person"],
            ids: [personId],
            linkedTo: { entityType: "goal", id: goalId }
          }
        ]
      }
    });
    assert.equal(linkedWhileDeleted.statusCode, 200, linkedWhileDeleted.body);
    assert.equal(
      (
        linkedWhileDeleted.json() as {
          results: Array<{ matches: Array<{ id: string }> }>;
        }
      ).results[0]!.matches[0]!.id,
      personId
    );
    const restoreGoal = await app.inject({
      method: "POST",
      url: "/api/v1/entities/restore",
      headers: { cookie },
      payload: { operations: [{ entityType: "goal", id: goalId }] }
    });
    assert.equal(restoreGoal.statusCode, 200, restoreGoal.body);
    assert.equal(
      (restoreGoal.json() as { results: Array<{ ok: boolean }> }).results[0]!
        .ok,
      true
    );

    const lifeEventResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: { cookie },
      payload: {
        operations: [
          {
            entityType: "life_event",
            data: {
              userId: "user_operator",
              title: "Meet Linked Person",
              startsAt: "2026-07-20T17:00:00.000Z",
              links: [
                {
                  entityType: "person",
                  entityId: personId,
                  relationship: "participant"
                }
              ]
            }
          }
        ]
      }
    });
    assert.equal(lifeEventResponse.statusCode, 200, lifeEventResponse.body);
    const lifeEventResult = (
      lifeEventResponse.json() as {
        results: Array<{ id: string; ok: boolean }>;
      }
    ).results[0]!;
    assert.equal(
      lifeEventResult.ok,
      true,
      lifeEventResponse.body
    );

    const reverseSearch = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: { cookie },
      payload: {
        searches: [
          {
            entityTypes: ["life_event"],
            linkedTo: { entityType: "person", id: personId }
          }
        ]
      }
    });
    assert.equal(reverseSearch.statusCode, 200, reverseSearch.body);
    assert.equal(
      (
        reverseSearch.json() as {
          results: Array<{ matches: Array<{ entityType: string }> }>;
        }
      ).results[0]!.matches[0]!.entityType,
      "life_event"
    );

    const deleteLifeEvent = await app.inject({
      method: "POST",
      url: "/api/v1/entities/delete",
      headers: { cookie },
      payload: {
        operations: [
          { entityType: "life_event", id: lifeEventResult.id, mode: "soft" }
        ]
      }
    });
    assert.equal(deleteLifeEvent.statusCode, 200, deleteLifeEvent.body);
    const restoreLifeEvent = await app.inject({
      method: "POST",
      url: "/api/v1/entities/restore",
      headers: { cookie },
      payload: {
        operations: [{ entityType: "life_event", id: lifeEventResult.id }]
      }
    });
    assert.equal(restoreLifeEvent.statusCode, 200, restoreLifeEvent.body);

    const userResponse = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: { cookie },
      payload: {
        kind: "human",
        handle: "other_person_owner",
        displayName: "Other owner",
        description: "",
        accentColor: "#22d3ee"
      }
    });
    assert.equal(userResponse.statusCode, 201, userResponse.body);
    const otherUserId = (
      userResponse.json() as { user: { id: string } }
    ).user.id;
    const otherGoalResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: { cookie },
      payload: {
        operations: [
          {
            entityType: "goal",
            data: { userId: otherUserId, title: "Other owner's goal" }
          }
        ]
      }
    });
    assert.equal(otherGoalResponse.statusCode, 200, otherGoalResponse.body);
    const otherGoalId = (
      otherGoalResponse.json() as {
        results: Array<{ id: string; ok: boolean }>;
      }
    ).results[0]!.id;

    const deniedReplacement = await app.inject({
      method: "POST",
      url: "/api/v1/entities/update",
      headers: { cookie },
      payload: {
        operations: [
          {
            entityType: "person",
            id: personId,
            patch: {
              description: "must roll back",
              links: [{ entityType: "goal", entityId: otherGoalId }]
            }
          }
        ]
      }
    });
    assert.equal(deniedReplacement.statusCode, 200, deniedReplacement.body);
    const deniedResult = (
      deniedReplacement.json() as {
        results: Array<{ ok: boolean; error?: { code: string } }>;
      }
    ).results[0]!;
    assert.equal(deniedResult.ok, false);

    const readBack = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: { cookie },
      payload: { searches: [{ entityTypes: ["person"], ids: [personId] }] }
    });
    assert.equal(readBack.statusCode, 200, readBack.body);
    const readBackPerson = (
      readBack.json() as {
        results: Array<{
          matches: Array<{ entity: { description: string } }>;
        }>;
      }
    ).results[0]!.matches[0]!.entity;
    assert.equal(readBackPerson.description, "");
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

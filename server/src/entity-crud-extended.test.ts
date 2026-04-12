import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";

async function issueOperatorSessionCookie(
  app: Awaited<ReturnType<typeof buildServer>>
) {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/auth/operator-session",
    headers: {
      host: "127.0.0.1:4317"
    }
  });
  assert.equal(response.statusCode, 200);
  const cookie = response.cookies[0];
  assert.ok(cookie);
  return `${cookie.name}=${cookie.value}`;
}

test("batch entity routes handle preferences CRUD and questionnaire instrument CRUD", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-batch-entity-extended-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: { cookie: operatorCookie },
      payload: {
        operations: [
          {
            entityType: "preference_catalog",
            clientRef: "catalog-a",
            data: {
              userId: "user_operator",
              domain: "food",
              title: "Cafe shortlist",
              description: "Places to compare for breakfast meetings.",
              slug: "cafe-shortlist"
            }
          },
          {
            entityType: "preference_context",
            clientRef: "context-a",
            data: {
              userId: "user_operator",
              domain: "food",
              name: "Work breakfasts",
              description: "Preference slice for work-day breakfast choices.",
              shareMode: "blended",
              active: true,
              isDefault: false,
              decayDays: 60
            }
          },
          {
            entityType: "preference_item",
            clientRef: "item-a",
            data: {
              userId: "user_operator",
              domain: "food",
              label: "Flat white",
              description: "Reliable coffee choice.",
              tags: ["coffee"],
              featureWeights: {
                novelty: 0,
                simplicity: 0.7,
                rigor: 0,
                aesthetics: 0.1,
                depth: 0,
                structure: 0.2,
                familiarity: 0.9,
                surprise: -0.3
              }
            }
          },
          {
            entityType: "questionnaire_instrument",
            clientRef: "questionnaire-a",
            data: {
              title: "Tiny check-in",
              subtitle: "Custom",
              description: "One question custom instrument.",
              aliases: [],
              symptomDomains: ["check-in"],
              tags: ["custom"],
              sourceClass: "secondary_verified",
              availability: "custom",
              isSelfReport: true,
              userId: "user_operator",
              versionLabel: "Draft 1",
              definition: {
                locale: "en",
                instructions: "Rate how present this feels today.",
                completionNote: "",
                presentationMode: "single_question",
                responseStyle: "four_point_frequency",
                itemIds: ["check_1"],
                items: [
                  {
                    id: "check_1",
                    prompt: "I feel grounded.",
                    shortLabel: "",
                    description: "",
                    helperText: "",
                    required: true,
                    tags: [],
                    options: [
                      { key: "0", label: "Not at all", value: 0, description: "" },
                      { key: "1", label: "A little", value: 1, description: "" },
                      { key: "2", label: "Mostly", value: 2, description: "" },
                      { key: "3", label: "Strongly", value: 3, description: "" }
                    ]
                  }
                ],
                sections: [
                  {
                    id: "check",
                    title: "Check",
                    description: "",
                    itemIds: ["check_1"]
                  }
                ],
                pageSize: null
              },
              scoring: {
                scores: [
                  {
                    key: "total",
                    label: "Total",
                    description: "",
                    valueType: "number",
                    expression: { kind: "sum", itemIds: ["check_1"] },
                    dependsOnItemIds: ["check_1"],
                    missingPolicy: { mode: "require_all" },
                    bands: [{ label: "Strong", min: 3, max: 3, severity: "" }],
                    roundTo: null,
                    unitLabel: ""
                  }
                ]
              },
              provenance: {
                retrievalDate: "2026-04-06",
                sourceClass: "secondary_verified",
                scoringNotes: "Sum the one item.",
                sources: [
                  {
                    label: "Local draft",
                    url: "https://example.com/draft",
                    citation: "Local draft questionnaire",
                    notes: ""
                  }
                ]
              }
            }
          }
        ]
      }
    });

    assert.equal(createResponse.statusCode, 200);
    const createBody = createResponse.json() as {
      results: Array<{
        ok: boolean;
        clientRef?: string;
        entity?: { id: string; title?: string; name?: string; label?: string };
      }>;
    };
    assert.equal(createBody.results.every((result) => result.ok), true);

    const catalogId = createBody.results.find((entry) => entry.clientRef === "catalog-a")?.entity?.id;
    const contextId = createBody.results.find((entry) => entry.clientRef === "context-a")?.entity?.id;
    const itemId = createBody.results.find((entry) => entry.clientRef === "item-a")?.entity?.id;
    const questionnaireId = createBody.results.find((entry) => entry.clientRef === "questionnaire-a")?.entity?.id;
    assert.ok(catalogId);
    assert.ok(contextId);
    assert.ok(itemId);
    assert.ok(questionnaireId);

    const createCatalogItemResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: { cookie: operatorCookie },
      payload: {
        operations: [
          {
            entityType: "preference_catalog_item",
            data: {
              catalogId,
              label: "Neighborhood bakery",
              description: "A comparison candidate.",
              tags: ["bakery"],
              featureWeights: {
                novelty: 0.2,
                simplicity: 0.4,
                rigor: 0,
                aesthetics: 0.3,
                depth: 0,
                structure: 0.1,
                familiarity: 0.6,
                surprise: 0.1
              },
              position: 0
            }
          }
        ]
      }
    });
    assert.equal(createCatalogItemResponse.statusCode, 200);
    const catalogItemId = (
      createCatalogItemResponse.json() as {
        results: Array<{ entity?: { id: string } }>;
      }
    ).results[0]?.entity?.id;
    assert.ok(catalogItemId);

    const updateResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/update",
      headers: { cookie: operatorCookie },
      payload: {
        operations: [
          {
            entityType: "preference_catalog",
            id: catalogId,
            patch: { title: "Breakfast shortlist" }
          },
          {
            entityType: "preference_catalog_item",
            id: catalogItemId,
            patch: { label: "Neighborhood cafe" }
          },
          {
            entityType: "preference_context",
            id: contextId,
            patch: { name: "Breakfast work mode" }
          },
          {
            entityType: "preference_item",
            id: itemId,
            patch: { label: "Cappuccino" }
          },
          {
            entityType: "questionnaire_instrument",
            id: questionnaireId,
            patch: { title: "Tiny weekly check-in" }
          }
        ]
      }
    });

    assert.equal(updateResponse.statusCode, 200);
    const updateBody = updateResponse.json() as {
      results: Array<{
        ok: boolean;
        entity?: { title?: string; name?: string; label?: string };
      }>;
    };
    assert.equal(updateBody.results.every((result) => result.ok), true);
    assert.equal(updateBody.results[0]?.entity?.title, "Breakfast shortlist");
    assert.equal(updateBody.results[1]?.entity?.label, "Neighborhood cafe");
    assert.equal(updateBody.results[2]?.entity?.name, "Breakfast work mode");
    assert.equal(updateBody.results[3]?.entity?.label, "Cappuccino");
    assert.equal(updateBody.results[4]?.entity?.title, "Tiny weekly check-in");

    const searchResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: { cookie: operatorCookie },
      payload: {
        searches: [
          {
            entityTypes: [
              "preference_catalog",
              "preference_context",
              "preference_item",
              "preference_catalog_item",
              "questionnaire_instrument"
            ],
            query: "Tiny",
            limit: 10
          },
          {
            entityTypes: ["preference_catalog", "preference_item"],
            query: "Breakfast",
            limit: 10
          }
        ]
      }
    });

    assert.equal(searchResponse.statusCode, 200);
    const searchBody = searchResponse.json() as {
      results: Array<{
        ok: boolean;
        matches?: Array<{ entityType: string; id: string }>;
      }>;
    };
    assert.equal(searchBody.results[0]?.ok, true);
    assert.ok(
      searchBody.results[0]?.matches?.some(
        (match) =>
          match.entityType === "questionnaire_instrument" &&
          match.id === questionnaireId
      )
    );
    assert.ok(
      searchBody.results[1]?.matches?.some(
        (match) =>
          match.entityType === "preference_catalog" && match.id === catalogId
      )
    );

    const deleteResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/delete",
      headers: { cookie: operatorCookie },
      payload: {
        operations: [
          { entityType: "preference_item", id: itemId },
          { entityType: "questionnaire_instrument", id: questionnaireId }
        ]
      }
    });
    assert.equal(deleteResponse.statusCode, 200);
    const deleteBody = deleteResponse.json() as {
      results: Array<{ ok: boolean }>;
    };
    assert.equal(deleteBody.results.every((result) => result.ok), true);

    const postDeleteSearch = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: { cookie: operatorCookie },
      payload: {
        searches: [
          {
            entityTypes: ["preference_item", "questionnaire_instrument"],
            ids: [itemId, questionnaireId],
            limit: 10
          }
        ]
      }
    });
    assert.equal(postDeleteSearch.statusCode, 200);
    const postDeleteBody = postDeleteSearch.json() as {
      results: Array<{ matches?: Array<{ id: string }> }>;
    };
    assert.deepEqual(postDeleteBody.results[0]?.matches ?? [], []);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("batch entity routes create, update, search, and delete sleep and workout sessions", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-batch-health-entities-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: { cookie: operatorCookie },
      payload: {
        operations: [
          {
            entityType: "sleep_session",
            clientRef: "sleep-a",
            data: {
              startedAt: "2026-04-10T22:45:00.000Z",
              endedAt: "2026-04-11T06:45:00.000Z",
              qualitySummary: "Clean night after a light evening.",
              tags: ["recovered"]
            }
          },
          {
            entityType: "workout_session",
            clientRef: "workout-a",
            data: {
              workoutType: "walk",
              startedAt: "2026-04-11T10:00:00.000Z",
              endedAt: "2026-04-11T10:45:00.000Z",
              subjectiveEffort: 6,
              meaningText: "Reset after a long planning block."
            }
          }
        ]
      }
    });

    assert.equal(createResponse.statusCode, 200);
    const createBody = createResponse.json() as {
      results: Array<{
        ok: boolean;
        clientRef?: string;
        entity?: {
          id: string;
          source?: string;
          sourceType?: string;
          qualitySummary?: string;
          workoutType?: string;
          durationSeconds?: number;
        };
      }>;
    };
    assert.equal(createBody.results.every((result) => result.ok), true);
    const sleepEntity = createBody.results.find(
      (entry) => entry.clientRef === "sleep-a"
    )?.entity;
    const workoutEntity = createBody.results.find(
      (entry) => entry.clientRef === "workout-a"
    )?.entity;
    assert.ok(sleepEntity?.id);
    assert.ok(workoutEntity?.id);
    assert.equal(sleepEntity?.source, "manual");
    assert.equal(sleepEntity?.sourceType, "manual");
    assert.equal(workoutEntity?.source, "manual");
    assert.equal(workoutEntity?.sourceType, "manual");
    assert.equal(workoutEntity?.durationSeconds, 45 * 60);

    const updateResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/update",
      headers: { cookie: operatorCookie },
      payload: {
        operations: [
          {
            entityType: "sleep_session",
            id: sleepEntity!.id,
            patch: {
              notes: "Woke once around 03:00 but settled quickly.",
              tags: ["recovered", "travel"]
            }
          },
          {
            entityType: "workout_session",
            id: workoutEntity!.id,
            patch: {
              moodAfter: "clear",
              tags: ["zone2"]
            }
          }
        ]
      }
    });

    assert.equal(updateResponse.statusCode, 200);
    const updateBody = updateResponse.json() as {
      results: Array<{
        ok: boolean;
        entity?: {
          annotations?: { notes?: string };
          moodAfter?: string;
        };
      }>;
    };
    assert.equal(updateBody.results.every((result) => result.ok), true);
    assert.equal(
      updateBody.results[0]?.entity?.annotations?.notes,
      "Woke once around 03:00 but settled quickly."
    );
    assert.equal(updateBody.results[1]?.entity?.moodAfter, "clear");

    const searchResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: { cookie: operatorCookie },
      payload: {
        searches: [
          {
            entityTypes: ["sleep_session", "workout_session"],
            ids: [sleepEntity!.id, workoutEntity!.id],
            limit: 10
          }
        ]
      }
    });

    assert.equal(searchResponse.statusCode, 200);
    const searchBody = searchResponse.json() as {
      results: Array<{
        ok: boolean;
        matches?: Array<{ entityType: string; id: string }>;
      }>;
    };
    assert.equal(searchBody.results[0]?.ok, true);
    assert.ok(
      searchBody.results[0]?.matches?.some(
        (match) =>
          match.entityType === "sleep_session" && match.id === sleepEntity!.id
      )
    );
    assert.ok(
      searchBody.results[0]?.matches?.some(
        (match) =>
          match.entityType === "workout_session" &&
          match.id === workoutEntity!.id
      )
    );

    const deleteResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/delete",
      headers: { cookie: operatorCookie },
      payload: {
        operations: [
          { entityType: "sleep_session", id: sleepEntity!.id },
          { entityType: "workout_session", id: workoutEntity!.id }
        ]
      }
    });
    assert.equal(deleteResponse.statusCode, 200);
    const deleteBody = deleteResponse.json() as {
      results: Array<{ ok: boolean }>;
    };
    assert.equal(deleteBody.results.every((result) => result.ok), true);

    const deletedSleep = await app.inject({
      method: "GET",
      url: `/api/v1/health/sleep/${sleepEntity!.id}`
    });
    const deletedWorkout = await app.inject({
      method: "GET",
      url: `/api/v1/health/workouts/${workoutEntity!.id}`
    });
    assert.equal(deletedSleep.statusCode, 404);
    assert.equal(deletedWorkout.statusCode, 404);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("batch entity validation failures return rich per-operation repair guidance", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-batch-health-validation-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: { cookie: operatorCookie },
      payload: {
        operations: [
          {
            entityType: "sleep_session",
            clientRef: "sleep-missing",
            data: {
              qualitySummary: "Missing timestamps."
            }
          },
          {
            entityType: "workout_session",
            clientRef: "workout-missing",
            data: {
              meaningText: "Missing workout type and timestamps."
            }
          },
          {
            entityType: "work_block_template",
            clientRef: "work-block-enum",
            data: {
              title: "Broken block",
              kind: "mystery",
              timezone: "Europe/Zurich",
              weekDays: [1],
              startMinute: 480,
              endMinute: 600,
              blockingState: "blocked"
            }
          }
        ]
      }
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      results: Array<{
        ok: boolean;
        clientRef?: string;
        error?: {
          code: string;
          operationType?: string;
          entityType?: string;
          clientRef?: string;
          routeHint?: string;
          toolHint?: string;
          summary?: string;
          issues?: Array<{
            path: string;
            message: string;
            allowedValues?: unknown[];
          }>;
          missingRequiredFields?: string[];
          invalidValueGuidance?: Array<{
            path: string;
            allowedValues: unknown[];
            message: string;
          }>;
          allowedTopLevelFields?: string[];
          minimalExamplePayload?: Record<string, unknown>;
        };
      }>;
    };

    const sleepError = body.results.find(
      (result) => result.clientRef === "sleep-missing"
    )?.error;
    assert.equal(sleepError?.code, "validation_failed");
    assert.equal(sleepError?.operationType, "create");
    assert.equal(sleepError?.entityType, "sleep_session");
    assert.equal(sleepError?.clientRef, "sleep-missing");
    assert.equal(sleepError?.routeHint, "/api/v1/entities/create");
    assert.equal(sleepError?.toolHint, "forge_create_entities");
    assert.match(sleepError?.summary ?? "", /sleep_session create payload failed validation/i);
    assert.ok(sleepError?.missingRequiredFields?.includes("startedAt"));
    assert.ok(sleepError?.missingRequiredFields?.includes("endedAt"));
    assert.ok(sleepError?.allowedTopLevelFields?.includes("startedAt"));
    assert.ok(sleepError?.allowedTopLevelFields?.includes("endedAt"));
    assert.deepEqual(sleepError?.minimalExamplePayload, {
      startedAt: "string",
      endedAt: "string"
    });

    const workoutError = body.results.find(
      (result) => result.clientRef === "workout-missing"
    )?.error;
    assert.equal(workoutError?.code, "validation_failed");
    assert.equal(workoutError?.entityType, "workout_session");
    assert.ok(workoutError?.missingRequiredFields?.includes("workoutType"));
    assert.ok(workoutError?.missingRequiredFields?.includes("startedAt"));
    assert.ok(workoutError?.missingRequiredFields?.includes("endedAt"));
    assert.deepEqual(workoutError?.minimalExamplePayload, {
      workoutType: "string",
      startedAt: "string",
      endedAt: "string"
    });

    const enumError = body.results.find(
      (result) => result.clientRef === "work-block-enum"
    )?.error;
    assert.equal(enumError?.code, "validation_failed");
    assert.equal(enumError?.entityType, "work_block_template");
    assert.ok(
      enumError?.invalidValueGuidance?.some(
        (issue) =>
          issue.path === "kind" &&
          issue.allowedValues.includes("main_activity")
      )
    );
    assert.ok(
      enumError?.issues?.some(
        (issue) =>
          issue.path === "kind" &&
          (issue.allowedValues ?? []).includes("main_activity")
      )
    );
    assert.ok(enumError?.allowedTopLevelFields?.includes("blockingState"));
    assert.ok(enumError?.minimalExamplePayload?.title);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

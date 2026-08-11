import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { buildServer } from "./app.js";
import type { ComparisonLane } from "./comparison-types.js";
import { closeDatabase, getDatabase, runInTransaction } from "./db.js";
import { createPreferenceContextSchema } from "./preferences-types.js";
import { createInsight } from "./repositories/collaboration.js";
import { upsertDeletedEntityRecord } from "./repositories/deleted-entities.js";
import { setEntityOwner } from "./repositories/entity-ownership.js";
import { createNote } from "./repositories/notes.js";
import {
  createPreferenceContext,
  createPreferenceItem,
  refreshPreferenceWorkspace
} from "./repositories/preferences.js";
import { createTriggerReport } from "./repositories/psyche.js";
import { createInsightSchema, createNoteSchema } from "./types.js";

const dimensions = {
  novelty: 0,
  simplicity: 0,
  rigor: 0,
  aesthetics: 0,
  depth: 0,
  structure: 0,
  familiarity: 0,
  surprise: 0
};

async function issueToken(
  app: Awaited<ReturnType<typeof buildServer>>,
  cookie: string,
  input: { userIds: string[]; scopes: string[]; label: string }
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/settings/tokens",
    headers: { cookie },
    payload: {
      label: input.label,
      scopes: input.scopes,
      scopePolicy: {
        userIds: input.userIds,
        projectIds: [],
        tagIds: []
      }
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { token: { token: string } }).token.token;
}

function isoDay(offset = 0) {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

function comparisonUrl(input: {
  selections: string[];
  from?: string;
  to?: string;
  timeZone?: string;
  alignment?: string;
  userId?: string;
}) {
  const params = new URLSearchParams({
    userId: input.userId ?? "user_operator",
    from: input.from ?? isoDay(-1),
    to: input.to ?? isoDay(),
    timeZone: input.timeZone ?? "UTC",
    alignment: input.alignment ?? "separate_tracks"
  });
  input.selections.forEach((selection) =>
    params.append("selection", selection)
  );
  return `/api/v1/comparisons?${params.toString()}`;
}

function percentile95(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]!;
}

async function measureP95(
  repeats: number,
  operation: () => Promise<{ statusCode: number; body: string }>
) {
  await operation();
  await operation();
  const durations: number[] = [];
  for (let index = 0; index < repeats; index += 1) {
    const startedAt = performance.now();
    const response = await operation();
    durations.push(performance.now() - startedAt);
    assert.equal(response.statusCode, 200, response.body);
  }
  return percentile95(durations);
}

test("PREF-08 comparison API is permission-first, complete, explicit about gaps, and bounded", async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "forge-comparison-"));
  const app = await buildServer({
    dataRoot,
    seedDemoData: true,
    devrageMetricSync: false,
    peerRuntime: false,
    taskRunWatchdog: false
  });

  try {
    const cookie = await issueTestOperatorSessionCookie(app);
    const token = await issueToken(app, cookie, {
      userIds: ["user_operator"],
      scopes: ["read", "psyche.read"],
      label: "PREF-08 authorized reader"
    });
    const headers = { authorization: `Bearer ${token}` };
    const noReadToken = await issueToken(app, cookie, {
      userIds: ["user_operator"],
      scopes: ["write"],
      label: "PREF-08 reader without read scope"
    });

    const anonymousMalformed = await app.inject({
      method: "GET",
      url: "/api/v1/comparisons?selection=broken&from=no&to=no&userId=missing&timeZone=no"
    });
    assert.equal(anonymousMalformed.statusCode, 401);
    const deniedMalformed = await app.inject({
      method: "GET",
      url: "/api/v1/comparisons?selection=broken&from=no&to=no&userId=missing&timeZone=no",
      headers: { authorization: `Bearer ${noReadToken}` }
    });
    assert.equal(deniedMalformed.statusCode, 403);

    const foreignScope = await app.inject({
      method: "GET",
      url: "/api/v1/comparisons/catalog?userId=user_forge_bot",
      headers
    });
    const missingScope = await app.inject({
      method: "GET",
      url: "/api/v1/comparisons/catalog?userId=user_missing_opaque",
      headers
    });
    assert.equal(foreignScope.statusCode, 404);
    assert.equal(missingScope.statusCode, 404);
    assert.deepEqual(foreignScope.json(), missingScope.json());
    assert.equal(foreignScope.json().code, "comparison_scope_unavailable");

    const workspace = refreshPreferenceWorkspace({
      userId: "user_operator",
      domain: "projects"
    });
    const context = createPreferenceContext(
      createPreferenceContextSchema.parse({
        userId: "user_operator",
        domain: "projects",
        name: "Comparison context",
        active: true,
        isDefault: false
      })
    );
    const preferenceItem = createPreferenceItem({
      userId: "user_operator",
      domain: "projects",
      label: "Comparison preference",
      description: "A deterministic preference fixture.",
      tags: [],
      featureWeights: dimensions,
      metadata: {},
      queueForCompare: false
    });
    const now = new Date().toISOString();
    getDatabase()
      .prepare(
        `INSERT INTO preference_snapshots (
           id, profile_id, context_id, summary_metrics_json,
           serialized_model_state_json, created_at
         ) VALUES (?, ?, ?, '{}', ?, ?)`
      )
      .run(
        "pref_snapshot_comparison_missing",
        workspace.profile.id,
        context.id,
        JSON.stringify({
          topScores: Array.from({ length: 12 }, (_, index) => ({
            itemId: `other_item_${index}`,
            latentScore: index / 10
          }))
        }),
        now
      );

    getDatabase()
      .prepare(
        `INSERT INTO health_daily_summaries (
           id, user_id, date_key, summary_type, metrics_json, derived_json,
           source, created_at, updated_at
         ) VALUES (?, ?, ?, 'vitals', ?, '{}', 'healthkit', ?, ?)`
      )
      .run(
        "health_comparison_today",
        "user_operator",
        isoDay(),
        JSON.stringify({
          resting_heart_rate: {
            metric: "resting_heart_rate",
            label: "Resting heart rate",
            category: "heart",
            unit: "count/min",
            displayUnit: "bpm",
            aggregation: "discrete",
            average: 58,
            minimum: 56,
            maximum: 61,
            latest: 59,
            total: null,
            sampleCount: 3,
            latestSampleAt: now
          },
          walking_heart_rate: {
            metric: "walking_heart_rate",
            label: "Walking heart rate",
            category: "heart",
            unit: "count/min",
            displayUnit: "bpm",
            aggregation: "discrete",
            average: 92,
            minimum: 88,
            maximum: 97,
            latest: 93,
            total: null,
            sampleCount: 3,
            latestSampleAt: now
          },
          step_count: {
            metric: "step_count",
            label: "Steps",
            category: "activity",
            unit: "count",
            displayUnit: "steps",
            aggregation: "cumulative",
            average: null,
            minimum: null,
            maximum: null,
            latest: 6000,
            total: 6200,
            sampleCount: 20,
            latestSampleAt: now
          }
        }),
        now,
        now
      );

    createTriggerReport(
      {
        title: "Comparison emotion report",
        occurredAt: now,
        emotions: [
          {
            emotionDefinitionId: null,
            label: "Calm",
            intensity: 42,
            note: ""
          }
        ],
        userId: "user_operator"
      },
      {
        source: "system",
        actor: "comparison-readiness-test",
        userIds: ["user_operator"]
      }
    );

    const insight = createInsight(
      createInsightSchema.parse({
        title: "Comparison insight",
        summary: "Current insight summary.",
        recommendation: "Review the current insight.",
        evidence: [
          { entityType: "task", entityId: "task_1", label: "Task evidence" }
        ]
      }),
      { source: "system", actor: "comparison-readiness-test" }
    );
    setEntityOwner("insight", insight.id, "user_operator");
    const foreignInsight = createInsight(
      createInsightSchema.parse({
        title: "Foreign comparison insight",
        summary: "This must not be disclosed.",
        recommendation: "Do not disclose."
      }),
      { source: "system", actor: "comparison-readiness-test" }
    );
    setEntityOwner("insight", foreignInsight.id, "user_forge_bot");
    const hiddenInsight = createInsight(
      createInsightSchema.parse({
        title: "Archived comparison insight",
        summary: "This archived record must be unavailable.",
        recommendation: "Do not disclose.",
        visibility: "archived"
      }),
      { source: "system", actor: "comparison-readiness-test" }
    );
    setEntityOwner("insight", hiddenInsight.id, "user_operator");

    const note = createNote(
      createNoteSchema.parse({
        title: "Comparison note",
        contentMarkdown: "Current note content.",
        summary: "Current Note fixture.",
        userId: "user_operator"
      }),
      { source: "system", actor: "comparison-readiness-test" }
    );
    const foreignNote = createNote(
      createNoteSchema.parse({
        title: "Foreign comparison note",
        contentMarkdown: "This must not be disclosed.",
        userId: "user_forge_bot"
      }),
      { source: "system", actor: "comparison-readiness-test" }
    );
    const deletedNote = createNote(
      createNoteSchema.parse({
        title: "Deleted comparison note",
        contentMarkdown: "This deleted record must be unavailable.",
        userId: "user_operator"
      }),
      { source: "system", actor: "comparison-readiness-test" }
    );
    upsertDeletedEntityRecord({
      entityType: "note",
      entityId: deletedNote.id,
      title: deletedNote.title,
      snapshot: deletedNote,
      context: { source: "system", actor: "comparison-readiness-test" }
    });

    const wikiCreate = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/pages",
      headers: { cookie },
      payload: {
        title: "Comparison wiki page",
        contentMarkdown: "# Comparison wiki page\n\nCurrent Wiki content.",
        summary: "Current Wiki fixture.",
        userId: "user_operator"
      }
    });
    assert.equal(wikiCreate.statusCode, 201, wikiCreate.body);
    const wiki = wikiCreate.json().page as {
      id: string;
      slug: string;
      spaceId: string;
    };

    const familyExpectedSelectors: Record<string, string> = {
      preference: `preference:${preferenceItem.id}:${context.id}`,
      health: "health:resting_heart_rate",
      psyche: "psyche:reportedEmotionIntensity",
      insight: `insight:${insight.id}`,
      note: `note:${note.id}`,
      wiki: `wiki:${wiki.id}`
    };
    for (const [family, selector] of Object.entries(familyExpectedSelectors)) {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/comparisons/catalog?userId=user_operator&family=${family}&limit=100`,
        headers
      });
      assert.equal(response.statusCode, 200, response.body);
      const body = response.json() as {
        items: Array<{ selector: string; family: string }>;
      };
      assert.ok(
        body.items.some((item) => item.selector === selector),
        family
      );
      assert.ok(
        body.items.every((item) => item.family === family),
        family
      );
    }

    const openApiResponse = await app.inject({
      method: "GET",
      url: "/api/v1/openapi.json",
      headers: { cookie }
    });
    assert.equal(openApiResponse.statusCode, 200, openApiResponse.body);
    const openApi = openApiResponse.json() as {
      components: { schemas: Record<string, unknown> };
      paths: Record<
        string,
        {
          get: {
            parameters: Array<{ name: string }>;
            responses: Record<
              string,
              {
                content: Record<
                  string,
                  { schema: { $ref: string } }
                >;
              }
            >;
          };
        }
      >;
    };
    assert.ok(openApi.components.schemas.ComparisonCatalogResponse);
    assert.ok(openApi.components.schemas.ComparisonResponse);
    assert.deepEqual(
      openApi.paths["/api/v1/comparisons/catalog"].get.parameters.map(
        (parameter) => parameter.name
      ),
      ["userId", "query", "family", "limit", "cursor"]
    );
    assert.deepEqual(
      openApi.paths["/api/v1/comparisons"].get.parameters.map(
        (parameter) => parameter.name
      ),
      ["userId", "selection", "from", "to", "timeZone", "alignment"]
    );
    assert.equal(
      openApi.paths["/api/v1/comparisons"].get.responses["200"].content[
        "application/json"
      ].schema.$ref,
      "#/components/schemas/ComparisonResponse"
    );

    for (let index = 0; index < 3; index += 1) {
      createNote(
        createNoteSchema.parse({
          title: `Pagination comparison ${index}`,
          contentMarkdown: `Pagination comparison evidence ${index}.`,
          summary: "pagination-comparison",
          userId: "user_operator"
        }),
        { source: "system", actor: "comparison-readiness-test" }
      );
    }
    const firstPage = await app.inject({
      method: "GET",
      url: "/api/v1/comparisons/catalog?userId=user_operator&family=note&query=pagination-comparison&limit=2",
      headers
    });
    assert.equal(firstPage.statusCode, 200, firstPage.body);
    assert.equal(firstPage.json().items.length, 2);
    assert.equal(firstPage.json().hasMore, true);
    const secondPage = await app.inject({
      method: "GET",
      url: `/api/v1/comparisons/catalog?userId=user_operator&family=note&query=pagination-comparison&limit=2&cursor=${encodeURIComponent(firstPage.json().nextCursor)}`,
      headers
    });
    assert.equal(secondPage.statusCode, 200, secondPage.body);
    assert.equal(secondPage.json().items.length, 1);
    assert.equal(secondPage.json().hasMore, false);
    assert.equal(
      new Set(
        [...firstPage.json().items, ...secondPage.json().items].map(
          (item) => item.selector
        )
      ).size,
      3
    );
    const reboundCursor = await app.inject({
      method: "GET",
      url: `/api/v1/comparisons/catalog?userId=user_operator&family=wiki&query=pagination-comparison&limit=2&cursor=${encodeURIComponent(firstPage.json().nextCursor)}`,
      headers
    });
    assert.equal(reboundCursor.statusCode, 400);
    assert.equal(
      reboundCursor.json().code,
      "comparison_catalog_cursor_invalid"
    );

    const preferenceSelector = `preference:${preferenceItem.id}:${context.id}`;
    const comparison = await app.inject({
      method: "GET",
      url: comparisonUrl({
        selections: [
          preferenceSelector,
          "health:resting_heart_rate",
          "psyche:reportedEmotionIntensity",
          `insight:${insight.id}`,
          `note:${note.id}`,
          `wiki:${wiki.id}`
        ]
      }),
      headers
    });
    assert.equal(comparison.statusCode, 200, comparison.body);
    const lanes = comparison.json().lanes as ComparisonLane[];
    assert.deepEqual(
      lanes.map((lane) => lane.selector),
      [
        preferenceSelector,
        "health:resting_heart_rate",
        "psyche:reportedEmotionIntensity",
        `insight:${insight.id}`,
        `note:${note.id}`,
        `wiki:${wiki.id}`
      ]
    );
    const preferenceLane = lanes[0];
    assert.equal(preferenceLane.unit, "score");
    const preferenceLimitation = preferenceLane.limitation;
    assert.ok(preferenceLimitation);
    assert.match(preferenceLimitation, /top 12/i);
    assert.ok(
      preferenceLane.points.some((point) => point.missingReason === "not_stored")
    );
    const healthLane = lanes[1];
    assert.equal(healthLane.unit, "bpm");
    assert.equal(healthLane.points.length, 2);
    assert.equal(healthLane.points[0].missingReason, "not_recorded");
    assert.equal(healthLane.points[1].value, 59);
    assert.equal(healthLane.sourceHref, "/vitals");
    const psycheLane = lanes[2];
    assert.equal(psycheLane.unit, "/100");
    assert.equal(psycheLane.points.length, 2);
    assert.equal(psycheLane.points[0].missingReason, "not_recorded");
    assert.equal(psycheLane.points[1].value, 42);
    assert.equal(psycheLane.sourceHref, "/psyche");
    const currentOnlyLimitation = lanes[3].limitation;
    assert.ok(currentOnlyLimitation);
    assert.match(currentOnlyLimitation, /does not reconstruct/i);
    assert.equal(
      lanes[3].sourceHref,
      `/knowledge-graph?focus=${encodeURIComponent(`insight:${insight.id}`)}`
    );
    assert.equal(lanes[4].sourceHref, `/notes?focus=${note.id}`);
    assert.equal(
      lanes[5].sourceHref,
      `/wiki/page/${encodeURIComponent(wiki.slug)}?spaceId=${encodeURIComponent(wiki.spaceId)}`
    );

    const generic = await app.inject({
      method: "GET",
      url: comparisonUrl({
        selections: [
          "note:missing_note",
          `note:${deletedNote.id}`,
          `note:${foreignNote.id}`,
          `insight:${hiddenInsight.id}`,
          `insight:${foreignInsight.id}`
        ]
      }),
      headers
    });
    assert.equal(generic.statusCode, 200, generic.body);
    const unavailable = generic.json().lanes as ComparisonLane[];
    assert.ok(unavailable.every((lane) => lane.state === "unavailable"));
    for (const lane of unavailable) {
      assert.equal(lane.family, null);
      assert.equal(lane.title, "Unavailable selection");
      assert.equal(lane.sourceHref, null);
      assert.deepEqual(lane.points, []);
    }

    const sharedAccepted = await app.inject({
      method: "GET",
      url: comparisonUrl({
        selections: ["health:resting_heart_rate", "health:walking_heart_rate"],
        alignment: "shared_axis"
      }),
      headers
    });
    assert.equal(sharedAccepted.statusCode, 200, sharedAccepted.body);
    assert.equal(sharedAccepted.json().alignmentApplied, "shared_axis");
    assert.equal(sharedAccepted.json().sharedAxisReason, null);
    const sharedRefused = await app.inject({
      method: "GET",
      url: comparisonUrl({
        selections: ["health:resting_heart_rate", "health:step_count"],
        alignment: "shared_axis"
      }),
      headers
    });
    assert.equal(sharedRefused.statusCode, 200, sharedRefused.body);
    assert.equal(sharedRefused.json().alignmentApplied, "separate_tracks");
    assert.match(sharedRefused.json().sharedAxisReason, /same recorded unit/i);

    const invalidCases = [
      comparisonUrl({ selections: [] }),
      comparisonUrl({
        selections: Array.from({ length: 9 }, (_, index) => `note:n${index}`)
      }),
      comparisonUrl({ selections: ["note:duplicate", "note:duplicate"] }),
      comparisonUrl({ selections: ["unknown:value"] }),
      comparisonUrl({
        selections: ["note:value"],
        from: "2025-01-01",
        to: "2026-01-02"
      }),
      comparisonUrl({ selections: ["note:value"], timeZone: "Not/A_Time_Zone" })
    ];
    for (const url of invalidCases) {
      const response = await app.inject({ method: "GET", url, headers });
      assert.equal(response.statusCode, 400, response.body);
    }

    const oversizedItems = Array.from({ length: 8 }, (_, index) =>
      createPreferenceItem({
        userId: "user_operator",
        domain: "projects",
        label: `Oversized comparison item ${index}`,
        description: "Point-cap fixture.",
        tags: [],
        featureWeights: dimensions,
        metadata: {},
        queueForCompare: false
      })
    );
    const database = getDatabase();
    const insertSnapshot = database.prepare(
      `INSERT INTO preference_snapshots (
         id, profile_id, context_id, summary_metrics_json,
         serialized_model_state_json, created_at
       ) VALUES (?, ?, ?, '{}', '{"topScores":[]}', ?)`
    );
    runInTransaction(() => {
      for (let index = 0; index < 376; index += 1) {
        insertSnapshot.run(
          `pref_snapshot_point_cap_${index}`,
          workspace.profile.id,
          context.id,
          new Date(Date.now() + index).toISOString()
        );
      }
    });
    const oversized = await app.inject({
      method: "GET",
      url: comparisonUrl({
        selections: oversizedItems.map(
          (item) => `preference:${item.id}:${context.id}`
        ),
        from: isoDay(),
        to: isoDay()
      }),
      headers
    });
    assert.equal(oversized.statusCode, 400, oversized.body);
    assert.equal(oversized.json().code, "comparison_point_limit_exceeded");

    runInTransaction(() => {
      for (let index = 376; index < 3_001; index += 1) {
        insertSnapshot.run(
          `pref_snapshot_dense_bound_${index}`,
          workspace.profile.id,
          context.id,
          new Date(Date.now() + index).toISOString()
        );
      }
    });
    const originalOwnPrepare = Object.getOwnPropertyDescriptor(
      database,
      "prepare"
    );
    const originalPrepare = database.prepare.bind(database);
    let hydrationQueryPrepared = false;
    Object.defineProperty(database, "prepare", {
      configurable: true,
      value(source: string) {
        if (/SELECT id, serialized_model_state_json, created_at/.test(source)) {
          hydrationQueryPrepared = true;
        }
        return originalPrepare(source);
      }
    });
    try {
      const denseRefusal = await app.inject({
        method: "GET",
        url: comparisonUrl({
          selections: [`preference:${oversizedItems[0]!.id}:${context.id}`],
          from: isoDay(),
          to: isoDay()
        }),
        headers
      });
      assert.equal(denseRefusal.statusCode, 400, denseRefusal.body);
      assert.equal(denseRefusal.json().code, "comparison_point_limit_exceeded");
      assert.equal(
        hydrationQueryPrepared,
        false,
        "dense preference history must be refused before snapshot JSON hydration"
      );
    } finally {
      if (originalOwnPrepare) {
        Object.defineProperty(database, "prepare", originalOwnPrepare);
      } else {
        delete (database as unknown as Record<string, unknown>).prepare;
      }
      database
        .prepare(
          "DELETE FROM preference_snapshots WHERE id LIKE 'pref_snapshot_dense_bound_%'"
        )
        .run();
    }

    const insertNote = database.prepare(
      `INSERT INTO notes (
         id, kind, title, slug, space_id, aliases_json, summary,
         content_markdown, content_plain, author, source, tags_json,
         destroy_at, source_path, frontmatter_json, revision_hash,
         last_synced_at, parent_slug, index_order, show_in_index,
         created_at, updated_at
       ) VALUES (?, 'evidence', ?, ?, 'default', '[]', '', ?, ?, NULL,
                 'system', '[]', NULL, '', '{}', '', NULL, NULL, 0, 0, ?, ?)`
    );
    const insertOwner = database.prepare(
      `INSERT INTO entity_owners (
         entity_type, entity_id, user_id, role, created_at, updated_at
       ) VALUES (?, ?, 'user_operator', 'owner', ?, ?)`
    );
    const insertInsight = database.prepare(
      `INSERT INTO insights (
         id, origin_type, origin_agent_id, origin_label, visibility, status,
         entity_type, entity_id, timeframe_label, title, summary,
         recommendation, rationale, confidence, cta_label, evidence_json,
         created_at, updated_at
       ) VALUES (?, 'system', NULL, NULL, 'visible', 'open', NULL, NULL, NULL,
                 ?, ?, 'Review.', '', 0.7, 'Review insight', '[]', ?, ?)`
    );
    const insertPreference = database.prepare(
      `INSERT INTO preference_items (
         id, profile_id, label, description, tags_json, feature_weights_json,
         source_entity_type, source_entity_id, metadata_json, created_at, updated_at
       ) VALUES (?, ?, ?, '', '[]', ?, NULL, NULL, '{}', ?, ?)`
    );
    runInTransaction(() => {
      for (let index = 0; index < 10_000; index += 1) {
        const noteId = `note_perf_${String(index).padStart(5, "0")}`;
        const insightId = `ins_perf_${String(index).padStart(5, "0")}`;
        const createdAt = new Date(Date.now() - index).toISOString();
        insertNote.run(
          noteId,
          `Performance note ${index}`,
          noteId,
          `Performance evidence ${index}`,
          `Performance evidence ${index}`,
          createdAt,
          createdAt
        );
        insertOwner.run("note", noteId, createdAt, createdAt);
        insertInsight.run(
          insightId,
          `Performance insight ${index}`,
          `Performance insight summary ${index}`,
          createdAt,
          createdAt
        );
        insertOwner.run("insight", insightId, createdAt, createdAt);
      }
      for (let index = 0; index < 2_000; index += 1) {
        const createdAt = new Date(Date.now() - index).toISOString();
        insertPreference.run(
          `pref_item_perf_${String(index).padStart(4, "0")}`,
          workspace.profile.id,
          `Performance preference ${index}`,
          JSON.stringify(dimensions),
          createdAt,
          createdAt
        );
      }
    });

    const fullCatalogP95 = await measureP95(20, async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/comparisons/catalog?userId=user_operator&limit=40",
        headers
      });
      return { statusCode: response.statusCode, body: response.body };
    });
    const selectedCatalogP95 = await measureP95(20, async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/comparisons/catalog?userId=user_operator&family=insight&limit=40",
        headers
      });
      return { statusCode: response.statusCode, body: response.body };
    });
    const comparisonP95 = await measureP95(20, async () => {
      const response = await app.inject({
        method: "GET",
        url: comparisonUrl({
          selections: [
            preferenceSelector,
            "health:resting_heart_rate",
            "psyche:reportedEmotionIntensity",
            `insight:${insight.id}`,
            `note:${note.id}`
          ]
        }),
        headers
      });
      return { statusCode: response.statusCode, body: response.body };
    });
    console.log(
      `PREF-08 performance p95: full catalog=${fullCatalogP95.toFixed(3)}ms; selected insight catalog=${selectedCatalogP95.toFixed(3)}ms; five-family comparison=${comparisonP95.toFixed(3)}ms`
    );
    assert.ok(fullCatalogP95 <= 150, `full catalog p95 ${fullCatalogP95}ms`);
    assert.ok(
      selectedCatalogP95 <= 30,
      `selected-family catalog p95 ${selectedCatalogP95}ms`
    );
    assert.ok(
      comparisonP95 <= 77.5,
      `five-family comparison p95 ${comparisonP95}ms`
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

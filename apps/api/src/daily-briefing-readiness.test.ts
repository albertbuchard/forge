import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { buildServer } from "./app.js";
import {
  DAILY_BRIEFING_LIMITS,
  dailyBriefingSchema,
  type BuildDailyBriefingInput
} from "./daily-briefing-types.js";
import { closeDatabase, getDatabase } from "./db.js";
import { buildOpenApiDocument } from "./openapi.js";
import { buildDerivedDataProvenance } from "./provenance.js";
import { setEntityOwner } from "./repositories/entity-ownership.js";
import { createUser, getDefaultUser } from "./repositories/users.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import {
  buildDailyBriefing,
  dailyBriefingDayRange
} from "./services/daily-briefing.js";
import { readPersistedLifeForceSummary } from "./services/life-force.js";

const NOW = new Date("2026-03-29T10:00:00.000Z");
const FRESH = "2026-03-29T09:55:00.000Z";

function makeInput(
  overrides: Partial<BuildDailyBriefingInput> = {}
): BuildDailyBriefingInput {
  const capacityProvenance = buildDerivedDataProvenance({
    generatedAt: NOW.toISOString(),
    observedAt: FRESH,
    staleAfterSeconds: 30 * 60,
    sourceSummary: "Persisted Life Force fixture",
    completeness: "complete",
    completenessReason:
      "The fixture includes a stored snapshot and ledger row.",
    confidence: {
      level: "medium",
      reason: "The quantities are stored observations."
    },
    sources: [
      {
        id: "life-force-day:fixture",
        label: "Persisted Life Force day",
        kind: "derived",
        observedAt: FRESH,
        detailRoute: "/life-force"
      }
    ],
    evidence: [
      {
        label: "Fixture snapshot",
        reference: "life_force_day_snapshot:fixture",
        observedAt: FRESH
      }
    ]
  });
  return {
    ownerUserId: "owner-a",
    now: NOW,
    timeZone: "Europe/Zurich",
    work: {
      tasks: [
        {
          id: "task-current",
          title: "Prepare the daily review",
          status: "focus",
          priority: "high",
          dueDate: "2026-03-29",
          projectId: null,
          updatedAt: FRESH
        }
      ],
      activeRuns: [],
      tasksTruncated: false,
      activeRunsTruncated: false
    },
    schedule: {
      events: [
        {
          id: "event-current",
          title: "Planning block",
          startAt: "2026-03-29T11:00:00.000Z",
          endAt: "2026-03-29T12:00:00.000Z",
          isAllDay: false,
          originType: "native",
          updatedAt: FRESH,
          observedAt: NOW.toISOString()
        }
      ],
      truncated: false
    },
    capacity: {
      summary: {
        userId: "owner-a",
        dateKey: "2026-03-29",
        dailyBudgetAp: 100,
        spentTodayAp: 25,
        remainingAp: 75,
        readinessMultiplier: 1,
        sleepRecoveryMultiplier: 1,
        fatigueDebtCarry: 0,
        updatedAt: FRESH,
        provenance: capacityProvenance
      }
    },
    recentActivity: {
      events: [
        {
          id: "activity-current",
          entityType: "task",
          entityId: "task-current",
          title: "Completed the evidence outline",
          createdAt: FRESH
        }
      ],
      truncated: false
    },
    ...overrides
  };
}

function percentile(samples: number[], fraction: number) {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)]!;
}

test("HOME-09 builds deterministic sourced statements and explicit omissions without conclusions", () => {
  const first = buildDailyBriefing(makeInput());
  const second = buildDailyBriefing(makeInput());
  assert.deepEqual(first, second);
  assert.equal(first.contractVersion, 1);
  assert.equal(
    first.sections.map((section) => section.key).join(","),
    "work,schedule,capacity,recent_activity"
  );
  assert.match(first.headline, /Prepare the daily review/);
  for (const section of first.sections) {
    if (section.status !== "ready") {
      assert.ok(section.omissionReason);
    }
    for (const statement of section.statements) {
      assert.equal(statement.freshness, statement.provenance.freshness);
      assert.ok(statement.provenance.sources.length > 0);
      assert.ok(statement.provenance.evidence.length > 0);
      assert.ok(
        statement.provenance.evidence.length <=
          DAILY_BRIEFING_LIMITS.evidencePerStatement
      );
    }
  }

  const empty = buildDailyBriefing(
    makeInput({
      work: {
        tasks: [],
        activeRuns: [],
        tasksTruncated: false,
        activeRunsTruncated: false
      },
      schedule: { events: [], truncated: false },
      capacity: { summary: null },
      recentActivity: { events: [], truncated: false }
    })
  );
  assert.equal(empty.status, "empty");
  assert.ok(empty.sections.every((section) => section.omissionReason));
  assert.match(empty.headline, /No current statement/);
});

test("HOME-09 preserves active-work and schedule conflicts and excludes stale or future evidence", () => {
  const input = makeInput();
  input.work.activeRuns = [
    {
      id: "run-a",
      taskId: "task-current",
      taskTitle: "Prepare the daily review",
      claimedAt: "2026-03-29T09:00:00.000Z",
      heartbeatAt: FRESH
    },
    {
      id: "run-b",
      taskId: "task-other",
      taskTitle: "Resolve the release note",
      claimedAt: "2026-03-29T09:01:00.000Z",
      heartbeatAt: FRESH
    }
  ];
  input.schedule.events.push({
    id: "event-overlap",
    title: "Overlapping call",
    startAt: "2026-03-29T11:30:00.000Z",
    endAt: "2026-03-29T12:30:00.000Z",
    isAllDay: false,
    originType: "native",
    updatedAt: FRESH,
    observedAt: NOW.toISOString()
  });
  input.recentActivity.events = [
    {
      id: "activity-future",
      entityType: "task",
      entityId: "task-current",
      title: "Future activity",
      createdAt: "2026-03-29T10:06:00.000Z"
    }
  ];
  input.capacity.summary = {
    ...input.capacity.summary!,
    provenance: buildDerivedDataProvenance({
      generatedAt: NOW.toISOString(),
      observedAt: "2026-03-29T08:00:00.000Z",
      staleAfterSeconds: 30 * 60,
      sourceSummary: "Stale capacity fixture",
      completeness: "complete",
      completenessReason: "Fixture",
      confidence: { level: "low", reason: "Fixture" },
      sources: [
        {
          id: "capacity-stale",
          label: "Capacity fixture",
          kind: "derived",
          observedAt: "2026-03-29T08:00:00.000Z",
          detailRoute: "/life-force"
        }
      ],
      evidence: [
        {
          label: "Capacity fixture",
          reference: "life_force_day_snapshot:stale",
          observedAt: "2026-03-29T08:00:00.000Z"
        }
      ]
    })
  };

  const briefing = buildDailyBriefing(input);
  assert.equal(briefing.status, "conflict");
  assert.equal(briefing.sections[0]?.status, "conflict");
  assert.match(briefing.sections[0]?.statements[0]?.text ?? "", /2 active/);
  assert.equal(briefing.sections[1]?.status, "conflict");
  assert.equal(briefing.sections[2]?.status, "stale");
  assert.equal(briefing.sections[2]?.statements.length, 0);
  assert.equal(briefing.sections[3]?.status, "future");
  assert.equal(briefing.sections[3]?.statements.length, 0);
});

test("HOME-09 never presents stale active-run heartbeats as current work or a conflict", () => {
  const staleHeartbeat = "2026-03-27T09:55:00.000Z";
  const withoutTask = makeInput({
    work: {
      tasks: [],
      activeRuns: [
        {
          id: "run-stale-a",
          taskId: "task-stale-a",
          taskTitle: "Abandoned work A",
          claimedAt: "2026-03-27T08:00:00.000Z",
          heartbeatAt: staleHeartbeat
        },
        {
          id: "run-stale-b",
          taskId: "task-stale-b",
          taskTitle: "Abandoned work B",
          claimedAt: "2026-03-27T08:01:00.000Z",
          heartbeatAt: staleHeartbeat
        }
      ],
      tasksTruncated: false,
      activeRunsTruncated: false
    }
  });
  const staleOnly = buildDailyBriefing(withoutTask);
  assert.equal(staleOnly.sections[0]?.status, "stale");
  assert.equal(staleOnly.sections[0]?.statements.length, 0);
  assert.match(staleOnly.sections[0]?.omissionReason ?? "", /stale or missing/i);
  assert.doesNotMatch(staleOnly.headline, /Abandoned work/);
  assert.notEqual(staleOnly.status, "conflict");

  const withCurrentTask = makeInput();
  withCurrentTask.work.activeRuns = withoutTask.work.activeRuns.slice(0, 1);
  const fallback = buildDailyBriefing(withCurrentTask);
  assert.equal(fallback.sections[0]?.status, "partial");
  assert.match(
    fallback.sections[0]?.statements[0]?.text ?? "",
    /Highest-ranked current task: Prepare the daily review/
  );
  assert.match(fallback.sections[0]?.omissionReason ?? "", /stale/i);
  assert.doesNotMatch(fallback.headline, /Abandoned work/);
});

test("HOME-09 local-day bounds preserve 23-hour and 25-hour DST days", () => {
  const spring = dailyBriefingDayRange(
    new Date("2026-03-29T10:00:00.000Z"),
    "Europe/Zurich"
  );
  const autumn = dailyBriefingDayRange(
    new Date("2026-10-25T10:00:00.000Z"),
    "Europe/Zurich"
  );
  assert.equal(spring.dateKey, "2026-03-29");
  assert.equal(
    Date.parse(spring.to) - Date.parse(spring.from),
    23 * 60 * 60 * 1_000
  );
  assert.equal(autumn.dateKey, "2026-10-25");
  assert.equal(
    Date.parse(autumn.to) - Date.parse(autumn.from),
    25 * 60 * 60 * 1_000
  );
});

const WRITE_SENSITIVE_TABLES = [
  "action_profile_templates",
  "life_force_profiles",
  "life_force_weekday_templates",
  "life_force_day_snapshots",
  "ap_ledger_events",
  "stat_xp_events",
  "activity_events",
  "event_log"
] as const;

function storageState() {
  return Object.fromEntries(
    WRITE_SENSITIVE_TABLES.map((table) => [
      table,
      JSON.stringify(
        getDatabase().prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
      )
    ])
  );
}

function insertTask(input: {
  id: string;
  title: string;
  ownerUserId: string;
  updatedAt: string;
  priority?: string;
}) {
  getDatabase()
    .prepare(
      `INSERT INTO tasks (
         id, title, description, status, priority, owner, goal_id, project_id,
         due_date, effort, energy, points, sort_order, completed_at,
         created_at, updated_at
       ) VALUES (?, ?, '', 'focus', ?, 'Fixture', NULL, NULL, NULL,
                 'light', 'steady', 10, 0, NULL, ?, ?)`
    )
    .run(
      input.id,
      input.title,
      input.priority ?? "medium",
      input.updatedAt,
      input.updatedAt
    );
  setEntityOwner("task", input.id, input.ownerUserId);
}

function insertCalendarEvent(input: {
  id: string;
  ownerUserId: string;
  title: string;
  startAt: string;
  endAt: string;
  now: string;
}) {
  getDatabase()
    .prepare(
      `INSERT INTO forge_events (
         id, ownership, origin_type, status, title, description, location,
         start_at, end_at, timezone, is_all_day, availability, event_type,
         categories_json, deleted_at, created_at, updated_at
       ) VALUES (?, 'forge', 'native', 'confirmed', ?, '', '', ?, ?, 'UTC',
                 0, 'busy', '', '[]', NULL, ?, ?)`
    )
    .run(
      input.id,
      input.title,
      input.startAt,
      input.endAt,
      input.now,
      input.now
    );
  setEntityOwner("calendar_event", input.id, input.ownerUserId);
}

test("HOME-09 route is owner-partitioned, read-only, bounded, and within its maximum envelope", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-daily-briefing-")
  );
  const app = await buildServer({
    dataRoot,
    seedDemoData: false,
    devrageMetricSync: false
  });
  const cookie = issueTestOperatorSessionCookie(app);
  try {
    const owner = getDefaultUser();
    const other = createUser({
      kind: "human",
      handle: "daily-briefing-other",
      displayName: "Daily briefing other",
      description: "",
      accentColor: "#8899aa"
    });
    const now = new Date();
    const nowIso = now.toISOString();
    const range = dailyBriefingDayRange(now, "UTC");
    insertTask({
      id: "daily_owner_task",
      title: "Shared daily title",
      ownerUserId: owner.id,
      updatedAt: nowIso,
      priority: "critical"
    });
    insertTask({
      id: "daily_foreign_task",
      title: "Shared daily title",
      ownerUserId: other.id,
      updatedAt: nowIso,
      priority: "critical"
    });
    getDatabase()
      .prepare(
        `INSERT INTO life_force_profiles (
           user_id, base_daily_ap, readiness_multiplier, life_force_level,
           activation_level, focus_level, vigor_level, composure_level,
           flow_level, created_at, updated_at
         ) VALUES (?, 100, 1, 1, 1, 1, 1, 1, 1, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET updated_at = excluded.updated_at`
      )
      .run(owner.id, nowIso, nowIso);
    getDatabase()
      .prepare(
        `INSERT INTO life_force_day_snapshots (
           id, user_id, date_key, daily_budget_ap, sleep_recovery_multiplier,
           readiness_multiplier, fatigue_debt_carry, points_json,
           created_at, updated_at
         ) VALUES (?, ?, ?, 100, 1, 1, 0, '[]', ?, ?)
         ON CONFLICT(user_id, date_key) DO UPDATE SET
           daily_budget_ap = excluded.daily_budget_ap,
           updated_at = excluded.updated_at`
      )
      .run("daily_snapshot", owner.id, range.dateKey, nowIso, nowIso);
    getDatabase()
      .prepare(
        `INSERT INTO ap_ledger_events (
           id, user_id, date_key, entity_type, entity_id, event_kind,
           source_kind, starts_at, ends_at, total_ap, rate_ap_per_hour,
           metadata_json, created_at
         ) VALUES ('daily_ledger', ?, ?, 'task', 'daily_owner_task',
                   'work', 'task', ?, ?, 25, 10, '{}', ?)`
      )
      .run(
        owner.id,
        range.dateKey,
        new Date(now.getTime() - 30 * 60 * 1_000).toISOString(),
        nowIso,
        nowIso
      );

    const before = storageState();
    const direct = readPersistedLifeForceSummary({
      userId: owner.id,
      dateKey: range.dateKey,
      now
    });
    assert.equal(direct?.spentTodayAp, 25);
    assert.equal(direct?.remainingAp, 75);
    assert.equal(direct?.provenance.freshness, "fresh");

    const route = await app.inject({
      method: "GET",
      url: `/api/v1/daily-briefing?userId=${encodeURIComponent(owner.id)}&timeZone=UTC`,
      headers: { cookie }
    });
    assert.equal(route.statusCode, 200, route.body);
    const payload = route.json() as { briefing: unknown };
    const parsed = dailyBriefingSchema.parse(payload.briefing);
    assert.equal(parsed.ownerUserId, owner.id);
    assert.match(parsed.headline, /Shared daily title/);
    assert.ok(!route.body.includes("daily_foreign_task"));
    assert.ok(
      Buffer.byteLength(route.body, "utf8") <=
        DAILY_BRIEFING_LIMITS.responseBytes
    );
    assert.deepEqual(storageState(), before);

    const missing = await app.inject({
      method: "GET",
      url: "/api/v1/daily-briefing?userId=missing-owner&timeZone=UTC",
      headers: { cookie }
    });
    assert.equal(missing.statusCode, 404);

    const normalSamples: number[] = [];
    for (let index = 0; index < 33; index += 1) {
      const startedAt = performance.now();
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/daily-briefing?userId=${encodeURIComponent(owner.id)}&timeZone=UTC`,
        headers: { cookie }
      });
      assert.equal(response.statusCode, 200, response.body);
      if (index >= 3) normalSamples.push(performance.now() - startedAt);
    }
    assert.ok(
      percentile(normalSamples, 0.95) <= 200,
      JSON.stringify(normalSamples)
    );

    for (let index = 0; index < 104; index += 1) {
      insertTask({
        id: `daily_dense_task_${index}`,
        title: `Dense authorized task ${String(index).padStart(3, "0")}`,
        ownerUserId: owner.id,
        updatedAt: nowIso,
        priority: index % 4 === 0 ? "high" : "medium"
      });
    }
    for (let index = 0; index < 44; index += 1) {
      insertCalendarEvent({
        id: `daily_dense_event_${index}`,
        ownerUserId: owner.id,
        title: `Dense authorized event ${String(index).padStart(2, "0")}`,
        startAt: new Date(
          Date.parse(range.from) + index * 5 * 60 * 1_000
        ).toISOString(),
        endAt: new Date(
          Date.parse(range.from) + (index * 5 + 45) * 60 * 1_000
        ).toISOString(),
        now: nowIso
      });
    }
    for (let index = 0; index < 13; index += 1) {
      getDatabase()
        .prepare(
          `INSERT INTO activity_events (
             id, entity_type, entity_id, event_type, title, description,
             actor, source, metadata_json, created_at
           ) VALUES (?, 'task', ?, 'task_updated', ?, '', NULL, 'ui', '{}', ?)`
        )
        .run(
          `daily_dense_activity_${index}`,
          `daily_dense_task_${index}`,
          `Dense activity ${index}`,
          new Date(now.getTime() - index * 60_000).toISOString()
        );
    }

    const maxSamples: number[] = [];
    for (let index = 0; index < 33; index += 1) {
      const startedAt = performance.now();
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/daily-briefing?userId=${encodeURIComponent(owner.id)}&timeZone=UTC`,
        headers: { cookie }
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.ok(
        Buffer.byteLength(response.body, "utf8") <=
          DAILY_BRIEFING_LIMITS.responseBytes
      );
      if (index >= 3) maxSamples.push(performance.now() - startedAt);
    }
    assert.ok(percentile(maxSamples, 0.95) <= 500, JSON.stringify(maxSamples));

    const rssBefore = process.memoryUsage().rss;
    for (let index = 0; index < 8; index += 1) {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/daily-briefing?userId=${encodeURIComponent(owner.id)}&timeZone=UTC`,
        headers: { cookie }
      });
      assert.equal(response.statusCode, 200, response.body);
    }
    const rssDelta = Math.max(0, process.memoryUsage().rss - rssBefore);
    assert.ok(rssDelta <= 50 * 1024 * 1024, `${rssDelta} bytes`);
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("HOME-09 OpenAPI publishes the exact read-only daily briefing contract", () => {
  const document = buildOpenApiDocument() as {
    paths: Record<string, Record<string, unknown>>;
    components: { schemas: Record<string, unknown> };
  };
  const pathItem = document.paths["/api/v1/daily-briefing"];
  assert.ok(pathItem?.get);
  assert.equal(pathItem?.post, undefined);
  assert.ok(document.components.schemas.DailyBriefing);
});

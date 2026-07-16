import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { GAMIFICATION_CATALOG } from "@/lib/gamification-catalog.js";
import {
  closeDatabase,
  configureDatabase,
  getDatabase,
  initializeDatabase
} from "./db.js";
import { getSettings, getSettingsFileStatus } from "./repositories/settings.js";
import {
  enqueueGamificationCelebration,
  insertGamificationUnlock,
  listGamificationDailyActivity,
  markGamificationCelebrationSeen
} from "./repositories/gamification.js";
import {
  awardTaskCompletionReward,
  createManualRewardGrant,
  ensureDefaultRewardRules,
  listRewardLedger,
  recordSessionEvent,
  recordTaskRunStartReward,
  RewardIdempotencyConflictError,
  reverseLatestTaskCompletionReward
} from "./repositories/rewards.js";
import { listTasks } from "./repositories/tasks.js";
import { createUser, listUsers } from "./repositories/users.js";
import {
  buildGamificationProfile,
  buildScopedRewardsSql,
  calculateLevel,
  buildXpMetricsPayloadModel,
  reconcileGamificationProgress,
  resolveGamificationScope,
  xpToAdvance
} from "./services/gamification.js";
import { buildForgeDoctorReport } from "./services/doctor.js";

let activeDataRoot: string | null = null;

async function setupDatabase(prefix: string) {
  activeDataRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
  configureDatabase({ dataRoot: activeDataRoot, seedDemoData: true });
  await initializeDatabase();
  getSettings();
  return activeDataRoot;
}

async function cleanupDatabase() {
  closeDatabase();
  if (activeDataRoot) {
    await rm(activeDataRoot, { recursive: true, force: true });
    activeDataRoot = null;
  }
}

afterEach(async () => {
  await cleanupDatabase();
});

describe("gamification level curve", () => {
  it("starts level 1 at zero and advances with the smith-forge curve", () => {
    assert.equal(xpToAdvance(1), 100);
    assert.deepEqual(calculateLevel(0), {
      level: 1,
      currentLevelXp: 0,
      nextLevelXp: 100,
      xpIntoLevel: 0,
      xpToNextLevel: 100,
      currentLevelStartXp: 0,
      nextLevelTotalXp: 100,
      levelCurveVersion: "smith-forge"
    });
    assert.equal(calculateLevel(100).level, 2);
    assert.equal(calculateLevel(100).currentLevelStartXp, 100);
    assert.equal(calculateLevel(100).nextLevelXp, 135);
  });
});

describe("gamification scope and persistence", () => {
  it("keeps multi-user XP reads aggregate and non-persistent", async () => {
    await setupDatabase("forge-gamification-scope-");
    const users = listUsers();
    assert.ok(users.length >= 2);
    const userIds = users.slice(0, 2).map((user) => user.id);

    const scope = resolveGamificationScope(userIds);
    assert.equal(scope.mode, "aggregate_fallback");
    assert.deepEqual(new Set(scope.userIds), new Set(userIds));

    const before = {
      rewardRows: countRows("reward_ledger"),
      dailyRows: countRows("gamification_daily_activity"),
      unlockRows: countRows("gamification_item_unlocks"),
      celebrationRows: countRows("gamification_celebrations")
    };

    const payload = buildXpMetricsPayloadModel({
      goals: [],
      tasks: [],
      habits: [],
      userIds
    });

    assert.equal(payload.scope.mode, "aggregate_fallback");
    assert.equal(payload.equipment.updatedAt, null);
    assert.deepEqual(payload.celebrations, []);
    assert.ok(
      payload.catalogPreview.some((item) => item.kind === "trophy"),
      "XP metrics should always include a real trophy for the compact shelf"
    );
    assert.deepEqual(
      {
        rewardRows: countRows("reward_ledger"),
        dailyRows: countRows("gamification_daily_activity"),
        unlockRows: countRows("gamification_item_unlocks"),
        celebrationRows: countRows("gamification_celebrations")
      },
      before
    );
    assert.equal(
      countRows("gamification_item_unlocks WHERE user_id = 'aggregate'"),
      0
    );
    assert.equal(
      countRows("gamification_celebrations WHERE user_id = 'aggregate'"),
      0
    );
  });

  it("Doctor accepts selected equipment values from unlock reward payloads", async () => {
    const rootDir = await setupDatabase("forge-gamification-doctor-");
    const mascotSkin = GAMIFICATION_CATALOG.find(
      (item) =>
        item.kind === "unlock" &&
        item.unlockType === "mascot_skin" &&
        typeof item.rewardPayload.mascotSkin === "string"
    )?.rewardPayload.mascotSkin;
    if (typeof mascotSkin !== "string") {
      assert.fail("Expected a mascot skin reward in the catalog");
    }
    const selectedMascotSkin = mascotSkin;

    getDatabase()
      .prepare(
        `INSERT INTO gamification_equipment (
           user_id, selected_mascot_skin, selected_hud_treatment,
           selected_streak_effect, selected_trophy_shelf,
           selected_celebration_variant, updated_at
         ) VALUES ('user_operator', ?, NULL, NULL, NULL, NULL, ?)`
      )
      .run(selectedMascotSkin, new Date().toISOString());

    const report = await buildForgeDoctorReport({
      settings: getSettings(),
      settingsFile: getSettingsFileStatus(),
      runtime: { storageRoot: rootDir },
      health: { ok: true }
    });
    const equipmentCheck = report.checks.find(
      (check) => check.id === "rewards.gamification.equipment"
    );

    assert.ok(equipmentCheck);
    assert.equal(equipmentCheck.status, "pass");
    assert.equal(equipmentCheck.affectedCount, 0);
  });

  it("does not expose another user's XP when a requested user id is invalid", async () => {
    await setupDatabase("forge-gamification-invalid-scope-");
    createManualRewardGrant(
      {
        entityType: "system",
        entityId: "operator_manual_reward",
        deltaXp: 40,
        reasonTitle: "Operator-only adjustment",
        reasonSummary: "Selected-user isolation fixture.",
        metadata: { ownerUserId: "user_operator" }
      },
      { actor: "aurel", source: "ui" }
    );

    const payload = buildXpMetricsPayloadModel({
      goals: [],
      tasks: [],
      habits: [],
      userIds: ["user_missing"]
    });

    assert.equal(payload.scope.mode, "aggregate_fallback");
    assert.equal(payload.scope.label, "No matching user");
    assert.equal(payload.profile.totalXp, 0);
    assert.deepEqual(payload.recentLedger, []);
  });

  it("uses the requested IANA timezone for streak day boundaries", async () => {
    await setupDatabase("forge-gamification-timezone-");
    getDatabase().exec("DELETE FROM reward_ledger");
    getDatabase()
      .prepare(
        `INSERT INTO reward_ledger (
           id, rule_id, event_log_id, entity_type, entity_id, actor, source,
           delta_xp, reason_title, reason_summary, reversible_group,
           reversed_by_reward_id, metadata_json, created_at
         ) VALUES (?, NULL, NULL, 'system', ?, 'aurel', 'ui', 5, ?, '', ?, NULL, ?, ?)`
      )
      .run(
        "rwd_timezone_boundary",
        "timezone-boundary",
        "Timezone boundary",
        "timezone-boundary",
        JSON.stringify({
          ownerUserId: "user_operator",
          qualifiesForStreak: true
        }),
        "2026-07-13T22:30:00.000Z"
      );

    reconcileGamificationProgress({
      goals: [],
      tasks: [],
      habits: [],
      now: new Date("2026-07-14T12:00:00.000Z"),
      userIds: ["user_operator"],
      timezone: "Europe/Zurich"
    });
    reconcileGamificationProgress({
      goals: [],
      tasks: [],
      habits: [],
      now: new Date("2026-07-14T12:00:00.000Z"),
      userIds: ["user_operator"],
      timezone: "America/New_York"
    });

    assert.ok(
      listGamificationDailyActivity("user_operator", "Europe/Zurich").some(
        (row) =>
          row.dateKey === "2026-07-14" &&
          row.firstRewardEventId === "rwd_timezone_boundary"
      )
    );
    assert.ok(
      listGamificationDailyActivity("user_operator", "America/New_York").some(
        (row) =>
          row.dateKey === "2026-07-13" &&
          row.firstRewardEventId === "rwd_timezone_boundary"
      )
    );
  });

  it("evaluates overdue tasks against the request timezone's local date", async () => {
    await setupDatabase("forge-gamification-overdue-timezone-");
    const seedTask = listTasks()[0];
    assert.ok(seedTask);
    const now = new Date("2026-07-14T00:30:00.000Z");
    const profileForDueDate = (dueDate: string) =>
      buildGamificationProfile(
        [],
        [
          {
            ...seedTask,
            status: "in_progress" as const,
            dueDate
          }
        ],
        [],
        now,
        {
          userIds: [seedTask.userId ?? "user_operator"],
          timezone: "America/Los_Angeles"
        }
      );

    const dueToday = profileForDueDate("2026-07-13");
    const dueTomorrow = profileForDueDate("2026-07-14");
    const overdue = profileForDueDate("2026-07-12");
    assert.equal(dueToday.momentumScore, dueTomorrow.momentumScore);
    assert.ok(overdue.momentumScore < dueToday.momentumScore);
  });

  it("uses one DST-aware timezone for ambient caps and reporting", async () => {
    await setupDatabase("forge-gamification-ambient-timezone-");
    getDatabase().exec(
      "DELETE FROM reward_ledger; DELETE FROM session_events;"
    );
    const operator = listUsers().find((user) => user.id === "user_operator");
    assert.ok(operator);
    const eventTimes = [
      "2026-11-01T05:05:00.000Z",
      "2026-11-01T05:15:00.000Z",
      "2026-11-01T05:25:00.000Z",
      "2026-11-01T06:05:00.000Z",
      "2026-11-01T06:15:00.000Z",
      "2026-11-01T06:25:00.000Z",
      "2026-11-01T07:05:00.000Z"
    ];
    const rewards = eventTimes.map((eventTime, index) =>
      recordSessionEvent(
        {
          sessionId: `dst-session-${index}`,
          eventType: "dwell_120_seconds",
          timezone: "America/New_York",
          metrics: { visible: true, interacted: true }
        },
        { actor: operator.handle, source: "ui" },
        new Date(eventTime)
      )
    );
    assert.equal(
      rewards.reduce(
        (sum, result) => sum + (result.rewardEvent?.deltaXp ?? 0),
        0
      ),
      12
    );
    assert.equal(rewards.at(-1)?.rewardEvent, null);

    const payload = buildXpMetricsPayloadModel({
      goals: [],
      tasks: [],
      habits: [],
      userIds: ["user_operator"],
      timezone: "America/New_York",
      now: new Date("2026-11-01T12:00:00.000Z")
    });
    assert.equal(payload.timezone, "America/New_York");
    assert.equal(payload.dailyAmbientXp, 12);
    assert.equal(payload.dailyAmbientCap, 12);
  });
});

describe("gamification ledger truthfulness", () => {
  it("honors disabled rules and deduplicates stable task-run and session events", async () => {
    await setupDatabase("forge-gamification-idempotency-");
    ensureDefaultRewardRules();
    getDatabase()
      .prepare(
        "UPDATE reward_rules SET active = 0 WHERE code = 'task_run_started'"
      )
      .run();

    const first = recordTaskRunStartReward(
      "run_repeat",
      "task_repeat",
      "aurel",
      "ui"
    );
    const retry = recordTaskRunStartReward(
      "run_repeat",
      "task_repeat",
      "aurel",
      "ui"
    );
    assert.equal(first.id, retry.id);
    assert.equal(first.deltaXp, 0);
    assert.match(first.reasonSummary, /disabled/i);
    assert.equal(
      countRows(
        "event_log WHERE event_kind = 'reward.task_run_started' AND entity_id = 'run_repeat'"
      ),
      1
    );

    const sessionFirst = recordSessionEvent(
      {
        sessionId: "session_repeat",
        eventType: "dwell_120_seconds",
        metrics: { visible: true, interacted: true }
      },
      { actor: "aurel", source: "ui" },
      new Date("2026-07-15T10:00:00.000Z")
    );
    const sessionRetry = recordSessionEvent(
      {
        sessionId: "session_repeat",
        eventType: "dwell_120_seconds",
        metrics: { visible: true, interacted: true }
      },
      { actor: "aurel", source: "ui" },
      new Date("2026-07-15T10:00:01.000Z")
    );
    assert.equal(sessionRetry.sessionEvent.id, sessionFirst.sessionEvent.id);
    assert.equal(sessionRetry.rewardEvent?.id, sessionFirst.rewardEvent?.id);
    assert.equal(countRows("session_events"), 1);
  });

  it("corrects task points once and reverses the complete net award on reopen", async () => {
    await setupDatabase("forge-gamification-task-correction-");
    const seedTask = listTasks()[0];
    assert.ok(seedTask);
    const completedAt = "2026-07-15T08:00:00.000Z";
    const completed = {
      ...seedTask,
      status: "done" as const,
      completedAt,
      points: 5
    };
    const first = awardTaskCompletionReward(completed, {
      actor: "aurel",
      source: "ui"
    });
    const retry = awardTaskCompletionReward(completed, {
      actor: "aurel",
      source: "ui"
    });
    assert.equal(retry.id, first.id);

    const correction = awardTaskCompletionReward(
      { ...completed, points: 8 },
      { actor: "aurel", source: "ui" }
    );
    assert.equal(correction.deltaXp, 3);
    assert.equal(correction.metadata.qualifiesForStreak, false);

    const reversal = reverseLatestTaskCompletionReward(
      { ...completed, points: 8, status: "backlog" },
      { actor: "aurel", source: "ui" }
    );
    assert.equal(reversal?.deltaXp, -8);
    const net = getDatabase()
      .prepare(
        `SELECT SUM(delta_xp) AS value
         FROM reward_ledger
         WHERE reversible_group = ?`
      )
      .get(`task_completion:${seedTask.id}:${completedAt}`) as {
      value: number;
    };
    assert.equal(net.value, 0);
  });

  it("deduplicates manual retries with an explicit key and bounds ledger reads", async () => {
    await setupDatabase("forge-gamification-ledger-bound-");
    const keyedInput = {
      entityType: "system" as const,
      entityId: "operator_manual_reward",
      deltaXp: 3,
      reasonTitle: "Retry-safe adjustment",
      reasonSummary: "Idempotency fixture.",
      metadata: { idempotencyKey: "request-123" }
    };
    const first = createManualRewardGrant(keyedInput, {
      actor: "aurel",
      source: "ui"
    });
    const retry = createManualRewardGrant(keyedInput, {
      actor: "aurel",
      source: "ui"
    });
    assert.equal(retry.id, first.id);
    assert.equal(
      countRows(
        "event_log WHERE event_kind = 'reward.manual_bonus' AND entity_id = 'operator_manual_reward'"
      ),
      1
    );

    const longKeyPrefix = "x".repeat(160);
    const longKeyInput = {
      entityType: "system" as const,
      entityId: "long_idempotency_key",
      deltaXp: 2,
      reasonTitle: "Long idempotency key",
      reasonSummary: "Distinct suffixes must remain distinct.",
      metadata: { idempotencyKey: `${longKeyPrefix}a` }
    };
    const longKeyA = createManualRewardGrant(longKeyInput, {
      actor: "aurel",
      source: "ui"
    });
    const longKeyB = createManualRewardGrant(
      {
        ...longKeyInput,
        metadata: { idempotencyKey: `${longKeyPrefix}b` }
      },
      { actor: "aurel", source: "ui" }
    );
    assert.notEqual(longKeyA.id, longKeyB.id);

    for (let index = 0; index < 60; index += 1) {
      createManualRewardGrant(
        {
          entityType: "system",
          entityId: `bounded-${index}`,
          deltaXp: 1,
          reasonTitle: `Bounded ${index}`,
          reasonSummary: "Bounded ledger fixture.",
          metadata: {}
        },
        { actor: "aurel", source: "ui" }
      );
    }
    assert.equal(listRewardLedger().length, 50);
    assert.equal(listRewardLedger({ limit: 500 }).length, 63);
  });

  it("rejects server-owned manual metadata and fingerprints every accepted payload field", async () => {
    await setupDatabase("forge-gamification-manual-fingerprint-");
    const activity = { actor: "aurel", source: "ui" as const };
    const reservedMetadata = {
      manual: false,
      qualifiesForStreak: true,
      idempotencyFingerprint: "caller-controlled"
    };

    for (const [key, value] of Object.entries(reservedMetadata)) {
      assert.throws(
        () =>
          createManualRewardGrant(
            {
              entityType: "system",
              entityId: `reserved-${key}`,
              deltaXp: 2,
              reasonTitle: "Reserved metadata",
              reasonSummary: "",
              metadata: { idempotencyKey: `reserved-${key}`, [key]: value }
            },
            activity
          ),
        new RegExp(`${key} is server-owned metadata`)
      );
    }

    const baseInput = {
      entityType: "system" as const,
      entityId: "fingerprint-target",
      deltaXp: 3,
      reasonTitle: "Fingerprint payload",
      reasonSummary: "Original summary",
      metadata: {
        idempotencyKey: "fingerprint-request",
        clientContext: "original"
      }
    };
    const first = createManualRewardGrant(baseInput, activity);
    const exactReplay = createManualRewardGrant(baseInput, activity);
    assert.equal(exactReplay.id, first.id);
    assert.equal(first.metadata.manual, true);
    assert.equal(first.metadata.qualifiesForStreak, false);
    assert.equal(typeof first.metadata.idempotencyFingerprint, "string");

    assert.throws(
      () =>
        createManualRewardGrant(
          {
            ...baseInput,
            metadata: { ...baseInput.metadata, clientContext: "changed" }
          },
          activity
        ),
      (error: unknown) => error instanceof RewardIdempotencyConflictError
    );
    assert.equal(
      countRows(
        "reward_ledger WHERE entity_id = 'fingerprint-target' AND reversed_by_reward_id IS NULL"
      ),
      1
    );
  });

  it("rolls back celebration and unlock acknowledgement when the unlock update fails", async () => {
    await setupDatabase("forge-gamification-celebration-atomic-");
    const userId = "user_operator";
    const itemId = "trophy-xp-levels-the-first-heat";
    const celebrationId = "celebration_atomic_ack";
    const unlockedAt = "2026-07-15T10:00:00.000Z";
    assert.equal(
      insertGamificationUnlock({
        userId,
        itemId,
        unlockedAt,
        sourceMetric: "totalXp",
        sourceValue: 100
      }),
      true
    );
    enqueueGamificationCelebration({
      id: celebrationId,
      userId,
      kind: "trophy",
      itemId,
      title: "The First Heat",
      summary: "Atomic acknowledgement fixture.",
      assetKey: "item-trophy-xp-levels-the-first-heat",
      createdAt: unlockedAt
    });
    getDatabase().exec(`
      CREATE TRIGGER reject_unlock_acknowledgement
      BEFORE UPDATE OF celebration_seen_at ON gamification_item_unlocks
      WHEN NEW.user_id = '${userId}' AND NEW.item_id = '${itemId}'
      BEGIN
        SELECT RAISE(ABORT, 'injected unlock acknowledgement failure');
      END;
    `);

    assert.throws(
      () =>
        markGamificationCelebrationSeen(
          celebrationId,
          "2026-07-15T11:00:00.000Z"
        ),
      /injected unlock acknowledgement failure/
    );
    const celebration = getDatabase()
      .prepare("SELECT seen_at FROM gamification_celebrations WHERE id = ?")
      .get(celebrationId) as { seen_at: string | null };
    const unlock = getDatabase()
      .prepare(
        `SELECT celebration_seen_at
         FROM gamification_item_unlocks
         WHERE user_id = ? AND item_id = ?`
      )
      .get(userId, itemId) as { celebration_seen_at: string | null };
    assert.equal(celebration.seen_at, null);
    assert.equal(unlock.celebration_seen_at, null);
  });

  it("does not commit an orphan item celebration acknowledgement", async () => {
    await setupDatabase("forge-gamification-celebration-orphan-");
    const celebrationId = "celebration_orphan_ack";
    enqueueGamificationCelebration({
      id: celebrationId,
      userId: "user_operator",
      kind: "trophy",
      itemId: "trophy-xp-levels-the-first-heat",
      title: "The First Heat",
      summary: "Orphan acknowledgement fixture.",
      assetKey: "item-trophy-xp-levels-the-first-heat",
      createdAt: "2026-07-15T10:00:00.000Z"
    });

    assert.throws(
      () =>
        markGamificationCelebrationSeen(
          celebrationId,
          "2026-07-15T11:00:00.000Z"
        ),
      /Expected one unlock for celebration celebration_orphan_ack, found 0\./
    );
    const celebration = getDatabase()
      .prepare("SELECT seen_at FROM gamification_celebrations WHERE id = ?")
      .get(celebrationId) as { seen_at: string | null };
    assert.equal(celebration.seen_at, null);
  });

  it("rolls back the manual reward event when ledger insertion fails without an idempotency key", async () => {
    await setupDatabase("forge-gamification-manual-atomic-");
    getDatabase().exec(`
      CREATE TRIGGER reject_atomic_manual_reward
      BEFORE INSERT ON reward_ledger
      WHEN NEW.entity_id = 'manual_atomic_failure'
      BEGIN
        SELECT RAISE(ABORT, 'injected reward ledger failure');
      END;
    `);
    const before = countRows(
      "event_log WHERE event_kind = 'reward.manual_bonus' AND entity_id = 'manual_atomic_failure'"
    );

    assert.throws(
      () =>
        createManualRewardGrant(
          {
            entityType: "system",
            entityId: "manual_atomic_failure",
            deltaXp: 4,
            reasonTitle: "Atomic reward",
            reasonSummary: "The event and ledger row must commit together.",
            metadata: {}
          },
          { actor: "aurel", source: "ui" }
        ),
      /injected reward ledger failure/
    );
    assert.equal(
      countRows(
        "event_log WHERE event_kind = 'reward.manual_bonus' AND entity_id = 'manual_atomic_failure'"
      ),
      before
    );
    assert.equal(
      countRows("reward_ledger WHERE entity_id = 'manual_atomic_failure'"),
      0
    );
  });

  it("keeps selected-user XP payloads bounded with a high-cardinality ledger", async () => {
    await setupDatabase("forge-gamification-ledger-cardinality-");
    getDatabase().exec("DELETE FROM reward_ledger");
    const insert = getDatabase().prepare(
      `INSERT INTO reward_ledger (
         id, rule_id, event_log_id, entity_type, entity_id, actor, source,
         delta_xp, reason_title, reason_summary, reversible_group,
         reversed_by_reward_id, metadata_json, owner_user_id, created_at
       ) VALUES (?, NULL, NULL, 'system', ?, 'test', 'system', 1, ?, '', NULL, NULL, ?, ?, ?)`
    );
    getDatabase().exec("BEGIN IMMEDIATE");
    try {
      for (let index = 0; index < 2_000; index += 1) {
        const ownerUserId =
          index % 2 === 0 ? "user_operator" : "user_forge_bot";
        insert.run(
          `rwd_cardinality_${String(index).padStart(4, "0")}`,
          `cardinality-${index}`,
          `Cardinality ${index}`,
          JSON.stringify({ ownerUserId, qualifiesForStreak: true }),
          ownerUserId,
          new Date(Date.UTC(2026, 6, 1, 0, 0, index)).toISOString()
        );
      }
      getDatabase().exec("COMMIT");
    } catch (error) {
      getDatabase().exec("ROLLBACK");
      throw error;
    }

    const payload = buildXpMetricsPayloadModel({
      goals: [],
      tasks: [],
      habits: [],
      userIds: ["user_operator"],
      timezone: "UTC"
    });

    assert.equal(payload.profile.totalXp, 1_000);
    assert.equal(payload.recentLedger.length, 25);
    assert.ok(
      payload.recentLedger.every(
        (event) => event.metadata.ownerUserId === "user_operator"
      )
    );
    const scopedSql = buildScopedRewardsSql(
      resolveGamificationScope(["user_operator"])
    );
    const queryPlan = getDatabase()
      .prepare(
        `EXPLAIN QUERY PLAN
         ${scopedSql.cte}
         SELECT id
         FROM scoped_rewards
         ORDER BY created_at DESC, id DESC
         LIMIT 25`
      )
      .all(...scopedSql.params) as Array<{ detail: string }>;
    assert.match(
      queryPlan.map((row) => row.detail).join("\n"),
      /idx_reward_ledger_owner_created/i
    );
  });

  it("reconciles reward history in bounded pages and incrementally invalidates backdated changes", async () => {
    await setupDatabase("forge-gamification-reconcile-cursor-");
    const testUser = createUser({
      kind: "human",
      handle: "gamification-reconcile-cursor",
      displayName: "Gamification reconcile cursor",
      description: "",
      accentColor: "#336699"
    });
    const userId = testUser.id;
    getDatabase().exec(
      "DELETE FROM gamification_reconciliation_state; DELETE FROM gamification_daily_activity; DELETE FROM reward_ledger;"
    );
    const insert = getDatabase().prepare(
      `INSERT INTO reward_ledger (
         id, rule_id, event_log_id, entity_type, entity_id, actor, source,
         delta_xp, reason_title, reason_summary, reversible_group,
         reversed_by_reward_id, metadata_json, owner_user_id, created_at
       ) VALUES (?, NULL, NULL, 'system', ?, 'test', 'system', 1, ?, '', NULL, NULL, ?, ?, ?)`
    );
    getDatabase().exec("BEGIN IMMEDIATE");
    try {
      for (let index = 0; index < 1_201; index += 1) {
        insert.run(
          `rwd_cursor_${String(index).padStart(4, "0")}`,
          `cursor-${index}`,
          `Cursor ${index}`,
          JSON.stringify({
            ownerUserId: userId,
            qualifiesForStreak: true
          }),
          userId,
          new Date(Date.UTC(2026, 6, 1, 0, 0, index)).toISOString()
        );
      }
      getDatabase().exec("COMMIT");
    } catch (error) {
      getDatabase().exec("ROLLBACK");
      throw error;
    }

    const reconcile = () =>
      reconcileGamificationProgress({
        goals: [],
        tasks: [],
        habits: [],
        userIds: [userId],
        timezone: "UTC"
      });
    reconcile();
    const initialActivity = listGamificationDailyActivity(userId, "UTC");
    assert.equal(
      initialActivity.reduce((sum, row) => sum + row.eventCount, 0),
      1_201
    );
    const initialState = getDatabase()
      .prepare(
        `SELECT cursor_reward_id, requires_full_rebuild
         FROM gamification_reconciliation_state
         WHERE user_id = ? AND timezone = 'UTC'`
      )
      .get(userId) as {
      cursor_reward_id: string;
      requires_full_rebuild: number;
    };
    assert.equal(initialState.cursor_reward_id, "rwd_cursor_1200");
    assert.equal(initialState.requires_full_rebuild, 0);

    insert.run(
      "rwd_cursor_append",
      "cursor-append",
      "Cursor append",
      JSON.stringify({
        ownerUserId: userId,
        qualifiesForStreak: true
      }),
      userId,
      "2026-07-01T01:00:00.000Z"
    );
    reconcile();
    assert.equal(
      listGamificationDailyActivity(userId, "UTC").reduce(
        (sum, row) => sum + row.eventCount,
        0
      ),
      1_202
    );
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT cursor_reward_id
             FROM gamification_reconciliation_state
             WHERE user_id = ? AND timezone = 'UTC'`
          )
          .get(userId) as { cursor_reward_id: string }
      ).cursor_reward_id,
      "rwd_cursor_append"
    );

    insert.run(
      "rwd_cursor_backdated",
      "cursor-backdated",
      "Cursor backdated",
      JSON.stringify({
        ownerUserId: userId,
        qualifiesForStreak: true
      }),
      userId,
      "2026-06-30T23:59:59.000Z"
    );
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT requires_full_rebuild
             FROM gamification_reconciliation_state
             WHERE user_id = ? AND timezone = 'UTC'`
          )
          .get(userId) as { requires_full_rebuild: number }
      ).requires_full_rebuild,
      1
    );
    reconcile();
    assert.equal(
      listGamificationDailyActivity(userId, "UTC").reduce(
        (sum, row) => sum + row.eventCount,
        0
      ),
      1_203
    );
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT requires_full_rebuild
             FROM gamification_reconciliation_state
             WHERE user_id = ? AND timezone = 'UTC'`
          )
          .get(userId) as { requires_full_rebuild: number }
      ).requires_full_rebuild,
      0
    );
  });
});

function countRows(fromSql: string): number {
  const row = getDatabase()
    .prepare(`SELECT COUNT(*) AS count FROM ${fromSql}`)
    .get() as { count: number };
  return row.count;
}

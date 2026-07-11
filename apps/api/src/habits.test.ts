import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import {
  createHabit,
  createHabitCheckIn,
  getHabitById,
  updateHabit
} from "./repositories/habits.js";
import {
  buildWatchBootstrap,
  ingestWatchCommandBatch
} from "./watch-mobile.js";

function habitInput(
  overrides: Partial<Parameters<typeof createHabit>[0]> = {}
): Parameters<typeof createHabit>[0] {
  return {
    title: "Reactive scrolling",
    description: "Avoid reactive scrolling after lights out.",
    status: "active",
    polarity: "negative",
    frequency: "daily",
    timezone: "Europe/Zurich",
    dayBoundaryMode: "fixed",
    targetCount: 1,
    weekDays: [],
    linkedGoalIds: [],
    linkedProjectIds: [],
    linkedTaskIds: [],
    linkedValueIds: [],
    linkedPatternIds: [],
    linkedBehaviorIds: [],
    linkedBeliefIds: [],
    linkedModeIds: [],
    linkedReportIds: [],
    linkedBehaviorId: null,
    rewardXp: 12,
    penaltyXp: 8,
    generatedHealthEventTemplate: {
      enabled: false,
      workoutType: "workout",
      title: "",
      durationMinutes: 45,
      xpReward: 0,
      tags: [],
      links: [],
      notesTemplate: ""
    },
    userId: "user_operator",
    ...overrides
  };
}

async function withHabitDatabase(
  label: string,
  operation: (
    app: Awaited<ReturnType<typeof buildServer>>
  ) => void | Promise<void>
) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), `forge-${label}-`));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  try {
    await operation(app);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
}

async function issueOperatorSessionCookie(
  app: Awaited<ReturnType<typeof buildServer>>
) {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/auth/operator-session",
    headers: { host: "127.0.0.1:4317" }
  });
  assert.equal(response.statusCode, 200);
  const cookie = response.cookies[0];
  assert.ok(cookie);
  return `${cookie.name}=${cookie.value}`;
}

async function issueHabitToken(
  app: Awaited<ReturnType<typeof buildServer>>,
  cookie: string,
  userId: string
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/settings/tokens",
    headers: { cookie },
    payload: {
      label: "Habit scope test",
      scopes: ["read", "write"],
      scopePolicy: { userIds: [userId], projectIds: [], tagIds: [] }
    }
  });
  assert.equal(response.statusCode, 201);
  return (response.json() as { token: { token: string } }).token.token;
}

test("negative habits keep a fixed home day or follow the traveler device explicitly", async () => {
  await withHabitDatabase("habit-timezones", () => {
    const habit = createHabit(
      habitInput({ timezone: "America/Los_Angeles" })
    );
    const database = getDatabase();
    database
      .prepare(
        `INSERT INTO habit_check_ins (
           id, habit_id, date_key, status, note, delta_xp, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "hci_tz_1",
        habit.id,
        "2025-12-30",
        "missed",
        "Resisted at home.",
        12,
        "2025-12-31T07:00:00.000Z",
        "2025-12-31T07:00:00.000Z",
        "hci_tz_2",
        habit.id,
        "2025-12-31",
        "missed",
        "Resisted before travel.",
        12,
        "2026-01-01T07:00:00.000Z",
        "2026-01-01T07:00:00.000Z"
      );

    const boundaryInstant = new Date("2026-01-01T00:30:00.000Z");
    const fixed = getHabitById(habit.id, {
      now: boundaryInstant,
      timezone: "Europe/Zurich"
    })!;
    assert.equal(fixed.effectiveTimezone, "America/Los_Angeles");
    assert.equal(fixed.currentDateKey, "2025-12-31");
    assert.equal(fixed.dueToday, false);
    assert.equal(fixed.streakCount, 2);

    updateHabit(habit.id, { dayBoundaryMode: "travel" });
    const traveling = getHabitById(habit.id, {
      now: boundaryInstant,
      timezone: "Europe/Zurich"
    })!;
    assert.equal(traveling.effectiveTimezone, "Europe/Zurich");
    assert.equal(traveling.currentDateKey, "2026-01-01");
    assert.equal(traveling.dueToday, true);
    assert.equal(traveling.streakCount, 2);
  });
});

test("habit backfill rejects future and unscheduled dates without changing history", async () => {
  await withHabitDatabase("habit-backfill", () => {
    const today = new Date();
    const weekday = today.getUTCDay();
    const scheduledWeekday = (weekday + 6) % 7;
    const habit = createHabit(
      habitInput({
        frequency: "weekly",
        weekDays: [scheduledWeekday],
        timezone: "UTC"
      })
    );
    const currentDateKey = getHabitById(habit.id)!.currentDateKey;
    const tomorrow = new Date(`${currentDateKey}T00:00:00.000Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    assert.throws(
      () =>
        createHabitCheckIn(habit.id, {
          dateKey: tomorrow.toISOString().slice(0, 10),
          status: "missed",
          note: ""
        }),
      (error: unknown) =>
        error instanceof Error && error.message.includes("cannot be logged after")
    );
    assert.throws(
      () =>
        createHabitCheckIn(habit.id, {
          dateKey: currentDateKey,
          status: "missed",
          note: ""
        }),
      (error: unknown) =>
        error instanceof Error && error.message.includes("scheduled weekdays")
    );
    assert.equal(getHabitById(habit.id)!.checkIns.length, 0);
  });
});

test("concurrent negative-habit receipts are idempotent and corrections replace rewards", async () => {
  await withHabitDatabase("habit-concurrency", async () => {
    const habit = createHabit(habitInput({ timezone: "UTC" }));
    const dateKey = getHabitById(habit.id)!.currentDateKey;

    await Promise.all(
      Array.from({ length: 12 }, () =>
        Promise.resolve().then(() =>
          createHabitCheckIn(habit.id, {
            dateKey,
            status: "missed",
            note: "Private evidence"
          })
        )
      )
    );

    const database = getDatabase();
    const firstCount = database
      .prepare(
        `SELECT COUNT(*) AS count FROM habit_check_ins WHERE habit_id = ? AND date_key = ?`
      )
      .get(habit.id, dateKey) as { count: number };
    assert.equal(firstCount.count, 1);
    const firstRewards = database
      .prepare(
        `SELECT COUNT(*) AS count FROM reward_ledger WHERE reversible_group = ?`
      )
      .get(`habit:${habit.id}:${dateKey}`) as { count: number };
    assert.equal(firstRewards.count, 1);

    const corrected = createHabitCheckIn(habit.id, {
      dateKey,
      status: "done",
      note: "Private correction"
    })!;
    assert.equal(corrected.lastCheckInStatus, "done");
    assert.equal(corrected.streakCount, 0);
    const rewardTotal = database
      .prepare(
        `SELECT COALESCE(SUM(delta_xp), 0) AS total
         FROM reward_ledger WHERE reversible_group = ?`
      )
      .get(`habit:${habit.id}:${dateKey}`) as { total: number };
    assert.equal(rewardTotal.total, -habit.penaltyXp);

    const activity = database
      .prepare(
        `SELECT title, description, metadata_json
         FROM activity_events
         WHERE entity_type = 'habit' AND entity_id = ?
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(habit.id) as {
      title: string;
      description: string;
      metadata_json: string;
    };
    assert.match(activity.title, /^Habit performed:/);
    assert.match(activity.description, /logged as performed/);
    assert.equal(activity.metadata_json.includes("Private correction"), false);
  });
});

test("habit HTTP routes enforce user scope and collapse concurrent duplicate outcomes", async () => {
  await withHabitDatabase("habit-http-scope", async (app) => {
    const operatorHabit = createHabit(habitInput({ title: "Operator habit" }));
    const cookie = await issueOperatorSessionCookie(app);
    const token = await issueHabitToken(app, cookie, "user_forge_bot");
    const headers = { authorization: `Bearer ${token}` };

    const createdResponse = await app.inject({
      method: "POST",
      url: "/api/v1/habits",
      headers,
      payload: habitInput({
        title: "Scoped negative habit",
        timezone: "America/New_York",
        dayBoundaryMode: "travel",
        userId: undefined
      })
    });
    assert.equal(createdResponse.statusCode, 201, createdResponse.body);
    const scopedHabit = (
      createdResponse.json() as {
        habit: { id: string; userId: string; currentDateKey: string };
      }
    ).habit;
    assert.equal(scopedHabit.userId, "user_forge_bot");

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/v1/habits?timezone=Europe/Zurich",
      headers
    });
    assert.equal(listResponse.statusCode, 200);
    assert.deepEqual(
      (listResponse.json() as { habits: Array<{ id: string }> }).habits.map(
        (habit) => habit.id
      ),
      [scopedHabit.id]
    );

    const forbiddenRead = await app.inject({
      method: "GET",
      url: `/api/v1/habits/${operatorHabit.id}`,
      headers
    });
    assert.equal(forbiddenRead.statusCode, 404);
    const forbiddenWrite = await app.inject({
      method: "POST",
      url: `/api/v1/habits/${operatorHabit.id}/check-ins`,
      headers,
      payload: { status: "missed", timezone: "Europe/Zurich" }
    });
    assert.equal(forbiddenWrite.statusCode, 404);

    const receipts = await Promise.all(
      Array.from({ length: 12 }, () =>
        app.inject({
          method: "POST",
          url: `/api/v1/habits/${scopedHabit.id}/check-ins`,
          headers,
          payload: {
            dateKey: scopedHabit.currentDateKey,
            status: "missed",
            note: "Private HTTP evidence",
            timezone: "America/New_York"
          }
        })
      )
    );
    assert.ok(receipts.every((response) => response.statusCode === 200));

    const database = getDatabase();
    const checkInCount = database
      .prepare(
        `SELECT COUNT(*) AS count FROM habit_check_ins WHERE habit_id = ? AND date_key = ?`
      )
      .get(scopedHabit.id, scopedHabit.currentDateKey) as { count: number };
    assert.equal(checkInCount.count, 1);
    const rewardCount = database
      .prepare(
        `SELECT COUNT(*) AS count FROM reward_ledger WHERE reversible_group = ?`
      )
      .get(`habit:${scopedHabit.id}:${scopedHabit.currentDateKey}`) as {
      count: number;
    };
    assert.equal(rewardCount.count, 1);
  });
});

test("watch habit commands isolate users, dedupe retries, and expose polarity-safe copy", async () => {
  await withHabitDatabase("habit-watch-privacy", () => {
    const database = getDatabase();
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO users (
           id, kind, handle, display_name, description, accent_color, created_at, updated_at
         ) VALUES (?, 'human', ?, ?, '', '#22aa88', ?, ?)`
      )
      .run("user_private", "private-habit-user", "Private User", now, now);
    database
      .prepare(
        `INSERT INTO companion_pairing_sessions (
           id, user_id, label, pairing_token, status, capability_flags_json,
           api_base_url, expires_at, created_at, updated_at
         ) VALUES (?, ?, 'Private Watch', ?, 'paired', '["watch-ready"]', '', ?, ?, ?)`
      )
      .run(
        "pair_private",
        "user_private",
        "private-token",
        "2099-01-01T00:00:00.000Z",
        now,
        now
      );
    const operatorHabit = createHabit(habitInput({ title: "Operator secret" }));
    const privateHabit = createHabit(
      habitInput({
        title: "Private scrolling habit",
        userId: "user_private",
        dayBoundaryMode: "travel"
      })
    );
    const pairing = {
      id: "pair_private",
      user_id: "user_private",
      capability_flags_json: '["watch-ready"]'
    };
    const dateKey = getHabitById(privateHabit.id)!.currentDateKey;

    const forbidden = ingestWatchCommandBatch(pairing, {
      sessionId: pairing.id,
      pairingToken: "private-token",
      timezone: "Europe/Zurich",
      device: {
        name: "Private Watch",
        platform: "watchos",
        appVersion: "1",
        sourceDevice: "Apple Watch"
      },
      commands: [
        {
          id: "forbidden-habit-action",
          kind: "habit_check_in",
          createdAt: now,
          payload: {
            habitId: operatorHabit.id,
            dateKey,
            status: "missed",
            note: "Must not cross user scope"
          }
        }
      ]
    });
    assert.equal(forbidden.failedCount, 1);
    assert.equal(getHabitById(operatorHabit.id)!.checkIns.length, 0);

    const command = {
      id: "private-habit-action",
      kind: "habit_check_in" as const,
      createdAt: now,
      payload: {
        habitId: privateHabit.id,
        dateKey,
        status: "missed",
        note: "Private watch evidence",
        timezone: "Europe/Zurich"
      }
    };
    const accepted = ingestWatchCommandBatch(pairing, {
      sessionId: pairing.id,
      pairingToken: "private-token",
      timezone: "Europe/Zurich",
      device: {
        name: "Private Watch",
        platform: "watchos",
        appVersion: "1",
        sourceDevice: "Apple Watch"
      },
      commands: [command, command]
    });
    assert.equal(accepted.processedCount, 1);
    assert.equal(accepted.replayedCount, 1);
    assert.equal(getHabitById(privateHabit.id)!.checkIns.length, 1);

    const watch = buildWatchBootstrap(pairing, {
      timezone: "Europe/Zurich",
      anchorDateKey: dateKey
    });
    assert.deepEqual(
      watch.habits.map((entry) => entry.id),
      [privateHabit.id]
    );
    assert.equal(watch.habits[0]?.alignedActionLabel, "Resisted");
    assert.equal(watch.habits[0]?.unalignedActionLabel, "Performed");
    assert.equal("note" in (watch.habits[0] ?? {}), false);
  });
});

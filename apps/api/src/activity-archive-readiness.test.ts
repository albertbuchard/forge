import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import {
  listActivityEvents,
  recordActivityEvent,
  removeActivityEvent
} from "./repositories/activity-events.js";
import { createGoal } from "./repositories/goals.js";
import { createUser } from "./repositories/users.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";

test("activity reads filter exact evidence and redact secrets without changing the stored audit record", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-activity-archive-readiness-")
  );
  const app = await buildServer({
    dataRoot,
    seedDemoData: false,
    devrageMetricSync: false
  });

  try {
    const operatorCookie = issueTestOperatorSessionCookie(app);
    const otherUser = createUser({
      kind: "human",
      handle: "activity-filter-reader",
      displayName: "Activity filter reader",
      description: "",
      accentColor: "#336699"
    });
    const operatorGoal = createGoal({
      title: "Operator activity filter goal",
      description: "",
      horizon: "quarter",
      status: "active",
      targetPoints: 100,
      themeColor: "#336699",
      tagIds: [],
      notes: [],
      userId: "user_operator"
    });
    const otherGoal = createGoal({
      title: "Other user's activity filter goal",
      description: "",
      horizon: "quarter",
      status: "active",
      targetPoints: 100,
      themeColor: "#663399",
      tagIds: [],
      notes: [],
      userId: otherUser.id
    });
    const sentinel = "forge-activity-secret-81726354";
    const visibleEvent = recordActivityEvent(
      {
        entityType: "goal",
        entityId: operatorGoal.id,
        eventType: "goal_evidence_checked",
        title: `Rotated api_key=${sentinel}`,
        description: `Authorization: Bearer ${sentinel}`,
        actor: `token=${sentinel}`,
        source: "agent",
        metadata: {
          client_secret: sentinel,
          nested: {
            password: sentinel,
            note: "Ordinary audit context"
          }
        }
      },
      new Date("2026-08-08T10:00:00.000Z")
    );
    recordActivityEvent(
      {
        entityType: "goal",
        entityId: otherGoal.id,
        eventType: "goal_evidence_checked",
        title: "Other owner",
        source: "agent"
      },
      new Date("2026-08-08T10:30:00.000Z")
    );
    recordActivityEvent(
      {
        entityType: "task",
        entityId: "task_outside_entity_filter",
        eventType: "task_evidence_checked",
        title: "Other entity type",
        source: "agent"
      },
      new Date("2026-08-08T11:00:00.000Z")
    );
    recordActivityEvent(
      {
        entityType: "goal",
        entityId: operatorGoal.id,
        eventType: "goal_evidence_checked",
        title: "Other source",
        source: "ui"
      },
      new Date("2026-08-08T11:30:00.000Z")
    );
    recordActivityEvent(
      {
        entityType: "goal",
        entityId: operatorGoal.id,
        eventType: "goal_evidence_checked",
        title: "Outside date range",
        source: "agent"
      },
      new Date("2026-08-09T10:00:00.000Z")
    );
    let firstDecoyId: string | null = null;
    for (let index = 0; index < 101; index += 1) {
      const decoy = recordActivityEvent(
        {
          entityType: "goal",
          entityId: otherGoal.id,
          eventType: "goal_evidence_checked",
          title: `Newer other-owner event ${index + 1}`,
          source: "agent"
        },
        new Date(Date.parse("2026-08-08T10:00:30.000Z") + index * 60_000)
      );
      firstDecoyId ??= decoy.id;
    }
    assert.ok(firstDecoyId);
    getDatabase()
      .prepare("UPDATE activity_events SET title = '' WHERE id = ?")
      .run(firstDecoyId);

    assert.deepEqual(
      listActivityEvents({
        entityType: "goal",
        source: "agent",
        from: "2026-08-08",
        to: "2026-08-09",
        userIds: ["user_operator"],
        limit: 1
      }).map((event) => event.id),
      [visibleEvent.id]
    );

    const filtered = await app.inject({
      method: "GET",
      url:
        "/api/v1/activity?entityType=goal&source=agent&from=2026-08-08&to=2026-08-09" +
        "&userIds=user_operator&limit=100",
      headers: { cookie: operatorCookie }
    });
    assert.equal(filtered.statusCode, 200);
    const filteredBody = filtered.json() as {
      activity: Array<{
        id: string;
        title: string;
        description: string;
        actor: string | null;
        metadata: Record<string, unknown>;
        userId: string | null;
      }>;
    };
    assert.deepEqual(
      filteredBody.activity.map((event) => event.id),
      [visibleEvent.id]
    );
    assert.equal(filteredBody.activity[0]?.userId, "user_operator");
    assert.equal(JSON.stringify(filteredBody).includes(sentinel), false);
    assert.match(JSON.stringify(filteredBody), /\[redacted\]/);
    assert.equal(
      (filteredBody.activity[0]?.metadata.nested as Record<string, unknown>)
        .note,
      "Ordinary audit context"
    );

    const stored = getDatabase()
      .prepare(
        `SELECT title, description, actor, metadata_json
         FROM activity_events
         WHERE id = ?`
      )
      .get(visibleEvent.id) as Record<string, string>;
    assert.equal(JSON.stringify(stored).includes(sentinel), true);

    const correctedEvent = recordActivityEvent(
      {
        entityType: "goal",
        entityId: operatorGoal.id,
        eventType: "goal_evidence_checked",
        title: "Corrected activity entry",
        source: "ui"
      },
      new Date("2026-08-08T12:00:00.000Z")
    );
    removeActivityEvent(
      correctedEvent.id,
      { reason: "The visible log was incorrect." },
      { actor: "Operator", source: "ui" }
    );

    const defaultCorrectionView = await app.inject({
      method: "GET",
      url: `/api/v1/activity?entityId=${correctedEvent.entityId}&limit=100`,
      headers: { cookie: operatorCookie }
    });
    const defaultIds = (
      defaultCorrectionView.json() as { activity: Array<{ id: string }> }
    ).activity.map((event) => event.id);
    assert.equal(defaultIds.includes(correctedEvent.id), false);

    const completeCorrectionView = await app.inject({
      method: "GET",
      url:
        `/api/v1/activity?entityId=${correctedEvent.entityId}` +
        "&includeCorrected=true&limit=100",
      headers: { cookie: operatorCookie }
    });
    const completeIds = (
      completeCorrectionView.json() as { activity: Array<{ id: string }> }
    ).activity.map((event) => event.id);
    assert.equal(completeIds.includes(correctedEvent.id), true);
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

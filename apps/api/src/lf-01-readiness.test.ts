import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { createCalendarEvent } from "./repositories/calendar.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import { createCalendarEventSchema } from "./types.js";

async function issueScopedToken(input: {
  app: Awaited<ReturnType<typeof buildServer>>;
  cookie: string;
  label: string;
  userIds?: string[];
  projectIds?: string[];
  scopes?: string[];
}) {
  const response = await input.app.inject({
    method: "POST",
    url: "/api/v1/settings/tokens",
    headers: { cookie: input.cookie },
    payload: {
      label: input.label,
      scopes: input.scopes ?? ["read", "write"],
      scopePolicy: {
        userIds: input.userIds ?? [],
        projectIds: input.projectIds ?? [],
        tagIds: []
      }
    }
  });
  assert.equal(response.statusCode, 201);
  return (response.json() as { token: { token: string } }).token.token;
}

function createActiveCalendarEvent(input: { title: string; userId: string }) {
  const now = Date.now();
  return createCalendarEvent(
    createCalendarEventSchema.parse({
      title: input.title,
      description: "",
      location: "",
      startAt: new Date(now - 5 * 60_000).toISOString(),
      endAt: new Date(now + 55 * 60_000).toISOString(),
      timezone: "UTC",
      availability: "busy",
      eventType: "meeting",
      preferredCalendarId: null,
      userId: input.userId
    })
  );
}

test("LF-01 keeps overview, calendar drains, and derived ledger inside one authorized owner", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-lf-01-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const cookie = issueTestOperatorSessionCookie(app);
    const operatorHeaders = { cookie };
    const operatorEvent = createActiveCalendarEvent({
      title: "LF-01 operator private calendar",
      userId: "user_operator"
    });
    const botEvent = createActiveCalendarEvent({
      title: "LF-01 bot calendar",
      userId: "user_forge_bot"
    });

    const botToken = await issueScopedToken({
      app,
      cookie,
      label: "LF-01 bot read",
      userIds: ["user_forge_bot"]
    });
    const botOverview = await app.inject({
      method: "GET",
      url: "/api/v1/life-force",
      headers: { authorization: `Bearer ${botToken}` }
    });
    assert.equal(botOverview.statusCode, 200, botOverview.body);
    const botBody = botOverview.json() as {
      lifeForce: {
        userId: string;
        activeDrains: Array<{ sourceId: string; title: string }>;
        plannedDrains: Array<{ sourceId: string; title: string }>;
        provenance?: {
          evidence?: Array<{ label: string; reference: string }>;
        };
      };
    };
    assert.equal(botBody.lifeForce.userId, "user_forge_bot");
    assert.ok(
      botBody.lifeForce.activeDrains.some(
        (drain) => drain.sourceId === botEvent.id
      )
    );
    assert.equal(botOverview.body.includes(operatorEvent.title), false);
    assert.equal(
      [
        ...botBody.lifeForce.activeDrains,
        ...botBody.lifeForce.plannedDrains
      ].some((drain) => drain.sourceId === operatorEvent.id),
      false
    );
    assert.equal(
      botBody.lifeForce.provenance?.evidence?.some(
        (entry) => entry.reference === `calendar_event:${operatorEvent.id}`
      ) ?? false,
      false
    );
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT COUNT(*) AS count
             FROM ap_ledger_events
             WHERE user_id = ? AND entity_type = 'calendar_event'
               AND entity_id = ?`
          )
          .get("user_forge_bot", operatorEvent.id) as { count: number }
      ).count,
      0
    );
    assert.ok(
      (
        getDatabase()
          .prepare(
            `SELECT COUNT(*) AS count
             FROM ap_ledger_events
             WHERE user_id = ? AND entity_type = 'calendar_event'
               AND entity_id = ?`
          )
          .get("user_forge_bot", botEvent.id) as { count: number }
      ).count > 0
    );

    const operatorOverview = await app.inject({
      method: "GET",
      url: "/api/v1/life-force",
      headers: operatorHeaders
    });
    assert.equal(operatorOverview.statusCode, 200);
    assert.equal(operatorOverview.body.includes(operatorEvent.title), true);
    assert.equal(operatorOverview.body.includes(botEvent.title), false);

    const operatorToken = await issueScopedToken({
      app,
      cookie,
      label: "LF-01 operator read",
      userIds: ["user_operator"]
    });
    const deniedCrossOwnerRead = await app.inject({
      method: "GET",
      url: "/api/v1/life-force?userId=user_forge_bot",
      headers: { authorization: `Bearer ${operatorToken}` }
    });
    assert.equal(deniedCrossOwnerRead.statusCode, 403);

    const writeOnlyToken = await issueScopedToken({
      app,
      cookie,
      label: "LF-01 write only",
      userIds: ["user_forge_bot"],
      scopes: ["write"]
    });
    const deniedWriteOnlyRead = await app.inject({
      method: "GET",
      url: "/api/v1/life-force",
      headers: { authorization: `Bearer ${writeOnlyToken}` }
    });
    assert.equal(deniedWriteOnlyRead.statusCode, 403);

    const multiUserToken = await issueScopedToken({
      app,
      cookie,
      label: "LF-01 explicit owner",
      userIds: ["user_operator", "user_forge_bot"]
    });
    const missingOwner = await app.inject({
      method: "GET",
      url: "/api/v1/life-force",
      headers: { authorization: `Bearer ${multiUserToken}` }
    });
    assert.equal(missingOwner.statusCode, 400);

    const projectToken = await issueScopedToken({
      app,
      cookie,
      label: "LF-01 project read",
      projectIds: ["project_forge"]
    });
    const deniedProjectScope = await app.inject({
      method: "GET",
      url: "/api/v1/life-force",
      headers: { authorization: `Bearer ${projectToken}` }
    });
    assert.equal(deniedProjectScope.statusCode, 403);

    const unknownUser = await app.inject({
      method: "GET",
      url: "/api/v1/life-force?userId=user_missing",
      headers: operatorHeaders
    });
    assert.equal(unknownUser.statusCode, 404);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

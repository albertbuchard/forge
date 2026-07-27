import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import {
  createWorkBlockTemplate,
  listWorkBlockInstances,
  upsertCalendarEventRecord,
  upsertCalendarRecord
} from "./repositories/calendar.js";
import { classifyCalendarProjectionError } from "./services/calendar-runtime.js";

async function withServer(
  run: (app: Awaited<ReturnType<typeof buildServer>>) => Promise<void>
) {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-calendar-recurrence-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });
  try {
    await run(app);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
}

const operatorCookie = issueTestOperatorSessionCookie;

function insertConnection(input: {
  id: string;
  provider: "apple" | "google";
  secretId: string;
}) {
  const now = "2026-01-01T00:00:00.000Z";
  const database = getDatabase();
  database
    .prepare(
      `INSERT INTO stored_secrets (id, cipher_text, description, created_at, updated_at)
       VALUES (?, 'malformed', '', ?, ?)`
    )
    .run(input.secretId, now, now);
  database
    .prepare(
      `INSERT INTO calendar_connections (
         id, provider, label, account_label, status, config_json,
         credentials_secret_id, forge_calendar_id, last_synced_at,
         last_sync_error, created_at, updated_at
       ) VALUES (?, ?, 'Calendar', '', 'connected', '{}', ?, NULL, NULL, NULL, ?, ?)`
    )
    .run(input.id, input.provider, input.secretId, now, now);
}

test("work-block recurrence follows local wall time across DST, exclusions, and overnight windows", async () => {
  await withServer(async () => {
    const daytime = createWorkBlockTemplate({
      title: "Sunday recovery",
      kind: "rest",
      color: "#14b8a6",
      timezone: "Europe/Zurich",
      weekDays: [0],
      startMinute: 60,
      endMinute: 180,
      startsOn: "2026-03-01",
      endsOn: "2026-11-01",
      exclusionDates: ["2026-04-05"],
      blockingState: "blocked"
    });

    const spring = listWorkBlockInstances({
      from: "2026-03-28T00:00:00.000Z",
      to: "2026-03-30T00:00:00.000Z"
    }).find((instance) => instance.templateId === daytime.id);
    assert.ok(spring);
    assert.equal(spring.dateKey, "2026-03-29");
    assert.equal(spring.startAt, "2026-03-29T00:00:00.000Z");
    assert.equal(spring.endAt, "2026-03-29T01:00:00.000Z");

    const autumn = listWorkBlockInstances({
      from: "2026-10-24T00:00:00.000Z",
      to: "2026-10-26T12:00:00.000Z"
    }).find((instance) => instance.templateId === daytime.id);
    assert.ok(autumn);
    assert.equal(autumn.dateKey, "2026-10-25");
    assert.equal(autumn.startAt, "2026-10-24T23:00:00.000Z");
    assert.equal(autumn.endAt, "2026-10-25T02:00:00.000Z");

    const excluded = listWorkBlockInstances({
      from: "2026-04-04T00:00:00.000Z",
      to: "2026-04-06T00:00:00.000Z"
    }).filter((instance) => instance.templateId === daytime.id);
    assert.deepEqual(excluded, []);

    const overnight = createWorkBlockTemplate({
      title: "Overnight rest",
      kind: "rest",
      color: "#2563eb",
      timezone: "Europe/Zurich",
      weekDays: [1],
      startMinute: 22 * 60,
      endMinute: 6 * 60,
      startsOn: "2026-04-06",
      endsOn: "2026-04-06",
      blockingState: "blocked"
    });
    const overnightInstance = listWorkBlockInstances({
      from: "2026-04-06T00:00:00.000Z",
      to: "2026-04-07T12:00:00.000Z"
    }).find((instance) => instance.templateId === overnight.id);
    assert.ok(overnightInstance);
    assert.equal(overnightInstance.startAt, "2026-04-06T20:00:00.000Z");
    assert.equal(overnightInstance.endAt, "2026-04-07T04:00:00.000Z");
  });
});

test("work-block expansion rejects unbounded recurrence ranges", async () => {
  await withServer(async () => {
    createWorkBlockTemplate({
      title: "Bounded weekday block",
      kind: "main_activity",
      color: "#2563eb",
      timezone: "UTC",
      weekDays: [1, 2, 3, 4, 5],
      startMinute: 9 * 60,
      endMinute: 10 * 60,
      blockingState: "allowed"
    });
    assert.throws(
      () =>
        listWorkBlockInstances({
          from: "2026-01-01T00:00:00.000Z",
          to: "2029-01-01T00:00:00.000Z"
        }),
      (error: unknown) =>
        error instanceof Error && error.message.includes("at most 732")
    );
  });
});

test("recurring provider occurrences require explicit scope and remain read-only", async () => {
  await withServer(async (app) => {
    const cookie = await operatorCookie(app);
    insertConnection({
      id: "connection_google_recurring",
      provider: "google",
      secretId: "secret_google_recurring"
    });
    const calendar = upsertCalendarRecord("connection_google_recurring", {
      remoteId: "https://calendar.example/primary/",
      title: "Provider calendar",
      canWrite: true
    });
    const event = upsertCalendarEventRecord("connection_google_recurring", {
      calendarRemoteId: calendar.remoteId,
      remoteId: "provider-occurrence-1",
      title: "Weekly supervision",
      startAt: "2026-04-06T08:00:00.000Z",
      endAt: "2026-04-06T09:00:00.000Z",
      timezone: "Europe/Zurich",
      rawPayload: {
        recurringEventId: "provider-series-1",
        originalStartTime: {
          dateTime: "2026-04-06T10:00:00+02:00",
          timeZone: "Europe/Zurich"
        }
      }
    });
    assert.equal(
      event.sourceMappings[0]?.recurrenceInstanceId,
      "2026-04-06T10:00:00+02:00"
    );

    const missingScope = await app.inject({
      method: "PATCH",
      url: `/api/v1/calendar/events/${event.id}`,
      headers: { cookie },
      payload: { title: "Changed without scope" }
    });
    assert.equal(missingScope.statusCode, 409, missingScope.body);
    assert.equal(
      (missingScope.json() as { code: string }).code,
      "calendar_recurring_edit_scope_required"
    );

    const singleOccurrence = await app.inject({
      method: "PATCH",
      url: `/api/v1/calendar/events/${event.id}`,
      headers: { cookie },
      payload: {
        title: "Changed occurrence",
        recurrenceEditScope: "single"
      }
    });
    assert.equal(singleOccurrence.statusCode, 409, singleOccurrence.body);
    assert.equal(
      (singleOccurrence.json() as { code: string }).code,
      "calendar_provider_event_read_only"
    );
    const stored = await app.inject({
      method: "GET",
      url: `/api/v1/calendar/events/${event.id}`,
      headers: { cookie }
    });
    assert.equal(
      (stored.json() as { event: { title: string } }).event.title,
      "Weekly supervision"
    );
  });
});

test("provider projection failures preserve the local event and return a truthful result", async () => {
  await withServer(async (app) => {
    const cookie = await operatorCookie(app);
    insertConnection({
      id: "connection_apple_unavailable",
      provider: "apple",
      secretId: "secret_apple_unavailable"
    });
    const calendar = upsertCalendarRecord("connection_apple_unavailable", {
      remoteId: "https://calendar.example/forge/",
      title: "Writable calendar",
      canWrite: true,
      forgeManaged: true
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/calendar/events",
      headers: { cookie },
      payload: {
        title: "Locally durable event",
        startAt: "2026-04-06T08:00:00.000Z",
        endAt: "2026-04-06T09:00:00.000Z",
        timezone: "Europe/Zurich",
        preferredCalendarId: calendar.id
      }
    });
    assert.equal(response.statusCode, 201, response.body);
    const body = response.json() as {
      event: { id: string; title: string };
      projection: { state: string; code: string; retryable: boolean };
    };
    assert.equal(body.event.title, "Locally durable event");
    assert.equal(body.projection.state, "error");
    assert.equal(body.projection.code, "calendar_provider_unavailable");
    assert.equal(body.projection.retryable, true);

    const stored = await app.inject({
      method: "GET",
      url: `/api/v1/calendar/events/${body.event.id}`,
      headers: { cookie }
    });
    assert.equal(stored.statusCode, 200, stored.body);
    assert.equal(
      (stored.json() as { event: { title: string } }).event.title,
      "Locally durable event"
    );
  });
});

test("provider precondition failures receive a dedicated conflict result", () => {
  const result = classifyCalendarProjectionError(
    Object.assign(new Error("Precondition failed"), { status: 412 })
  );
  assert.deepEqual(result, {
    state: "error",
    code: "calendar_provider_conflict",
    message:
      "Forge saved the local event, but the provider copy changed first. Sync the calendar, review the latest provider version, and retry.",
    retryable: false
  });
});

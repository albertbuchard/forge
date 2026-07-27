import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { getDeletedEntityRecord } from "./repositories/deleted-entities.js";
import {
  listEntityLinksForEntity,
  replaceEntityLinksForSource
} from "./repositories/entity-links.js";
import {
  createTriggerReport,
  getTriggerReportById
} from "./repositories/psyche.js";

const issueOperatorSessionCookie = issueTestOperatorSessionCookie;

async function issueScopedToken(
  app: Awaited<ReturnType<typeof buildServer>>,
  cookie: string
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/settings/tokens",
    headers: { cookie },
    payload: {
      label: "Trigger report adversarial test",
      agentLabel: "PSY-10 adversarial test",
      scopes: ["read", "write", "psyche.read", "psyche.write"],
      scopePolicy: {
        userIds: ["user_operator"],
        projectIds: [],
        tagIds: []
      }
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { token: { token: string } }).token.token;
}

async function createGoal(
  app: Awaited<ReturnType<typeof buildServer>>,
  cookie: string,
  title: string
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/goals",
    headers: { cookie },
    payload: {
      title,
      description: "PSY-10 adversarial link fixture",
      horizon: "year",
      status: "active",
      userId: "user_operator",
      targetPoints: 100,
      themeColor: "#336699",
      tagIds: [],
      notes: []
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().goal.id as string;
}

test("trigger report search and pagination remain complete beyond mutable recent windows", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-trigger-report-search-adversarial-")
  );
  const app = await buildServer({
    dataRoot,
    seedDemoData: true,
    devrageMetricSync: false
  });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const token = await issueScopedToken(app, cookie);
    const headers = {
      authorization: `Bearer ${token}`,
      "x-forge-source": "agent"
    };
    const buried = createTriggerReport(
      {
        title: "Buried target 8d24e3",
        eventSituation: "This report must remain searchable beyond 200 rows.",
        userId: "user_operator"
      },
      { source: "system", actor: "trigger-report-adversarial-test" }
    );
    for (let index = 0; index < 205; index += 1) {
      createTriggerReport(
        {
          title: `Newer filler ${String(index).padStart(3, "0")}`,
          userId: "user_operator"
        },
        { source: "system", actor: "trigger-report-adversarial-test" }
      );
    }

    const search = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers,
      payload: {
        searches: [
          {
            entityTypes: ["trigger_report"],
            query: "8d24e3",
            limit: 10
          }
        ]
      }
    });
    assert.equal(search.statusCode, 200, search.body);
    const searchMatches = (
      search.json() as {
        results: Array<{ matches: Array<{ id: string }> }>;
      }
    ).results[0]!.matches;
    assert.deepEqual(
      searchMatches.map((match) => match.id),
      [buried.id]
    );

    const chronological = [1, 2, 3, 4].map((position) =>
      createTriggerReport(
        {
          title: `Cursor fixture ${position}`,
          userId: "user_operator"
        },
        { source: "system", actor: "trigger-report-adversarial-test" }
      )
    );
    const setTimes = getDatabase().prepare(
      `UPDATE trigger_reports
       SET created_at = ?, updated_at = ?
       WHERE id = ?`
    );
    for (const [index, report] of chronological.entries()) {
      const timestamp = `2030-01-0${index + 1}T00:00:00.000Z`;
      setTimes.run(timestamp, timestamp, report.id);
    }

    const firstPage = await app.inject({
      method: "GET",
      url: "/api/v1/psyche/reports?limit=2",
      headers
    });
    assert.equal(firstPage.statusCode, 200, firstPage.body);
    const firstBody = firstPage.json() as {
      reports: Array<{ id: string }>;
      nextCursor: string;
    };
    assert.deepEqual(
      firstBody.reports.map((report) => report.id),
      [chronological[3]!.id, chronological[2]!.id]
    );

    const updateUnseen = await app.inject({
      method: "PATCH",
      url: `/api/v1/psyche/reports/${chronological[1]!.id}`,
      headers,
      payload: {
        expectedRevision: 1,
        reflection: "Updated after page one without changing pagination order."
      }
    });
    assert.equal(updateUnseen.statusCode, 200, updateUnseen.body);

    const secondPage = await app.inject({
      method: "GET",
      url: `/api/v1/psyche/reports?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
      headers
    });
    assert.equal(secondPage.statusCode, 200, secondPage.body);
    assert.deepEqual(
      (secondPage.json() as { reports: Array<{ id: string }> }).reports.map(
        (report) => report.id
      ),
      [chronological[1]!.id, chronological[0]!.id]
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("trigger report idempotent replay precedes current dependency validation", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-trigger-report-replay-adversarial-")
  );
  const app = await buildServer({
    dataRoot,
    seedDemoData: true,
    devrageMetricSync: false
  });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const goalId = await createGoal(app, cookie, "Disposable linked goal");
    const payload = {
      title: "Idempotent linked episode",
      eventSituation: "The linked goal may be removed after the first write.",
      linkedGoalIds: [goalId],
      userId: "user_operator"
    };
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/reports",
      headers: { cookie, "idempotency-key": "replay-after-link-delete" },
      payload
    });
    assert.equal(first.statusCode, 201, first.body);
    const reportId = first.json().report.id as string;

    const deleteGoal = await app.inject({
      method: "POST",
      url: "/api/v1/entities/delete",
      headers: { cookie },
      payload: {
        operations: [{ entityType: "goal", id: goalId, mode: "hard" }]
      }
    });
    assert.equal(deleteGoal.statusCode, 200, deleteGoal.body);
    assert.equal(deleteGoal.json().results[0]?.ok, true);

    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/reports",
      headers: { cookie, "idempotency-key": "replay-after-link-delete" },
      payload
    });
    assert.equal(replay.statusCode, 201, replay.body);
    assert.equal(replay.json().report.id, reportId);

    const newWrite = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/reports",
      headers: { cookie, "idempotency-key": "new-after-link-delete" },
      payload: { ...payload, title: "New invalid linked episode" }
    });
    assert.equal(newWrite.statusCode, 400, newWrite.body);
    assert.equal(newWrite.json().code, "trigger_report_link_invalid");
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("trigger report interpretation correction requires consent and a hypothesis", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-trigger-report-consent-adversarial-")
  );
  const app = await buildServer({
    dataRoot,
    seedDemoData: true,
    devrageMetricSync: false
  });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const withoutConsent = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/reports",
      headers: { cookie },
      payload: {
        title: "Correction without consent",
        hypothesisCorrection: "The first interpretation missed the anger.",
        interpretationConsent: false,
        userId: "user_operator"
      }
    });
    assert.equal(withoutConsent.statusCode, 400, withoutConsent.body);
    assert.equal(
      withoutConsent.json().code,
      "trigger_report_interpretation_consent_required"
    );

    const withoutHypothesis = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/reports",
      headers: { cookie },
      payload: {
        title: "Correction without hypothesis",
        hypothesisCorrection: "The first interpretation missed the anger.",
        interpretationConsent: true,
        userId: "user_operator"
      }
    });
    assert.equal(withoutHypothesis.statusCode, 400, withoutHypothesis.body);
    assert.equal(
      withoutHypothesis.json().code,
      "trigger_report_hypothesis_required"
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("direct trigger report delete stays soft and batch hard delete clears every generic link", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-trigger-report-delete-adversarial-")
  );
  const app = await buildServer({
    dataRoot,
    seedDemoData: true,
    devrageMetricSync: false
  });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const goalId = await createGoal(app, cookie, "Incoming link source goal");
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/reports",
      headers: { cookie },
      payload: {
        title: "Soft-only direct delete",
        userId: "user_operator"
      }
    });
    assert.equal(create.statusCode, 201, create.body);
    const reportId = create.json().report.id as string;
    replaceEntityLinksForSource({
      sourceEntityType: "goal",
      sourceEntityId: goalId,
      links: [
        {
          entityType: "trigger_report",
          entityId: reportId,
          relationship: "supporting_context"
        }
      ],
      actor: "trigger-report-adversarial-test"
    });

    const directDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/psyche/reports/${reportId}?mode=hard`,
      headers: { cookie }
    });
    assert.equal(directDelete.statusCode, 200, directDelete.body);
    assert.ok(getDeletedEntityRecord("trigger_report", reportId));
    assert.equal(
      (
        getDatabase()
          .prepare("SELECT COUNT(*) AS count FROM trigger_reports WHERE id = ?")
          .get(reportId) as { count: number }
      ).count,
      1
    );
    assert.equal(
      listEntityLinksForEntity("trigger_report", reportId).length,
      1
    );

    const restore = await app.inject({
      method: "POST",
      url: "/api/v1/entities/restore",
      headers: { cookie },
      payload: { operations: [{ entityType: "trigger_report", id: reportId }] }
    });
    assert.equal(restore.statusCode, 200, restore.body);
    assert.equal(restore.json().results[0]?.ok, true);
    assert.ok(getTriggerReportById(reportId));

    const hardDelete = await app.inject({
      method: "POST",
      url: "/api/v1/entities/delete",
      headers: { cookie },
      payload: {
        operations: [
          { entityType: "trigger_report", id: reportId, mode: "hard" }
        ]
      }
    });
    assert.equal(hardDelete.statusCode, 200, hardDelete.body);
    assert.equal(hardDelete.json().results[0]?.ok, true);
    assert.equal(
      listEntityLinksForEntity("trigger_report", reportId).length,
      0
    );
    assert.equal(
      (
        getDatabase()
          .prepare("SELECT COUNT(*) AS count FROM trigger_reports WHERE id = ?")
          .get(reportId) as { count: number }
      ).count,
      0
    );
    assert.equal(getDeletedEntityRecord("trigger_report", reportId), undefined);
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("batch hard delete returns the linked entity snapshot before purging generic links", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-hard-delete-link-snapshot-")
  );
  const app = await buildServer({
    dataRoot,
    seedDemoData: true,
    devrageMetricSync: false
  });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const goalId = await createGoal(app, cookie, "Life Event link target");
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: { cookie },
      payload: {
        operations: [
          {
            entityType: "life_event",
            data: {
              title: "Linked event to delete",
              startsAt: "2030-01-01T10:00:00.000Z",
              calendarProjection: "none",
              userId: "user_operator",
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
    assert.equal(create.statusCode, 200, create.body);
    const created = create.json().results[0]?.entity as
      | { id: string; links: Array<{ targetEntityId: string }> }
      | undefined;
    assert.ok(created);
    assert.deepEqual(
      created.links.map((link) => link.targetEntityId),
      [goalId]
    );

    const hardDelete = await app.inject({
      method: "POST",
      url: "/api/v1/entities/delete",
      headers: { cookie },
      payload: {
        operations: [{ entityType: "life_event", id: created.id, mode: "hard" }]
      }
    });
    assert.equal(hardDelete.statusCode, 200, hardDelete.body);
    const deleted = hardDelete.json().results[0]?.entity as
      | { id: string; links: Array<{ targetEntityId: string }> }
      | undefined;
    assert.ok(deleted);
    assert.deepEqual(
      deleted.links.map((link) => link.targetEntityId),
      [goalId]
    );
    assert.equal(listEntityLinksForEntity("life_event", created.id).length, 0);
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";

test("PSY-14 denies out-of-scope questionnaire run start, read, update, and completion without writes", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-psy-14-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const cookie = issueTestOperatorSessionCookie(app);
    const library = await app.inject({
      method: "GET",
      url: "/api/v1/psyche/questionnaires",
      headers: { cookie }
    });
    assert.equal(library.statusCode, 200, library.body);
    const phq9 = (
      library.json() as {
        instruments: Array<{ id: string; key: string }>;
      }
    ).instruments.find((instrument) => instrument.key === "phq_9");
    assert.ok(phq9);

    const started = await app.inject({
      method: "POST",
      url: `/api/v1/psyche/questionnaires/${phq9.id}/runs`,
      headers: { cookie },
      payload: { userId: "user_forge_bot" }
    });
    assert.equal(started.statusCode, 201, started.body);
    const runId = (started.json() as { run: { id: string } }).run.id;

    const tokenResponse = await app.inject({
      method: "POST",
      url: "/api/v1/settings/tokens",
      headers: { cookie },
      payload: {
        label: "PSY-14 owner scope",
        agentLabel: "PSY-14 test agent",
        scopes: ["read", "write", "psyche.read", "psyche.write"],
        scopePolicy: {
          userIds: ["user_operator"],
          projectIds: [],
          tagIds: []
        }
      }
    });
    assert.equal(tokenResponse.statusCode, 201, tokenResponse.body);
    const token = (tokenResponse.json() as { token: { token: string } }).token
      .token;
    const headers = { authorization: `Bearer ${token}` };

    const forbiddenStart = await app.inject({
      method: "POST",
      url: `/api/v1/psyche/questionnaires/${phq9.id}/runs`,
      headers,
      payload: { userId: "user_forge_bot" }
    });
    assert.equal(forbiddenStart.statusCode, 404, forbiddenStart.body);
    assert.equal(
      (forbiddenStart.json() as { code: string }).code,
      "entity_not_found"
    );

    const forbiddenRead = await app.inject({
      method: "GET",
      url: `/api/v1/psyche/questionnaire-runs/${runId}`,
      headers
    });
    assert.equal(forbiddenRead.statusCode, 404, forbiddenRead.body);
    assert.equal(
      (forbiddenRead.json() as { code: string }).code,
      "questionnaire_run_not_found"
    );

    const forbiddenUpdate = await app.inject({
      method: "PATCH",
      url: `/api/v1/psyche/questionnaire-runs/${runId}`,
      headers,
      payload: {
        answers: [
          {
            itemId: "phq9_1",
            optionKey: "nearly_every_day",
            valueText: "Nearly every day",
            numericValue: 3,
            answer: { value: 3 }
          }
        ],
        progressIndex: 1
      }
    });
    assert.equal(forbiddenUpdate.statusCode, 404, forbiddenUpdate.body);
    assert.equal(
      (forbiddenUpdate.json() as { code: string }).code,
      "questionnaire_run_not_found"
    );

    const forbiddenComplete = await app.inject({
      method: "POST",
      url: `/api/v1/psyche/questionnaire-runs/${runId}/complete`,
      headers,
      payload: {}
    });
    assert.equal(forbiddenComplete.statusCode, 404, forbiddenComplete.body);
    assert.equal(
      (forbiddenComplete.json() as { code: string }).code,
      "questionnaire_run_not_found"
    );

    const stored = getDatabase()
      .prepare(
        `SELECT status, progress_index,
                (SELECT count(*) FROM questionnaire_answers WHERE run_id = questionnaire_runs.id) AS answer_count,
                (SELECT count(*) FROM questionnaire_run_scores WHERE run_id = questionnaire_runs.id) AS score_count,
                (SELECT count(*) FROM notes WHERE json_extract(frontmatter_json, '$.questionnaireRunId') = questionnaire_runs.id) AS note_count,
                (SELECT count(*) FROM activity_events WHERE entity_type = 'questionnaire_run' AND entity_id = questionnaire_runs.id AND event_type = 'questionnaire_run_completed') AS completion_activity_count
         FROM questionnaire_runs
         WHERE id = ?`
      )
      .get(runId) as {
      status: string;
      progress_index: number;
      answer_count: number;
      score_count: number;
      note_count: number;
      completion_activity_count: number;
    };
    assert.deepEqual(
      {
        status: stored.status,
        progressIndex: stored.progress_index,
        answerCount: stored.answer_count,
        scoreCount: stored.score_count,
        noteCount: stored.note_count,
        completionActivityCount: stored.completion_activity_count
      },
      {
        status: "draft",
        progressIndex: 0,
        answerCount: 0,
        scoreCount: 0,
        noteCount: 0,
        completionActivityCount: 0
      }
    );

    getDatabase()
      .prepare("UPDATE questionnaire_runs SET user_id = NULL WHERE id = ?")
      .run(runId);
    const ownerlessRead = await app.inject({
      method: "GET",
      url: `/api/v1/psyche/questionnaire-runs/${runId}`,
      headers
    });
    assert.equal(ownerlessRead.statusCode, 404, ownerlessRead.body);
    assert.equal(
      (ownerlessRead.json() as { code: string }).code,
      "questionnaire_run_not_found"
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

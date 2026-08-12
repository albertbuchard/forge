import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import {
  createPreferenceItem,
  getPreferenceWorkspace,
  refreshPreferenceWorkspace
} from "./repositories/preferences.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import type { MutationReceipt } from "./services/mutation-receipts.js";

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

test("pairwise judgments return one durable receipt and undo preference learning atomically", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-preference-judgment-undo-")
  );
  const app = await buildServer({
    dataRoot,
    seedDemoData: true,
    devrageMetricSync: false
  });
  const cookie = issueTestOperatorSessionCookie(app);
  try {
    const workspace = refreshPreferenceWorkspace({
      userId: "user_operator",
      domain: "projects"
    });
    const left = createPreferenceItem({
      userId: "user_operator",
      domain: "projects",
      label: "Undo left",
      description: "",
      tags: [],
      featureWeights: dimensions,
      metadata: {},
      queueForCompare: false
    });
    const right = createPreferenceItem({
      userId: "user_operator",
      domain: "projects",
      label: "Undo right",
      description: "",
      tags: [],
      featureWeights: dimensions,
      metadata: {},
      queueForCompare: false
    });
    const payload = {
      userId: "user_operator",
      domain: "projects",
      contextId: workspace.selectedContext.id,
      leftItemId: left.id,
      rightItemId: right.id,
      outcome: "left",
      strength: 2,
      reasonTags: []
    };
    const headers = {
      cookie,
      "idempotency-key": "preference_judgment_undo_original"
    };

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/judgments",
      headers,
      payload
    });
    assert.equal(created.statusCode, 201, created.body);
    const createdBody = created.json() as {
      judgment: { id: string };
      mutationReceipt: MutationReceipt;
    };
    assert.equal(createdBody.mutationReceipt.operation, "preference_judgment");
    assert.equal(createdBody.mutationReceipt.status, "available");

    const submissionReplay = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/judgments",
      headers,
      payload
    });
    assert.equal(submissionReplay.statusCode, 200, submissionReplay.body);
    assert.equal(submissionReplay.headers["idempotency-replayed"], "true");
    assert.equal(
      (submissionReplay.json() as { mutationReceipt: MutationReceipt })
        .mutationReceipt.id,
      createdBody.mutationReceipt.id
    );

    const undone = await app.inject({
      method: "POST",
      url: `/api/v1/mutation-receipts/${createdBody.mutationReceipt.id}/undo`,
      headers: { cookie, "idempotency-key": "undo_preference_judgment_once" }
    });
    assert.equal(undone.statusCode, 200, undone.body);
    assert.equal(
      (undone.json() as { receipt: MutationReceipt }).receipt.status,
      "undone"
    );

    const stored = getDatabase()
      .prepare(
        `SELECT undone_at, undone_by_actor, undone_source
         FROM pairwise_judgments WHERE id = ?`
      )
      .get(createdBody.judgment.id) as {
      undone_at: string | null;
      undone_by_actor: string | null;
      undone_source: string | null;
    };
    assert.ok(stored.undone_at);
    assert.ok(stored.undone_by_actor);
    assert.equal(stored.undone_source, "ui");
    assert.equal(
      getPreferenceWorkspace({
        userId: "user_operator",
        domain: "projects",
        contextId: workspace.selectedContext.id
      }).history.judgments.some(
        (judgment) => judgment.id === createdBody.judgment.id
      ),
      false
    );
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT COUNT(*) AS count FROM activity_events
             WHERE event_type = 'preference_judgment_undone'
               AND json_extract(metadata_json, '$.judgmentId') = ?`
          )
          .get(createdBody.judgment.id) as { count: number }
      ).count,
      1
    );

    const undoReplay = await app.inject({
      method: "POST",
      url: `/api/v1/mutation-receipts/${createdBody.mutationReceipt.id}/undo`,
      headers: { cookie, "idempotency-key": "undo_preference_judgment_once" }
    });
    assert.equal(undoReplay.statusCode, 200, undoReplay.body);
    assert.equal(undoReplay.headers["idempotency-replayed"], "true");

    const staleSubmission = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/judgments",
      headers,
      payload
    });
    assert.equal(staleSubmission.statusCode, 409, staleSubmission.body);
    assert.equal(
      (staleSubmission.json() as { code: string }).code,
      "preferences_judgment_undone"
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

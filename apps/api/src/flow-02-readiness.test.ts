import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";

test("FLOW-02 rejects stale writes and restores exact contracts as a new revision", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-flow-02-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const cookie = issueTestOperatorSessionCookie(app);
    const headers = { cookie };
    const createdResponse = await app.inject({
      method: "POST",
      url: "/api/v1/workbench/flows",
      headers,
      payload: {
        title: "Stable contract flow",
        description: "Version one",
        kind: "functor",
        publicInputs: [
          {
            key: "topic",
            label: "Topic",
            kind: "text",
            required: true,
            bindings: []
          }
        ]
      }
    });
    assert.equal(createdResponse.statusCode, 201, createdResponse.body);
    const created = createdResponse.json() as {
      flow: {
        id: string;
        revision: number;
        title: string;
        publicInputs: Array<{ key: string }>;
        publishedOutputs: Array<{ id: string }>;
      };
    };
    assert.equal(created.flow.revision, 1);
    assert.deepEqual(
      created.flow.publicInputs.map((input) => input.key),
      ["topic"]
    );
    const flowId = created.flow.id;

    const firstUpdate = await app.inject({
      method: "PATCH",
      url: `/api/v1/workbench/flows/${flowId}`,
      headers,
      payload: {
        expectedRevision: 1,
        title: "Accepted newer title",
        description: "Version two",
        publicInputs: []
      }
    });
    assert.equal(firstUpdate.statusCode, 200, firstUpdate.body);
    assert.equal(firstUpdate.json().flow.revision, 2);

    const staleUpdate = await app.inject({
      method: "PATCH",
      url: `/api/v1/workbench/flows/${flowId}`,
      headers,
      payload: {
        expectedRevision: 1,
        title: "Stale overwrite"
      }
    });
    assert.equal(staleUpdate.statusCode, 409, staleUpdate.body);
    assert.equal(staleUpdate.json().code, "workbench_flow_revision_conflict");
    assert.equal(staleUpdate.json().currentRevision, 2);

    const afterConflict = await app.inject({
      method: "GET",
      url: `/api/v1/workbench/flows/${flowId}`,
      headers
    });
    assert.equal(afterConflict.statusCode, 200);
    assert.equal(afterConflict.json().flow.title, "Accepted newer title");
    assert.deepEqual(afterConflict.json().flow.publicInputs, []);

    const versionsResponse = await app.inject({
      method: "GET",
      url: `/api/v1/workbench/flows/${flowId}/versions?limit=20`,
      headers
    });
    assert.equal(versionsResponse.statusCode, 200, versionsResponse.body);
    const versions = versionsResponse.json() as {
      versions: Array<{
        revision: number;
        changeKind: string;
        publicInputCount: number;
      }>;
      total: number;
    };
    assert.equal(versions.total, 2);
    assert.deepEqual(
      versions.versions.map((version) => [
        version.revision,
        version.changeKind,
        version.publicInputCount
      ]),
      [
        [2, "updated", 0],
        [1, "created", 1]
      ]
    );

    const exactVersion = await app.inject({
      method: "GET",
      url: `/api/v1/workbench/flows/${flowId}/versions/1`,
      headers
    });
    assert.equal(exactVersion.statusCode, 200, exactVersion.body);
    assert.equal(
      exactVersion.json().version.snapshot.title,
      "Stable contract flow"
    );
    assert.deepEqual(
      exactVersion
        .json()
        .version.snapshot.publicInputs.map(
          (input: { key: string }) => input.key
        ),
      ["topic"]
    );
    assert.deepEqual(
      exactVersion
        .json()
        .version.snapshot.publishedOutputs.map(
          (output: { id: string }) => output.id
        ),
      created.flow.publishedOutputs.map((output) => output.id)
    );

    const restoredResponse = await app.inject({
      method: "POST",
      url: `/api/v1/workbench/flows/${flowId}/restore`,
      headers,
      payload: { revision: 1, expectedRevision: 2 }
    });
    assert.equal(restoredResponse.statusCode, 200, restoredResponse.body);
    assert.equal(restoredResponse.json().flow.revision, 3);
    assert.equal(restoredResponse.json().flow.title, "Stable contract flow");
    assert.deepEqual(
      restoredResponse
        .json()
        .flow.publicInputs.map((input: { key: string }) => input.key),
      ["topic"]
    );

    const restoredVersion = await app.inject({
      method: "GET",
      url: `/api/v1/workbench/flows/${flowId}/versions/3`,
      headers
    });
    assert.equal(restoredVersion.statusCode, 200);
    assert.equal(restoredVersion.json().version.changeKind, "restored");
    assert.equal(restoredVersion.json().version.restoredFromRevision, 1);

    const staleDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/workbench/flows/${flowId}`,
      headers,
      payload: { expectedRevision: 2 }
    });
    assert.equal(staleDelete.statusCode, 409, staleDelete.body);
    assert.equal(staleDelete.json().currentRevision, 3);

    const acceptedDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/workbench/flows/${flowId}`,
      headers,
      payload: { expectedRevision: 3 }
    });
    assert.equal(acceptedDelete.statusCode, 200, acceptedDelete.body);
    assert.equal(acceptedDelete.json().flow.revision, 3);
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT COUNT(*) AS count
             FROM ai_connector_versions
             WHERE connector_id = ?`
          )
          .get(flowId) as { count: number }
      ).count,
      0
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

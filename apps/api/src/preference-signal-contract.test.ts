import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildServer } from "./app.js";
import {
  closeDatabase,
  configureDatabase,
  getDatabase,
  initializeDatabase
} from "./db.js";
import {
  createPreferenceContext,
  createPreferenceItem,
  deletePreferenceContext,
  deletePreferenceItem,
  getPreferenceWorkspace,
  refreshPreferenceWorkspace,
  submitAbsoluteSignal,
  submitPairwiseJudgment
} from "./repositories/preferences.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, "../../..");
const databaseModuleUrl = pathToFileURL(path.join(moduleDir, "db.ts")).href;
const repositoryModuleUrl = pathToFileURL(
  path.join(moduleDir, "repositories", "preferences.ts")
).href;

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

function itemInput(domain: "projects" | "food", label: string) {
  return {
    userId: "user_operator",
    domain,
    label,
    description: "",
    tags: [],
    featureWeights: dimensions,
    metadata: {},
    queueForCompare: false
  };
}

const issueOperatorSessionCookie = issueTestOperatorSessionCookie;

async function issueScopedToken(
  app: Awaited<ReturnType<typeof buildServer>>,
  cookie: string,
  userId: string
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/settings/tokens",
    headers: { cookie },
    payload: {
      label: "Preference signal contract test",
      agentLabel: "Signal API test",
      scopes: ["read", "write"],
      scopePolicy: { userIds: [userId], projectIds: [], tagIds: [] }
    }
  });
  assert.equal(response.statusCode, 201);
  return (response.json() as { token: { token: string } }).token.token;
}

test("preference signal API is naturally idempotent and replacement-safe", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-pref-signal-api-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  try {
    const cookie = await issueOperatorSessionCookie(app);
    const token = await issueScopedToken(app, cookie, "user_operator");
    const baseWorkspace = refreshPreferenceWorkspace({
      userId: "user_operator",
      domain: "projects"
    });
    const target = createPreferenceItem(
      itemInput("projects", "Direct signal target")
    );
    const payload = {
      userId: "user_operator",
      domain: "projects",
      contextId: baseWorkspace.selectedContext.id,
      itemId: target.id,
      signalType: "favorite",
      strength: 1
    } as const;

    const responses = [];
    for (let index = 0; index < 10; index += 1) {
      responses.push(
        await app.inject({
          method: "POST",
          url: "/api/v1/preferences/signals",
          headers: {
            authorization: `Bearer ${token}`,
            "x-forge-source": "agent",
            "x-forge-actor": "Spoofed signal actor"
          },
          payload
        })
      );
    }
    assert.ok(responses.every((response) => response.statusCode === 201));
    const ids = new Set(
      responses.map(
        (response) => (response.json() as { signal: { id: string } }).signal.id
      )
    );
    assert.equal(ids.size, 1);
    const firstSignal = (
      responses[0]!.json() as {
        signal: { actor: string | null; source: string };
      }
    ).signal;
    assert.equal(firstSignal.actor, "Signal API test");
    assert.equal(firstSignal.source, "agent");
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT COUNT(*) AS count FROM absolute_signals WHERE item_id = ?`
          )
          .get(target.id) as { count: number }
      ).count,
      1
    );

    const reaffirmedByAnotherActor = submitAbsoluteSignal(payload, {
      source: "agent",
      actor: "Second preference actor"
    });
    assert.notEqual(reaffirmedByAnotherActor.id, [...ids][0]);
    assert.equal(reaffirmedByAnotherActor.actor, "Second preference actor");
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT COUNT(*) AS count FROM absolute_signals WHERE item_id = ?`
          )
          .get(target.id) as { count: number }
      ).count,
      2,
      "a distinct actor must create a new auditable reaffirmation"
    );

    const veto = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/signals",
      headers: { cookie },
      payload: { ...payload, signalType: "veto" }
    });
    const neutral = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/signals",
      headers: { cookie },
      payload: { ...payload, signalType: "neutral" }
    });
    assert.equal(veto.statusCode, 201);
    assert.equal(neutral.statusCode, 201);
    const neutralResponse = neutral.json() as {
      signal: { id: string; signalType: string };
      score: {
        itemId: string;
        status: string;
        signalCount: number;
        effectiveSignal: { id: string; signalType: string } | null;
      };
    };
    assert.equal(neutralResponse.signal.signalType, "neutral");
    assert.equal(neutralResponse.score.itemId, target.id);
    assert.equal(neutralResponse.score.status, "uncertain");
    assert.equal(neutralResponse.score.signalCount, 0);
    assert.equal(
      neutralResponse.score.effectiveSignal?.id,
      neutralResponse.signal.id
    );

    const workspace = getPreferenceWorkspace({
      userId: "user_operator",
      domain: "projects",
      contextId: baseWorkspace.selectedContext.id
    });
    const score = workspace.scores.find((entry) => entry.itemId === target.id);
    assert.ok(score);
    assert.equal(score.status, "uncertain");
    assert.equal(score.latentScore, 0);
    assert.equal(score.signalCount, 0);
    assert.equal(score.evidenceCount, 0);
    assert.equal(score.effectiveSignal?.signalType, "neutral");
    assert.ok(
      score.explanation.some((line) =>
        line.includes("no direct weight is active")
      )
    );
    assert.deepEqual(
      workspace.history.signals
        .filter((signal) => signal.itemId === target.id)
        .map((signal) => signal.signalType),
      ["neutral", "veto", "favorite", "favorite"]
    );
    const owner = getDatabase()
      .prepare(
        `SELECT user_id FROM entity_owners WHERE entity_type = 'preference_signal' AND entity_id = ?`
      )
      .get(neutralResponse.signal.id) as { user_id: string } | undefined;
    assert.equal(owner?.user_id, "user_operator");

    const wrongProfileItem = createPreferenceItem(
      itemInput("food", "Wrong profile target")
    );
    const wrongProfile = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/signals",
      headers: { cookie },
      payload: { ...payload, itemId: wrongProfileItem.id }
    });
    assert.equal(wrongProfile.statusCode, 400);
    assert.equal(wrongProfile.json().code, "preferences_invalid_signal_item");

    const wrongProfileJudgment = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/judgments",
      headers: { cookie },
      payload: {
        userId: "user_operator",
        domain: "projects",
        contextId: baseWorkspace.selectedContext.id,
        leftItemId: target.id,
        rightItemId: wrongProfileItem.id,
        outcome: "left",
        strength: 1,
        responseTimeMs: null,
        reasonTags: []
      }
    });
    assert.equal(wrongProfileJudgment.statusCode, 400);
    assert.equal(
      wrongProfileJudgment.json().code,
      "preferences_invalid_judgment_item"
    );

    const targetSignalIds = workspace.history.signals
      .filter((signal) => signal.itemId === target.id)
      .map((signal) => signal.id);
    deletePreferenceItem(target.id);
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT COUNT(*) AS count
             FROM entity_owners
             WHERE entity_type = 'preference_signal'
               AND entity_id IN (${targetSignalIds.map(() => "?").join(", ")})`
          )
          .get(...targetSignalIds) as { count: number }
      ).count,
      0,
      "deleting an item must not leave signal ownership rows orphaned"
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("preference signal model respects context scope, provenance, conflicts, and bounded history", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-pref-signal-model-")
  );
  configureDatabase({ dataRoot: rootDir, seedDemoData: true });
  try {
    await initializeDatabase();
    const base = refreshPreferenceWorkspace({
      userId: "user_operator",
      domain: "projects"
    });
    const target = createPreferenceItem(itemInput("projects", "Scoped target"));
    const peer = createPreferenceItem(itemInput("projects", "Scoped peer"));
    const isolated = createPreferenceContext({
      userId: "user_operator",
      domain: "projects",
      name: "Strict scope",
      description: "",
      shareMode: "isolated",
      active: true,
      isDefault: false,
      decayDays: 90
    });
    const blended = createPreferenceContext({
      userId: "user_operator",
      domain: "projects",
      name: "Blended scope",
      description: "",
      shareMode: "blended",
      active: true,
      isDefault: false,
      decayDays: 90
    });
    const orientationTarget = createPreferenceItem(
      itemInput("projects", "Orientation target")
    );
    const orientationPeer = createPreferenceItem(
      itemInput("projects", "Orientation peer")
    );

    submitPairwiseJudgment({
      userId: "user_operator",
      domain: "projects",
      contextId: isolated.id,
      leftItemId: orientationTarget.id,
      rightItemId: orientationPeer.id,
      outcome: "left",
      strength: 1,
      responseTimeMs: null,
      reasonTags: []
    });
    submitPairwiseJudgment({
      userId: "user_operator",
      domain: "projects",
      contextId: isolated.id,
      leftItemId: orientationPeer.id,
      rightItemId: orientationTarget.id,
      outcome: "right",
      strength: 1,
      responseTimeMs: null,
      reasonTags: []
    });
    const consistentOrientationScore = getPreferenceWorkspace({
      userId: "user_operator",
      domain: "projects",
      contextId: isolated.id,
      itemLimit: 100
    }).scores.find((score) => score.itemId === orientationTarget.id);
    assert.equal(
      consistentOrientationScore?.conflictCount,
      0,
      "reversing card orientation must not turn the same preference into a conflict"
    );

    submitPairwiseJudgment({
      userId: "user_operator",
      domain: "projects",
      contextId: isolated.id,
      leftItemId: orientationTarget.id,
      rightItemId: orientationPeer.id,
      outcome: "right",
      strength: 1,
      responseTimeMs: null,
      reasonTags: []
    });
    const contradictoryOrientationScore = getPreferenceWorkspace({
      userId: "user_operator",
      domain: "projects",
      contextId: isolated.id
    }).scores.find((score) => score.itemId === orientationTarget.id);
    assert.ok((contradictoryOrientationScore?.conflictCount ?? 0) > 0);

    const signal = submitAbsoluteSignal(
      {
        userId: "user_operator",
        domain: "projects",
        contextId: isolated.id,
        itemId: target.id,
        signalType: "favorite",
        strength: 1
      },
      { source: "agent", actor: "Preference signal actor" }
    );
    assert.equal(signal.ownerUserId, "user_operator");
    assert.equal(signal.actor, "Preference signal actor");
    assert.equal(signal.source, "agent");
    assert.equal(signal.modelWeight, 1.25);

    const isolatedView = getPreferenceWorkspace({
      userId: "user_operator",
      domain: "projects",
      contextId: isolated.id,
      itemLimit: 100
    });
    const blendedView = getPreferenceWorkspace({
      userId: "user_operator",
      domain: "projects",
      contextId: blended.id,
      itemLimit: 100
    });
    const defaultView = getPreferenceWorkspace({
      userId: "user_operator",
      domain: "projects",
      contextId: base.selectedContext.id,
      itemLimit: 100
    });
    assert.equal(
      isolatedView.scores.find((score) => score.itemId === target.id)?.status,
      "favorite"
    );
    assert.ok(
      Math.abs(
        (blendedView.scores.find((score) => score.itemId === target.id)
          ?.latentScore ?? 0) - Math.tanh((1.25 * 0.45) / 4)
      ) < 0.000_001
    );
    assert.ok(
      (defaultView.scores.find((score) => score.itemId === target.id)
        ?.latentScore ?? 0) > 0
    );

    submitPairwiseJudgment({
      userId: "user_operator",
      domain: "projects",
      contextId: isolated.id,
      leftItemId: target.id,
      rightItemId: peer.id,
      outcome: "left",
      strength: 1,
      responseTimeMs: null,
      reasonTags: []
    });
    submitAbsoluteSignal({
      userId: "user_operator",
      domain: "projects",
      contextId: isolated.id,
      itemId: target.id,
      signalType: "veto",
      strength: 1
    });
    const conflicted = getPreferenceWorkspace({
      userId: "user_operator",
      domain: "projects",
      contextId: isolated.id
    }).scores.find((score) => score.itemId === target.id);
    assert.ok((conflicted?.conflictCount ?? 0) > 0);
    assert.ok(
      conflicted?.explanation.some((line) =>
        line.includes("prior judgments conflict")
      )
    );

    const historyBoundedItem = createPreferenceItem(
      itemInput("projects", "History-bounded direct mark")
    );
    const historyBoundedSignal = submitAbsoluteSignal({
      userId: "user_operator",
      domain: "projects",
      contextId: isolated.id,
      itemId: historyBoundedItem.id,
      signalType: "must_have",
      strength: 1
    });
    getDatabase()
      .prepare(`UPDATE absolute_signals SET created_at = ? WHERE id = ?`)
      .run("2025-01-01T00:00:00.000Z", historyBoundedSignal.id);

    const insert = getDatabase().prepare(
      `INSERT INTO absolute_signals (id, profile_id, context_id, user_id, item_id, signal_type, strength, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 'ui', ?)`
    );
    for (let index = 0; index < 110; index += 1) {
      insert.run(
        `signal_history_${String(index).padStart(3, "0")}`,
        base.profile.id,
        isolated.id,
        "user_operator",
        target.id,
        index % 2 === 0 ? "favorite" : "veto",
        new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()
      );
    }
    insert.run(
      "signal_legacy_source",
      base.profile.id,
      isolated.id,
      "user_operator",
      peer.id,
      "favorite",
      "2026-02-01T00:00:00.000Z"
    );
    getDatabase()
      .prepare(`UPDATE absolute_signals SET source = ? WHERE id = ?`)
      .run("legacy-import", "signal_legacy_source");
    const boundedWorkspace = refreshPreferenceWorkspace({
      userId: "user_operator",
      domain: "projects",
      contextId: isolated.id,
      historyLimit: 100
    });
    assert.equal(boundedWorkspace.history.signals.length, 100);
    assert.equal(
      boundedWorkspace.history.signals.some(
        (entry) => entry.id === historyBoundedSignal.id
      ),
      false,
      "bounded history should omit sufficiently old direct marks"
    );
    assert.equal(
      boundedWorkspace.scores.find(
        (score) => score.itemId === historyBoundedItem.id
      )?.effectiveSignal?.id,
      historyBoundedSignal.id,
      "each returned score must include its exact effective direct mark independently of history pagination"
    );
    assert.equal(
      boundedWorkspace.history.signals.find(
        (entry) => entry.id === "signal_legacy_source"
      )?.source,
      "legacy-import",
      "historical provider-specific source labels must remain readable"
    );
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT user_id
             FROM entity_owners
             WHERE entity_type = 'preference_signal' AND entity_id = ?`
          )
          .get("signal_legacy_source") as { user_id: string }
      ).user_id,
      "user_operator",
      "reading a legacy profile must backfill canonical signal ownership"
    );

    const disposableContext = createPreferenceContext({
      userId: "user_operator",
      domain: "projects",
      name: "Disposable signal context",
      description: "",
      shareMode: "isolated",
      active: true,
      isDefault: false,
      decayDays: 90
    });
    const disposableSignal = submitAbsoluteSignal({
      userId: "user_operator",
      domain: "projects",
      contextId: disposableContext.id,
      itemId: peer.id,
      signalType: "bookmark",
      strength: 1
    });
    deletePreferenceContext(disposableContext.id);
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT COUNT(*) AS count
             FROM entity_owners
             WHERE entity_type = 'preference_signal' AND entity_id = ?`
          )
          .get(disposableSignal.id) as { count: number }
      ).count,
      0,
      "deleting a context must not leave signal ownership rows orphaned"
    );
  } finally {
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test(
  "concurrent identical preference signals converge on one row",
  { timeout: 30_000 },
  async () => {
    const rootDir = await mkdtemp(
      path.join(os.tmpdir(), "forge-pref-signal-concurrency-")
    );
    configureDatabase({ dataRoot: rootDir, seedDemoData: true });
    try {
      await initializeDatabase();
      const workspace = refreshPreferenceWorkspace({
        userId: "user_operator",
        domain: "projects"
      });
      const target = createPreferenceItem(
        itemInput("projects", "Concurrent signal target")
      );
      closeDatabase();
      const input = {
        userId: "user_operator",
        domain: "projects",
        contextId: workspace.selectedContext.id,
        itemId: target.id,
        signalType: "favorite",
        strength: 1
      };
      const script = `
      import { closeDatabase, configureDatabase } from ${JSON.stringify(databaseModuleUrl)};
      import { submitAbsoluteSignal } from ${JSON.stringify(repositoryModuleUrl)};
      configureDatabase({ dataRoot: ${JSON.stringify(rootDir)} });
      process.stdout.write("READY\\n");
      await new Promise((resolve) => process.stdin.once("data", resolve));
      const signal = submitAbsoluteSignal(${JSON.stringify(input)}, { source: "agent", actor: "Concurrent actor" });
      process.stdout.write("RESULT " + signal.id + "\\n");
      closeDatabase();
    `;
      const workers = [0, 1].map(() =>
        spawn(
          process.execPath,
          ["--import", "tsx", "--input-type=module", "--eval", script],
          { cwd: projectRoot, stdio: ["pipe", "pipe", "pipe"] }
        )
      );
      const outputs = await Promise.all(
        workers.map(
          (worker) =>
            new Promise<string>((resolve, reject) => {
              let output = "";
              let error = "";
              worker.stdout.setEncoding("utf8");
              worker.stderr.setEncoding("utf8");
              worker.stdout.on("data", (chunk: string) => {
                output += chunk;
                if (output.includes("READY\n")) {
                  worker.stdin.end("go\n");
                }
              });
              worker.stderr.on("data", (chunk: string) => {
                error += chunk;
              });
              worker.once("error", reject);
              worker.once("close", (code) => {
                if (code !== 0) {
                  reject(new Error(error || output));
                  return;
                }
                resolve(output);
              });
            })
        )
      );
      const ids = outputs.map(
        (output) => output.match(/RESULT (pref_signal_[a-z0-9]+)/)?.[1]
      );
      assert.ok(ids.every(Boolean));
      assert.equal(new Set(ids).size, 1);
      configureDatabase({ dataRoot: rootDir, seedDemoData: true });
      assert.equal(
        (
          getDatabase()
            .prepare(
              `SELECT COUNT(*) AS count FROM absolute_signals WHERE item_id = ?`
            )
            .get(target.id) as { count: number }
        ).count,
        1
      );
    } finally {
      closeDatabase();
      await rm(rootDir, { recursive: true, force: true });
    }
  }
);

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { LlmManager } from "./managers/platform/llm-manager.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import {
  createArtifactFromUpload,
  enrichArtifactWithLlm,
  getArtifactById,
  updateArtifactMetadata
} from "./services/artifacts.js";

test("ART-06 rejects a stale LLM completion without overwriting newer human metadata or evidence", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-art-06-enrichment-precedence-")
  );
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: true,
    devrageMetricSync: false
  });

  try {
    const now = new Date().toISOString();
    getDatabase()
      .prepare(
        `INSERT INTO wiki_llm_profiles (
           id, label, provider, base_url, model, secret_id, system_prompt,
           enabled, metadata_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, NULL, '', 1, '{}', ?, ?)`
      )
      .run(
        "wiki_llm_art_06_precedence",
        "ART-06 precedence profile",
        "mock",
        "http://127.0.0.1.invalid",
        "art-06-precedence-model",
        now,
        now
      );

    let releaseProvider = () => {};
    let markProviderStarted = () => {};
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const providerStarted = new Promise<void>((resolve) => {
      markProviderStarted = resolve;
    });
    const llm = {
      runTextPrompt: async (
        _profile: unknown,
        _input: unknown,
        logger?: (entry: { level: string; message: string }) => void
      ) => {
        logger?.({ level: "info", message: "Provider started enrichment" });
        markProviderStarted();
        await providerGate;
        logger?.({ level: "info", message: "Provider completed enrichment" });
        return {
          outputText: JSON.stringify({
            title: "Stale model title",
            shortDescription: "Stale model summary",
            description: "Stale model description"
          })
        };
      }
    } as unknown as LlmManager;
    const context = {
      source: "ui" as const,
      actor: "ART-06 human operator"
    };
    const created = await createArtifactFromUpload(
      {
        title: "Original title",
        shortDescription: "Original summary",
        description: "Original description",
        originalFileName: "art-06-precedence.txt",
        contentBase64: Buffer.from(
          "ART-06 keeps the newest human metadata.",
          "utf8"
        ).toString("base64")
      },
      context
    );
    const artifactId = created.artifact.id;
    const pendingEnrichment = enrichArtifactWithLlm(
      artifactId,
      {
        llmProfileId: "wiki_llm_art_06_precedence",
        fillMissingOnly: false
      },
      context,
      { llm }
    );

    await providerStarted;
    const humanUpdate = updateArtifactMetadata(
      artifactId,
      {
        title: "Human title written while the provider was running",
        shortDescription: "Human summary written after enrichment started",
        description: "Human description remains authoritative"
      },
      context
    );
    assert.ok(humanUpdate);
    const stateAfterHumanUpdate = getDatabase()
      .prepare(
        `SELECT title, short_description, description,
                enrichment_results_json
         FROM artifacts
         WHERE id = ?`
      )
      .get(artifactId) as {
      title: string;
      short_description: string;
      description: string;
      enrichment_results_json: string;
    };
    const auditsAfterHumanUpdate = getDatabase()
      .prepare(
        `SELECT event_type, metadata_json
         FROM artifact_audit_events
         WHERE artifact_id = ?
         ORDER BY created_at, id`
      )
      .all(artifactId) as Array<{
      event_type: string;
      metadata_json: string;
    }>;

    releaseProvider();
    await assert.rejects(pendingEnrichment, (error: unknown) => {
      assert.equal(
        (error as { code?: string }).code,
        "artifact_enrichment_conflict"
      );
      assert.equal((error as { statusCode?: number }).statusCode, 409);
      return true;
    });

    const current = getArtifactById(artifactId, context);
    assert.ok(current);
    assert.deepEqual(
      {
        title: current.title,
        shortDescription: current.shortDescription,
        description: current.description
      },
      {
        title: stateAfterHumanUpdate.title,
        shortDescription: stateAfterHumanUpdate.short_description,
        description: stateAfterHumanUpdate.description
      }
    );
    const stateAfterConflict = getDatabase()
      .prepare(
        `SELECT title, short_description, description,
                enrichment_results_json
         FROM artifacts
         WHERE id = ?`
      )
      .get(artifactId) as typeof stateAfterHumanUpdate;
    assert.deepEqual({ ...stateAfterConflict }, { ...stateAfterHumanUpdate });
    const auditsAfterConflict = getDatabase()
      .prepare(
        `SELECT event_type, metadata_json
         FROM artifact_audit_events
         WHERE artifact_id = ?
         ORDER BY created_at, id`
      )
      .all(artifactId) as typeof auditsAfterHumanUpdate;
    assert.deepEqual(auditsAfterConflict, auditsAfterHumanUpdate);
    assert.equal(
      auditsAfterConflict.some(
        (entry) => entry.event_type === "artifact.enriched_with_llm"
      ),
      false
    );
    assert.equal(
      auditsAfterConflict.some(
        (entry) => entry.event_type === "artifact.enrichment_failed"
      ),
      false
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("ART-06 admits one enrichment winner and returns a stable route conflict without loser audit evidence", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-art-06-competing-enrichment-")
  );
  const originalRunTextPrompt = LlmManager.prototype.runTextPrompt;
  let releaseLosingProvider = () => {};
  let markLosingProviderStarted = () => {};
  const losingProviderGate = new Promise<void>((resolve) => {
    releaseLosingProvider = resolve;
  });
  const losingProviderStarted = new Promise<void>((resolve) => {
    markLosingProviderStarted = resolve;
  });
  LlmManager.prototype.runTextPrompt = async function (
    _profile,
    _input,
    logger
  ) {
    logger?.({ level: "info", message: "Losing provider started" });
    markLosingProviderStarted();
    await losingProviderGate;
    logger?.({ level: "info", message: "Losing provider completed" });
    return {
      outputText: JSON.stringify({ title: "Losing model title" })
    };
  };
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: true,
    devrageMetricSync: false
  });

  try {
    const now = new Date().toISOString();
    getDatabase()
      .prepare(
        `INSERT INTO wiki_llm_profiles (
           id, label, provider, base_url, model, secret_id, system_prompt,
           enabled, metadata_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, NULL, '', 1, '{}', ?, ?)`
      )
      .run(
        "wiki_llm_art_06_competing",
        "ART-06 competing profile",
        "mock",
        "http://127.0.0.1.invalid",
        "art-06-competing-model",
        now,
        now
      );
    const context = {
      source: "ui" as const,
      actor: "ART-06 human operator"
    };
    const created = await createArtifactFromUpload(
      {
        title: "Original competing title",
        originalFileName: "art-06-competing.txt",
        contentBase64: Buffer.from(
          "ART-06 admits one enrichment winner.",
          "utf8"
        ).toString("base64")
      },
      context
    );
    const artifactId = created.artifact.id;
    const cookie = issueTestOperatorSessionCookie(app);
    const losingRequest = app.inject({
      method: "POST",
      url: `/api/v1/artifacts/${artifactId}/enrich`,
      headers: { cookie },
      payload: {
        llmProfileId: "wiki_llm_art_06_competing",
        fillMissingOnly: false
      }
    });
    await losingProviderStarted;

    let releaseWinningProvider = () => {};
    let markWinningProviderStarted = () => {};
    const winningProviderGate = new Promise<void>((resolve) => {
      releaseWinningProvider = resolve;
    });
    const winningProviderStarted = new Promise<void>((resolve) => {
      markWinningProviderStarted = resolve;
    });
    const winningLlm = {
      runTextPrompt: async (
        _profile: unknown,
        _input: unknown,
        logger?: (entry: { level: string; message: string }) => void
      ) => {
        logger?.({ level: "info", message: "Winning provider started" });
        markWinningProviderStarted();
        await winningProviderGate;
        logger?.({ level: "info", message: "Winning provider completed" });
        return {
          outputText: JSON.stringify({
            title: "Winning model title",
            shortDescription: "Winning model summary"
          })
        };
      }
    } as unknown as LlmManager;
    const winningEnrichment = enrichArtifactWithLlm(
      artifactId,
      {
        llmProfileId: "wiki_llm_art_06_competing",
        fillMissingOnly: false
      },
      context,
      { llm: winningLlm }
    );
    await winningProviderStarted;
    releaseWinningProvider();
    const winner = await winningEnrichment;
    assert.equal(winner?.title, "Winning model title");
    assert.equal(winner?.shortDescription, "Winning model summary");

    const winnerState = getDatabase()
      .prepare(
        `SELECT title, short_description, description,
                enrichment_results_json
         FROM artifacts
         WHERE id = ?`
      )
      .get(artifactId) as {
      title: string;
      short_description: string;
      description: string;
      enrichment_results_json: string;
    };
    assert.equal(
      JSON.parse(winnerState.enrichment_results_json).status,
      "completed"
    );
    const winnerArtifactAudits = getDatabase()
      .prepare(
        `SELECT id, event_type, metadata_json, created_at
         FROM artifact_audit_events
         WHERE artifact_id = ?
         ORDER BY created_at, id`
      )
      .all(artifactId);
    const winnerEventLog = getDatabase()
      .prepare(
        `SELECT id, event_kind, metadata_json, created_at
         FROM event_log
         WHERE entity_type = 'artifact' AND entity_id = ?
         ORDER BY created_at, id`
      )
      .all(artifactId);

    releaseLosingProvider();
    const losingResponse = await losingRequest;
    assert.equal(losingResponse.statusCode, 409, losingResponse.body);
    assert.equal(
      (losingResponse.json() as { code?: string }).code,
      "artifact_enrichment_conflict"
    );
    const stateAfterConflict = getDatabase()
      .prepare(
        `SELECT title, short_description, description,
                enrichment_results_json
         FROM artifacts
         WHERE id = ?`
      )
      .get(artifactId) as typeof winnerState;
    assert.deepEqual({ ...stateAfterConflict }, { ...winnerState });
    assert.deepEqual(
      getDatabase()
        .prepare(
          `SELECT id, event_type, metadata_json, created_at
           FROM artifact_audit_events
           WHERE artifact_id = ?
           ORDER BY created_at, id`
        )
        .all(artifactId),
      winnerArtifactAudits
    );
    assert.deepEqual(
      getDatabase()
        .prepare(
          `SELECT id, event_kind, metadata_json, created_at
           FROM event_log
           WHERE entity_type = 'artifact' AND entity_id = ?
           ORDER BY created_at, id`
        )
        .all(artifactId),
      winnerEventLog
    );
  } finally {
    LlmManager.prototype.runTextPrompt = originalRunTextPrompt;
    releaseLosingProvider();
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("ART-06 commits sanitized provider diagnostics atomically with a genuine enrichment failure", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-art-06-provider-failure-")
  );
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: true,
    devrageMetricSync: false
  });

  try {
    const now = new Date().toISOString();
    getDatabase()
      .prepare(
        `INSERT INTO wiki_llm_profiles (
           id, label, provider, base_url, model, secret_id, system_prompt,
           enabled, metadata_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, NULL, '', 1, '{}', ?, ?)`
      )
      .run(
        "wiki_llm_art_06_failure",
        "ART-06 failure profile",
        "mock",
        "http://127.0.0.1.invalid",
        "art-06-failure-model",
        now,
        now
      );
    const context = {
      source: "ui" as const,
      actor: "ART-06 human operator"
    };
    const created = await createArtifactFromUpload(
      {
        title: "Provider failure fixture",
        originalFileName: "art-06-provider-failure.txt",
        contentBase64: Buffer.from(
          "ART-06 stores only sanitized provider diagnostics.",
          "utf8"
        ).toString("base64")
      },
      context
    );
    const artifactId = created.artifact.id;
    const privateProviderMessage = "private provider detail 94631";
    const failingLlm = {
      runTextPrompt: async (
        _profile: unknown,
        _input: unknown,
        logger?: (entry: { level: string; message: string }) => void
      ) => {
        logger?.({ level: "warning", message: privateProviderMessage });
        throw new Error(privateProviderMessage);
      }
    } as unknown as LlmManager;

    await assert.rejects(
      enrichArtifactWithLlm(
        artifactId,
        { llmProfileId: "wiki_llm_art_06_failure" },
        context,
        { llm: failingLlm }
      ),
      (error: unknown) => {
        assert.equal((error as Error).message, privateProviderMessage);
        return true;
      }
    );

    const enrichmentState = getDatabase()
      .prepare(
        `SELECT enrichment_results_json
         FROM artifacts
         WHERE id = ?`
      )
      .get(artifactId) as { enrichment_results_json: string };
    assert.deepEqual(JSON.parse(enrichmentState.enrichment_results_json), {
      generated: false,
      status: "failed",
      errorCode: "artifact_llm_enrichment_failed",
      generatedAt: (
        JSON.parse(enrichmentState.enrichment_results_json) as {
          generatedAt: string;
        }
      ).generatedAt
    });
    const artifactEvidence = getDatabase()
      .prepare(
        `SELECT event_type, metadata_json
         FROM artifact_audit_events
         WHERE artifact_id = ?
           AND event_type IN (
             'artifact.enrichment_log',
             'artifact.enrichment_failed'
           )
         ORDER BY rowid`
      )
      .all(artifactId) as Array<{
      event_type: string;
      metadata_json: string;
    }>;
    assert.deepEqual(
      artifactEvidence.map((entry) => ({
        eventType: entry.event_type,
        metadata: JSON.parse(entry.metadata_json)
      })),
      [
        {
          eventType: "artifact.enrichment_log",
          metadata: {
            level: "warning",
            messageAvailable: true,
            messagePersisted: false
          }
        },
        {
          eventType: "artifact.enrichment_failed",
          metadata: { errorCode: "artifact_llm_enrichment_failed" }
        }
      ]
    );
    const generalEvidence = getDatabase()
      .prepare(
        `SELECT event_kind, metadata_json
         FROM event_log
         WHERE entity_type = 'artifact' AND entity_id = ?
           AND event_kind IN (
             'artifact.enrichment_log',
             'artifact.enrichment_failed'
           )
         ORDER BY rowid`
      )
      .all(artifactId) as Array<{
      event_kind: string;
      metadata_json: string;
    }>;
    assert.deepEqual(
      generalEvidence.map((entry) => ({
        eventKind: entry.event_kind,
        metadata: JSON.parse(entry.metadata_json)
      })),
      [
        {
          eventKind: "artifact.enrichment_log",
          metadata: {
            level: "warning",
            messageAvailable: true,
            messagePersisted: false
          }
        },
        {
          eventKind: "artifact.enrichment_failed",
          metadata: { errorCode: "artifact_llm_enrichment_failed" }
        }
      ]
    );
    assert.equal(
      JSON.stringify({
        enrichmentState,
        artifactEvidence,
        generalEvidence
      }).includes(privateProviderMessage),
      false
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

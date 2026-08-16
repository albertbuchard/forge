import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { purgeExpiredAgentMessages } from "./agent-messages/repository.js";
import { verifyAgentMessageMedia } from "./agent-messages/media.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";

const messageScopes = [
  "agentMessages.poll",
  "agentMessages.claim",
  "agentMessages.progress",
  "agentMessages.complete",
  "agentMessages.forward",
  "agentMessages.voice.read"
];

function wavFixture(seconds = 1) {
  const sampleRate = 8_000;
  const dataSize = Math.round(seconds * sampleRate);
  const bytes = Buffer.alloc(44 + dataSize, 128);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(36 + dataSize, 4);
  bytes.write("WAVE", 8, "ascii");
  bytes.write("fmt ", 12, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate, 28);
  bytes.writeUInt16LE(1, 32);
  bytes.writeUInt16LE(8, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(dataSize, 40);
  return bytes;
}

async function issueMessageAgent(input: {
  app: Awaited<ReturnType<typeof buildServer>>;
  cookie: string;
  label: string;
}) {
  const response = await input.app.inject({
    method: "POST",
    url: "/api/v1/settings/tokens",
    headers: { cookie: input.cookie },
    payload: {
      label: `${input.label} token`,
      agentLabel: input.label,
      agentType: "assistant",
      scopes: messageScopes,
      scopePolicy: {
        userIds: ["user_operator"],
        projectIds: [],
        tagIds: []
      }
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  const body = response.json() as {
    token: { token: string; tokenSummary: { agentId: string | null } };
  };
  const agentId = body.token.tokenSummary.agentId;
  assert.ok(agentId);
  const at = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT OR IGNORE INTO agent_identity_users (
         agent_id, user_id, role, created_at, updated_at
       ) VALUES (?, 'user_operator', 'primary', ?, ?)`
    )
    .run(agentId, at, at);
  return { agentId, token: body.token.token };
}

async function createVoiceMessage(input: {
  app: Awaited<ReturnType<typeof buildServer>>;
  cookie: string;
  agentId?: string;
  key: string;
}) {
  const voice = wavFixture();
  const reservation = await input.app.inject({
    method: "POST",
    url: "/api/v1/agent-messages/voice-reservations",
    headers: { cookie: input.cookie },
    payload: {
      idempotencyKey: `${input.key}-voice`,
      originalFileName: "original-voice.wav",
      declaredMimeType: "audio/wav",
      declaredDurationMs: 1_000
    }
  });
  assert.equal(reservation.statusCode, 201, reservation.body);
  const reservationId = (reservation.json() as { reservation: { id: string } })
    .reservation.id;
  const activation = await input.app.inject({
    method: "PUT",
    url: `/api/v1/agent-messages/voice-reservations/${reservationId}`,
    headers: { cookie: input.cookie },
    payload: {
      idempotencyKey: `${input.key}-voice`,
      contentBase64: voice.toString("base64"),
      declaredMimeType: "audio/wav",
      declaredDurationMs: 1_000
    }
  });
  assert.equal(activation.statusCode, 200, activation.body);
  const creation = await input.app.inject({
    method: "POST",
    url: "/api/v1/agent-messages",
    headers: { cookie: input.cookie },
    payload: {
      idempotencyKey: `${input.key}-message`,
      recipientAgentId: input.agentId,
      bodyText: "Please inspect the attached voice note.",
      voiceReservationId: reservationId
    }
  });
  assert.equal(creation.statusCode, 201, creation.body);
  const message = (creation.json() as {
    message: { id: string; voiceArtifact: { id: string } };
  }).message;
  return { message, reservationId, voice };
}

test("Agent Messages provides retry-safe claim, leased voice, unread activity, and terminal receipts", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-agent-messages-api-"));
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: true,
    devrageMetricSync: false
  });
  try {
    const cookie = issueTestOperatorSessionCookie(app);
    const primary = await issueMessageAgent({ app, cookie, label: "Mailbox primary" });
    const other = await issueMessageAgent({ app, cookie, label: "Mailbox other" });
    const defaultResponse = await app.inject({
      method: "PATCH",
      url: "/api/v1/agent-messages/settings",
      headers: { cookie },
      payload: { defaultAgentId: primary.agentId }
    });
    assert.equal(defaultResponse.statusCode, 200, defaultResponse.body);

    const created = await createVoiceMessage({
      app,
      cookie,
      key: "agent-message-contract"
    });
    const messageId = created.message.id;
    assert.equal(
      (getDatabase()
        .prepare(
          `SELECT COUNT(*) AS count FROM entity_links
           WHERE source_entity_type = 'artifact' AND source_entity_id = ?
             AND target_entity_type = 'agent_message' AND target_entity_id = ?
             AND relationship = 'original_voice'`
        )
        .get(created.message.voiceArtifact.id, messageId) as { count: number }).count,
      1
    );

    const createReplay = await app.inject({
      method: "POST",
      url: "/api/v1/agent-messages",
      headers: { cookie },
      payload: {
        idempotencyKey: "agent-message-contract-message",
        bodyText: "Please inspect the attached voice note.",
        voiceReservationId: created.reservationId
      }
    });
    assert.equal(createReplay.statusCode, 200, createReplay.body);
    assert.equal((createReplay.json() as { replayed: boolean }).replayed, true);
    const createConflict = await app.inject({
      method: "POST",
      url: "/api/v1/agent-messages",
      headers: { cookie },
      payload: {
        idempotencyKey: "agent-message-contract-message",
        bodyText: "Changed payload"
      }
    });
    assert.equal(createConflict.statusCode, 409, createConflict.body);

    const wrongPoll = await app.inject({
      method: "GET",
      url: "/api/v1/agent-messages/poll?limit=20",
      headers: { authorization: `Bearer ${other.token}` }
    });
    assert.equal(wrongPoll.statusCode, 200, wrongPoll.body);
    assert.equal((wrongPoll.json() as { items: unknown[] }).items.length, 0);

    const claims = await Promise.all(
      [
        { operationKey: "claim-poller-one", leaseSecret: "a".repeat(43) },
        { operationKey: "claim-poller-two", leaseSecret: "b".repeat(43) }
      ].map((payload) =>
        app.inject({
          method: "POST",
          url: `/api/v1/agent-messages/${messageId}/claim`,
          headers: { authorization: `Bearer ${primary.token}` },
          payload: { ...payload, leaseSeconds: 300 }
        })
      )
    );
    const winner = claims.find((response) => response.statusCode === 200);
    const loser = claims.find((response) => response.statusCode === 409);
    assert.ok(winner);
    assert.ok(loser);
    const winnerIndex = claims.indexOf(winner);
    const winningSecret = winnerIndex === 0 ? "a".repeat(43) : "b".repeat(43);
    const winningOperation = winnerIndex === 0 ? "claim-poller-one" : "claim-poller-two";
    const claim = winner.json() as { claimGeneration: number };
    const claimReplay = await app.inject({
      method: "POST",
      url: `/api/v1/agent-messages/${messageId}/claim`,
      headers: { authorization: `Bearer ${primary.token}` },
      payload: {
        operationKey: winningOperation,
        leaseSecret: winningSecret,
        leaseSeconds: 300
      }
    });
    assert.equal(claimReplay.statusCode, 200, claimReplay.body);
    assert.equal((claimReplay.json() as { replayed: boolean }).replayed, true);

    const wrongVoice = await app.inject({
      method: "POST",
      url: `/api/v1/agent-messages/${messageId}/voice`,
      headers: { authorization: `Bearer ${other.token}` },
      payload: {
        leaseSecret: winningSecret,
        claimGeneration: claim.claimGeneration
      }
    });
    assert.equal(wrongVoice.statusCode, 404, wrongVoice.body);
    assert.equal(wrongVoice.body.includes(created.voice.toString("base64")), false);

    const voice = await app.inject({
      method: "POST",
      url: `/api/v1/agent-messages/${messageId}/voice`,
      headers: { authorization: `Bearer ${primary.token}` },
      payload: {
        leaseSecret: winningSecret,
        claimGeneration: claim.claimGeneration
      }
    });
    assert.equal(voice.statusCode, 200, voice.body);
    assert.deepEqual(voice.rawPayload, created.voice);
    assert.equal(voice.headers["cache-control"], "private, no-store");

    const progressPayload = {
      operationKey: "message-progress-one",
      leaseSecret: winningSecret,
      claimGeneration: claim.claimGeneration,
      progressSummary: "Inspecting the original voice Artifact."
    };
    const progress = await app.inject({
      method: "POST",
      url: `/api/v1/agent-messages/${messageId}/progress`,
      headers: { authorization: `Bearer ${primary.token}` },
      payload: progressPayload
    });
    assert.equal(progress.statusCode, 200, progress.body);
    const progressReplay = await app.inject({
      method: "POST",
      url: `/api/v1/agent-messages/${messageId}/progress`,
      headers: { authorization: `Bearer ${primary.token}` },
      payload: progressPayload
    });
    assert.equal(progressReplay.statusCode, 200, progressReplay.body);
    assert.equal((progressReplay.json() as { replayed: boolean }).replayed, true);
    const changedProgress = await app.inject({
      method: "POST",
      url: `/api/v1/agent-messages/${messageId}/progress`,
      headers: { authorization: `Bearer ${primary.token}` },
      payload: { ...progressPayload, progressSummary: "Changed progress" }
    });
    assert.equal(changedProgress.statusCode, 409, changedProgress.body);

    const inbox = await app.inject({
      method: "GET",
      url: "/api/v1/agent-messages?box=inbox&limit=20&offset=0",
      headers: { cookie }
    });
    assert.equal(inbox.statusCode, 200, inbox.body);
    const inboxBody = inbox.json() as {
      unreadThreadCount: number;
      items: Array<{ id: string; unreadInboxEventSequence: number }>;
    };
    assert.equal(inboxBody.unreadThreadCount, 1);
    const unread = inboxBody.items.find((message) => message.id === messageId);
    assert.ok(unread);
    const markRead = await app.inject({
      method: "POST",
      url: `/api/v1/agent-messages/${messageId}/read`,
      headers: { cookie },
      payload: {
        operationKey: "message-mark-read-one",
        expectedInboxEventSequence: unread.unreadInboxEventSequence
      }
    });
    assert.equal(markRead.statusCode, 200, markRead.body);

    const terminalPayload = {
      operationKey: "message-handle-one",
      receiptKey: "message-terminal-one",
      leaseSecret: winningSecret,
      claimGeneration: claim.claimGeneration,
      resultMarkdown: "The requested work is complete.",
      transcriptText: "",
      transcriptProvider: "",
      transcriptDisclosure: ""
    };
    const handled = await app.inject({
      method: "POST",
      url: `/api/v1/agent-messages/${messageId}/handle`,
      headers: { authorization: `Bearer ${primary.token}` },
      payload: terminalPayload
    });
    assert.equal(handled.statusCode, 200, handled.body);
    const handledReplay = await app.inject({
      method: "POST",
      url: `/api/v1/agent-messages/${messageId}/handle`,
      headers: { authorization: `Bearer ${primary.token}` },
      payload: terminalPayload
    });
    assert.equal(handledReplay.statusCode, 200, handledReplay.body);
    assert.equal((handledReplay.json() as { replayed: boolean }).replayed, true);
    const terminalConflict = await app.inject({
      method: "POST",
      url: `/api/v1/agent-messages/${messageId}/handle`,
      headers: { authorization: `Bearer ${primary.token}` },
      payload: { ...terminalPayload, resultMarkdown: "Different result" }
    });
    assert.equal(terminalConflict.statusCode, 409, terminalConflict.body);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("owner reassignment revokes the exact live lease and expired work is no longer claimable", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-agent-messages-reassign-"));
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: true,
    devrageMetricSync: false
  });
  try {
    const cookie = issueTestOperatorSessionCookie(app);
    const original = await issueMessageAgent({ app, cookie, label: "Original recipient" });
    const replacement = await issueMessageAgent({ app, cookie, label: "Replacement recipient" });
    const creation = await app.inject({
      method: "POST",
      url: "/api/v1/agent-messages",
      headers: { cookie },
      payload: {
        idempotencyKey: "reassign-contract-message",
        recipientAgentId: original.agentId,
        bodyText: "Reassign this safely."
      }
    });
    assert.equal(creation.statusCode, 201, creation.body);
    const created = (creation.json() as {
      message: { id: string; revision: number };
    }).message;
    const leaseSecret = "d".repeat(43);
    const claimResponse = await app.inject({
      method: "POST",
      url: `/api/v1/agent-messages/${created.id}/claim`,
      headers: { authorization: `Bearer ${original.token}` },
      payload: {
        operationKey: "reassign-original-claim",
        leaseSecret,
        leaseSeconds: 300
      }
    });
    assert.equal(claimResponse.statusCode, 200, claimResponse.body);
    const claim = claimResponse.json() as {
      revision: number;
      claimGeneration: number;
    };

    const withoutRevocation = await app.inject({
      method: "POST",
      url: `/api/v1/agent-messages/${created.id}/reassign`,
      headers: { cookie },
      payload: {
        operationKey: "reassign-without-revoke",
        expectedRevision: claim.revision,
        recipientAgentId: replacement.agentId,
        revokeActiveLease: false,
        reason: "The replacement agent owns this work."
      }
    });
    assert.equal(withoutRevocation.statusCode, 409, withoutRevocation.body);
    assert.equal(withoutRevocation.json().code, "agent_message_live_lease");

    const staleRevision = await app.inject({
      method: "POST",
      url: `/api/v1/agent-messages/${created.id}/reassign`,
      headers: { cookie },
      payload: {
        operationKey: "reassign-stale-revision",
        expectedRevision: created.revision,
        recipientAgentId: replacement.agentId,
        revokeActiveLease: true,
        reason: "The replacement agent owns this work."
      }
    });
    assert.equal(staleRevision.statusCode, 409, staleRevision.body);
    assert.equal(staleRevision.json().code, "agent_message_revision_conflict");

    const reassignPayload = {
      operationKey: "reassign-live-lease",
      expectedRevision: claim.revision,
      recipientAgentId: replacement.agentId,
      revokeActiveLease: true,
      reason: "The replacement agent owns this work."
    };
    const reassigned = await app.inject({
      method: "POST",
      url: `/api/v1/agent-messages/${created.id}/reassign`,
      headers: { cookie },
      payload: reassignPayload
    });
    assert.equal(reassigned.statusCode, 200, reassigned.body);
    const reassignedBody = reassigned.json() as {
      revision: number;
      claimGeneration: number;
      replayed: boolean;
      recipient: { agentId: string };
    };
    assert.equal(reassignedBody.recipient.agentId, replacement.agentId);
    assert.equal(reassignedBody.claimGeneration, claim.claimGeneration + 1);
    assert.equal(reassignedBody.replayed, false);
    const reassignReplay = await app.inject({
      method: "POST",
      url: `/api/v1/agent-messages/${created.id}/reassign`,
      headers: { cookie },
      payload: reassignPayload
    });
    assert.equal(reassignReplay.statusCode, 200, reassignReplay.body);
    assert.equal((reassignReplay.json() as { replayed: boolean }).replayed, true);

    const revokedWorker = await app.inject({
      method: "POST",
      url: `/api/v1/agent-messages/${created.id}/progress`,
      headers: { authorization: `Bearer ${original.token}` },
      payload: {
        operationKey: "revoked-worker-progress",
        leaseSecret,
        claimGeneration: claim.claimGeneration,
        progressSummary: "This stale worker must not mutate the message."
      }
    });
    assert.equal(revokedWorker.statusCode, 404, revokedWorker.body);

    const replacementPoll = await app.inject({
      method: "GET",
      url: "/api/v1/agent-messages/poll?limit=20",
      headers: { authorization: `Bearer ${replacement.token}` }
    });
    assert.equal(replacementPoll.statusCode, 200, replacementPoll.body);
    assert.deepEqual(
      (replacementPoll.json() as { items: Array<{ id: string }> }).items.map(
        (message) => message.id
      ),
      [created.id]
    );
    const replacementClaim = await app.inject({
      method: "POST",
      url: `/api/v1/agent-messages/${created.id}/claim`,
      headers: { authorization: `Bearer ${replacement.token}` },
      payload: {
        operationKey: "replacement-agent-claim",
        leaseSecret: "e".repeat(43),
        leaseSeconds: 300
      }
    });
    assert.equal(replacementClaim.statusCode, 200, replacementClaim.body);

    getDatabase()
      .prepare("UPDATE agent_messages SET retention_until = ? WHERE id = ?")
      .run(new Date(Date.now() - 60_000).toISOString(), created.id);
    const expiredDetail = await app.inject({
      method: "GET",
      url: `/api/v1/agent-messages/${created.id}/detail`,
      headers: { authorization: `Bearer ${replacement.token}` }
    });
    assert.equal(expiredDetail.statusCode, 404, expiredDetail.body);
    const expiredClaim = await app.inject({
      method: "POST",
      url: `/api/v1/agent-messages/${created.id}/claim`,
      headers: { authorization: `Bearer ${replacement.token}` },
      payload: {
        operationKey: "expired-agent-claim",
        leaseSecret: "f".repeat(43),
        leaseSeconds: 300
      }
    });
    assert.equal(expiredClaim.statusCode, 404, expiredClaim.body);
    const ownerList = await app.inject({
      method: "GET",
      url: "/api/v1/agent-messages?box=inbox&limit=20&offset=0",
      headers: { cookie }
    });
    assert.equal(ownerList.statusCode, 200, ownerList.body);
    assert.ok(
      (getDatabase()
        .prepare("SELECT retention_purged_at FROM agent_messages WHERE id = ?")
        .get(created.id) as { retention_purged_at: string | null })
        .retention_purged_at
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("forwarded voice retention waits for the last message and resumes a failed cleanup on startup", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-agent-messages-retention-"));
  let app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: true,
    devrageMetricSync: false
  });
  try {
    const cookie = issueTestOperatorSessionCookie(app);
    const sourceAgent = await issueMessageAgent({ app, cookie, label: "Retention source" });
    const targetAgent = await issueMessageAgent({ app, cookie, label: "Retention target" });
    const created = await createVoiceMessage({
      app,
      cookie,
      agentId: sourceAgent.agentId,
      key: "retention-contract"
    });
    const sourceId = created.message.id;
    const artifactId = created.message.voiceArtifact.id;
    const storage = getDatabase()
      .prepare("SELECT storage_path FROM artifacts WHERE id = ?")
      .get(artifactId) as { storage_path: string };
    const secret = "c".repeat(43);
    const claimResponse = await app.inject({
      method: "POST",
      url: `/api/v1/agent-messages/${sourceId}/claim`,
      headers: { authorization: `Bearer ${sourceAgent.token}` },
      payload: {
        operationKey: "retention-claim-one",
        leaseSecret: secret,
        leaseSeconds: 300
      }
    });
    assert.equal(claimResponse.statusCode, 200, claimResponse.body);
    const generation = (claimResponse.json() as { claimGeneration: number })
      .claimGeneration;
    const forwarded = await app.inject({
      method: "POST",
      url: `/api/v1/agent-messages/${sourceId}/forward`,
      headers: { authorization: `Bearer ${sourceAgent.token}` },
      payload: {
        operationKey: "retention-forward-operation",
        receiptKey: "retention-forward-receipt",
        leaseSecret: secret,
        claimGeneration: generation,
        recipientAgentId: targetAgent.agentId,
        progressSummary: "Forwarding without duplicating the original voice."
      }
    });
    assert.equal(forwarded.statusCode, 200, forwarded.body);
    const childId = (forwarded.json() as { resultingMessageId: string })
      .resultingMessageId;
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    getDatabase()
      .prepare("UPDATE agent_messages SET retention_until = ? WHERE id = ?")
      .run(past, sourceId);
    getDatabase()
      .prepare("UPDATE agent_messages SET retention_until = ? WHERE id = ?")
      .run(future, childId);

    const sourcePurge = await purgeExpiredAgentMessages({ now: new Date() });
    assert.deepEqual(sourcePurge.purgedMessageIds, [sourceId]);
    assert.equal(
      getDatabase().prepare("SELECT 1 FROM artifacts WHERE id = ?").get(artifactId) !==
        undefined,
      true
    );
    await access(storage.storage_path);
    const sourceTombstone = getDatabase()
      .prepare(
        `SELECT body_text, voice_artifact_id, purged_voice_artifact_id,
                purge_receipt_sha256, retention_purged_at
         FROM agent_messages WHERE id = ?`
      )
      .get(sourceId) as {
      body_text: string;
      voice_artifact_id: string | null;
      purged_voice_artifact_id: string;
      purge_receipt_sha256: string;
      retention_purged_at: string;
    };
    assert.equal(sourceTombstone.body_text, "");
    assert.equal(sourceTombstone.voice_artifact_id, null);
    assert.equal(sourceTombstone.purged_voice_artifact_id, artifactId);
    assert.equal(sourceTombstone.purge_receipt_sha256.length, 64);
    assert.ok(sourceTombstone.retention_purged_at);

    getDatabase()
      .prepare("UPDATE agent_messages SET retention_until = ? WHERE id = ?")
      .run(past, childId);
    const failedCleanup = await purgeExpiredAgentMessages({
      now: new Date(),
      artifactServices: {
        removeArtifactUploadFile: async () => {
          throw Object.assign(new Error("simulated interruption"), {
            code: "agent_message_test_interruption"
          });
        }
      }
    });
    assert.deepEqual(failedCleanup.purgedMessageIds, [childId]);
    assert.equal(failedCleanup.cleanup[0]?.disposition, "pending");
    assert.equal(
      getDatabase().prepare("SELECT 1 FROM artifacts WHERE id = ?").get(artifactId),
      undefined
    );
    assert.equal(
      (
        getDatabase()
          .prepare("SELECT COUNT(*) AS count FROM agent_message_voice_purge_jobs")
          .get() as { count: number }
      ).count,
      1
    );
    await access(storage.storage_path);

    await app.close();
    closeDatabase();
    app = await buildServer({
      dataRoot: rootDir,
      seedDemoData: false,
      devrageMetricSync: false
    });
    assert.equal(
      (
        getDatabase()
          .prepare("SELECT COUNT(*) AS count FROM agent_message_voice_purge_jobs")
          .get() as { count: number }
      ).count,
      0
    );
    await assert.rejects(access(storage.storage_path));
  } finally {
    await app.close().catch(() => undefined);
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("voice verification enforces signature, MIME, duration, size, and exact migration mirrors", async () => {
  const valid = wavFixture();
  const verified = await verifyAgentMessageMedia({
    buffer: valid,
    originalFileName: "voice.wav",
    declaredMimeType: "audio/wav",
    declaredDurationMs: 1_000
  });
  assert.equal(verified.durationMs, 1_000);
  assert.equal(verified.mimeType, "audio/wav");
  assert.equal(verified.parserVersion, "11.14.0");
  await assert.rejects(
    verifyAgentMessageMedia({
      buffer: valid,
      originalFileName: "voice.mp3",
      declaredMimeType: "audio/mpeg",
      declaredDurationMs: 1_000
    }),
    (error: { code?: string }) => error.code === "agent_message_voice_format_invalid"
  );
  await assert.rejects(
    verifyAgentMessageMedia({
      buffer: valid.subarray(0, 20),
      originalFileName: "voice.wav",
      declaredMimeType: "audio/wav",
      declaredDurationMs: 1_000
    }),
    (error: { code?: string }) =>
      error.code === "agent_message_voice_unverifiable" ||
      error.code === "agent_message_voice_duration_unverifiable"
  );
  const overlong = wavFixture(601);
  await assert.rejects(
    verifyAgentMessageMedia({
      buffer: overlong,
      originalFileName: "voice.wav",
      declaredMimeType: "audio/wav",
      declaredDurationMs: 600_000
    }),
    (error: { code?: string }) => error.code === "agent_message_voice_duration_exceeded"
  );

  const canonical = await readFile(
    path.resolve("apps/api/migrations/136_agent_messages.sql")
  );
  const codex = await readFile(
    path.resolve("plugins/codex/runtime/server/migrations/136_agent_messages.sql")
  );
  const hermes = await readFile(
    path.resolve(
      "plugins/hermes/forge_hermes/runtime/apps/api/migrations/136_agent_messages.sql"
    )
  );
  assert.deepEqual(codex, canonical);
  assert.deepEqual(hermes, canonical);
});

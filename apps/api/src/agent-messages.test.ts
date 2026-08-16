import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { purgeExpiredAgentMessages } from "./agent-messages/repository.js";
import {
  isAllowedAgentMessageCodec,
  verifyAgentMessageMedia
} from "./agent-messages/media.js";
import { AGENT_MESSAGE_MAX_VOICE_BYTES } from "./agent-messages/types.js";
import { agentMessageEncodedMediaFixtures } from "./agent-messages-media-fixtures.test-data.js";
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
  ownerUserIds?: string[];
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
        userIds: input.ownerUserIds ?? ["user_operator"],
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
       ) VALUES (?, ?, 'primary', ?, ?)`
    )
    .run(agentId, (input.ownerUserIds ?? ["user_operator"])[0], at, at);
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
  const message = (
    creation.json() as {
      message: { id: string; voiceArtifact: { id: string } };
    }
  ).message;
  return { message, reservationId, voice };
}

test("Agent Messages provides retry-safe claim, leased voice, unread activity, and terminal receipts", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-agent-messages-api-")
  );
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: true,
    devrageMetricSync: false
  });
  try {
    const cookie = issueTestOperatorSessionCookie(app);
    const primary = await issueMessageAgent({
      app,
      cookie,
      label: "Mailbox primary"
    });
    const other = await issueMessageAgent({
      app,
      cookie,
      label: "Mailbox other"
    });
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
      (
        getDatabase()
          .prepare(
            `SELECT COUNT(*) AS count FROM entity_links
           WHERE source_entity_type = 'artifact' AND source_entity_id = ?
             AND target_entity_type = 'agent_message' AND target_entity_id = ?
             AND relationship = 'original_voice'`
          )
          .get(created.message.voiceArtifact.id, messageId) as { count: number }
      ).count,
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
    const winningOperation =
      winnerIndex === 0 ? "claim-poller-one" : "claim-poller-two";
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
    assert.equal(
      wrongVoice.body.includes(created.voice.toString("base64")),
      false
    );

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
    assert.equal(
      (progressReplay.json() as { replayed: boolean }).replayed,
      true
    );
    const changedProgress = await app.inject({
      method: "POST",
      url: `/api/v1/agent-messages/${messageId}/progress`,
      headers: { authorization: `Bearer ${primary.token}` },
      payload: { ...progressPayload, progressSummary: "Changed progress" }
    });
    assert.equal(changedProgress.statusCode, 409, changedProgress.body);

    const inbox = await app.inject({
      method: "GET",
      url: "/api/v1/agent-messages?box=inbox&limit=20",
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
    assert.equal(
      (handledReplay.json() as { replayed: boolean }).replayed,
      true
    );
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
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-agent-messages-reassign-")
  );
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: true,
    devrageMetricSync: false
  });
  try {
    const cookie = issueTestOperatorSessionCookie(app);
    const original = await issueMessageAgent({
      app,
      cookie,
      label: "Original recipient"
    });
    const replacement = await issueMessageAgent({
      app,
      cookie,
      label: "Replacement recipient"
    });
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
    const created = (
      creation.json() as {
        message: { id: string; revision: number };
      }
    ).message;
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
    assert.equal(
      (reassignReplay.json() as { replayed: boolean }).replayed,
      true
    );

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
      url: "/api/v1/agent-messages?box=inbox&limit=20",
      headers: { cookie }
    });
    assert.equal(ownerList.statusCode, 200, ownerList.body);
    assert.ok(
      (
        getDatabase()
          .prepare(
            "SELECT retention_purged_at FROM agent_messages WHERE id = ?"
          )
          .get(created.id) as { retention_purged_at: string | null }
      ).retention_purged_at
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("agent owner scope and replay receipts cannot be used as bearer capabilities", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-agent-messages-scope-")
  );
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: true,
    devrageMetricSync: false
  });
  try {
    const cookie = issueTestOperatorSessionCookie(app);
    const scoped = await issueMessageAgent({
      app,
      cookie,
      label: "Shared stable mailbox agent"
    });
    const at = new Date().toISOString();
    getDatabase()
      .prepare(
        `INSERT INTO users (
           id, kind, handle, display_name, description, accent_color,
           created_at, updated_at
         ) VALUES ('user_agent_messages_other', 'human',
           'agent-messages-other', 'Other mailbox owner', '', '#000000', ?, ?)`
      )
      .run(at, at);
    const otherOwner = await issueMessageAgent({
      app,
      cookie,
      label: "Shared stable mailbox agent",
      ownerUserIds: ["user_agent_messages_other"]
    });
    assert.equal(otherOwner.agentId, scoped.agentId);

    const creation = await app.inject({
      method: "POST",
      url: "/api/v1/agent-messages",
      headers: { cookie },
      payload: {
        idempotencyKey: "scope-owner-message-one",
        recipientAgentId: scoped.agentId,
        bodyText: "This message belongs to the second owner."
      }
    });
    assert.equal(creation.statusCode, 201, creation.body);
    const messageId = (creation.json() as { message: { id: string } }).message
      .id;
    getDatabase()
      .prepare(
        `UPDATE agent_messages
         SET owner_user_id = 'user_agent_messages_other',
             sender_user_id = 'user_agent_messages_other'
         WHERE id = ?`
      )
      .run(messageId);

    const excludedClaim = await app.inject({
      method: "POST",
      url: `/api/v1/agent-messages/${messageId}/claim`,
      headers: { authorization: `Bearer ${scoped.token}` },
      payload: {
        operationKey: "scope-excluded-claim",
        leaseSecret: "s".repeat(43),
        leaseSeconds: 300
      }
    });
    assert.equal(excludedClaim.statusCode, 404, excludedClaim.body);

    const leaseSecret = "o".repeat(43);
    const claimPayload = {
      operationKey: "scope-authorized-claim",
      leaseSecret,
      leaseSeconds: 300
    };
    const claimResponse = await app.inject({
      method: "POST",
      url: `/api/v1/agent-messages/${messageId}/claim`,
      headers: { authorization: `Bearer ${otherOwner.token}` },
      payload: claimPayload
    });
    assert.equal(claimResponse.statusCode, 200, claimResponse.body);
    const generation = (claimResponse.json() as { claimGeneration: number })
      .claimGeneration;
    const progressPayload = {
      operationKey: "scope-progress-receipt",
      leaseSecret,
      claimGeneration: generation,
      progressSummary: "Authorized progress."
    };
    const progress = await app.inject({
      method: "POST",
      url: `/api/v1/agent-messages/${messageId}/progress`,
      headers: { authorization: `Bearer ${otherOwner.token}` },
      payload: progressPayload
    });
    assert.equal(progress.statusCode, 200, progress.body);

    getDatabase()
      .prepare("UPDATE agent_messages SET claim_expires_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 1_000).toISOString(), messageId);
    const exactReplayAfterExpiry = await app.inject({
      method: "POST",
      url: `/api/v1/agent-messages/${messageId}/progress`,
      headers: { authorization: `Bearer ${otherOwner.token}` },
      payload: progressPayload
    });
    assert.equal(
      exactReplayAfterExpiry.statusCode,
      200,
      exactReplayAfterExpiry.body
    );
    assert.equal(exactReplayAfterExpiry.json().replayed, true);

    const excludedReceiptReplay = await app.inject({
      method: "POST",
      url: `/api/v1/agent-messages/${messageId}/progress`,
      headers: { authorization: `Bearer ${scoped.token}` },
      payload: progressPayload
    });
    assert.equal(
      excludedReceiptReplay.statusCode,
      404,
      excludedReceiptReplay.body
    );
    const newOperationAfterExpiry = await app.inject({
      method: "POST",
      url: `/api/v1/agent-messages/${messageId}/progress`,
      headers: { authorization: `Bearer ${otherOwner.token}` },
      payload: {
        ...progressPayload,
        operationKey: "scope-progress-after-expiry"
      }
    });
    assert.equal(
      newOperationAfterExpiry.statusCode,
      409,
      newOperationAfterExpiry.body
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("provenance is server-owned and multi-hop threads remain complete in the outbox", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-agent-messages-thread-")
  );
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: true,
    devrageMetricSync: false
  });
  try {
    const cookie = issueTestOperatorSessionCookie(app);
    const first = await issueMessageAgent({
      app,
      cookie,
      label: "Thread first"
    });
    const second = await issueMessageAgent({
      app,
      cookie,
      label: "Thread second"
    });
    const third = await issueMessageAgent({
      app,
      cookie,
      label: "Thread third"
    });
    const forged = await app.inject({
      method: "POST",
      url: "/api/v1/agent-messages",
      headers: { cookie },
      payload: {
        idempotencyKey: "forged-provenance-message",
        recipientAgentId: first.agentId,
        bodyText: "A client may not author provenance.",
        forwardedFromMessageId: "amsg_forged"
      }
    });
    assert.equal(forged.statusCode, 400, forged.body);

    const creation = await app.inject({
      method: "POST",
      url: "/api/v1/agent-messages",
      headers: { cookie },
      payload: {
        idempotencyKey: "thread-root-message",
        recipientAgentId: first.agentId,
        bodyText: "Forward this through the connected agent chain."
      }
    });
    assert.equal(creation.statusCode, 201, creation.body);
    const rootId = (creation.json() as { message: { id: string } }).message.id;
    assert.throws(() =>
      getDatabase()
        .prepare(
          `UPDATE agent_messages
           SET forwarded_from_message_id = ?, retried_from_message_id = ?
           WHERE id = ?`
        )
        .run(rootId, rootId, rootId)
    );

    const forward = async (input: {
      messageId: string;
      source: { token: string };
      recipientAgentId: string;
      stem: string;
      secret: string;
    }) => {
      const claimed = await app.inject({
        method: "POST",
        url: `/api/v1/agent-messages/${input.messageId}/claim`,
        headers: { authorization: `Bearer ${input.source.token}` },
        payload: {
          operationKey: `${input.stem}-claim`,
          leaseSecret: input.secret,
          leaseSeconds: 300
        }
      });
      assert.equal(claimed.statusCode, 200, claimed.body);
      const claimGeneration = claimed.json().claimGeneration as number;
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/agent-messages/${input.messageId}/forward`,
        headers: { authorization: `Bearer ${input.source.token}` },
        payload: {
          operationKey: `${input.stem}-forward-operation`,
          receiptKey: `${input.stem}-forward-receipt`,
          leaseSecret: input.secret,
          claimGeneration,
          recipientAgentId: input.recipientAgentId,
          progressSummary: `Forwarded by ${input.stem}.`
        }
      });
      assert.equal(response.statusCode, 200, response.body);
      return response.json().resultingMessageId as string;
    };
    const secondId = await forward({
      messageId: rootId,
      source: first,
      recipientAgentId: second.agentId,
      stem: "thread-first",
      secret: "1".repeat(43)
    });
    const thirdId = await forward({
      messageId: secondId,
      source: second,
      recipientAgentId: third.agentId,
      stem: "thread-second",
      secret: "2".repeat(43)
    });

    const outbox = await app.inject({
      method: "GET",
      url: "/api/v1/agent-messages?box=outbox&limit=20",
      headers: { cookie }
    });
    assert.equal(outbox.statusCode, 200, outbox.body);
    const outboxIds = (outbox.json().items as Array<{ id: string }>).map(
      (message) => message.id
    );
    assert.deepEqual(new Set(outboxIds), new Set([rootId, secondId, thirdId]));
    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/agent-messages/${thirdId}`,
      headers: { cookie }
    });
    assert.equal(detail.statusCode, 200, detail.body);
    assert.deepEqual(
      (detail.json().relatedMessages as Array<{ id: string }>).map(
        (message) => message.id
      ),
      [rootId, secondId, thirdId]
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("opaque mailbox cursors preserve deterministic pages across inserts and updates", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-agent-messages-cursor-")
  );
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: true,
    devrageMetricSync: false
  });
  try {
    const cookie = issueTestOperatorSessionCookie(app);
    const agent = await issueMessageAgent({
      app,
      cookie,
      label: "Cursor agent"
    });
    const ids: string[] = [];
    for (let index = 0; index < 25; index += 1) {
      const creation = await app.inject({
        method: "POST",
        url: "/api/v1/agent-messages",
        headers: { cookie },
        payload: {
          idempotencyKey: `cursor-message-${String(index).padStart(3, "0")}`,
          recipientAgentId: agent.agentId,
          bodyText: `Cursor fixture ${index}`
        }
      });
      assert.equal(creation.statusCode, 201, creation.body);
      ids.push(creation.json().message.id as string);
    }
    getDatabase()
      .prepare(
        `UPDATE agent_messages
         SET created_at = '2026-01-01T00:00:00.000Z',
             updated_at = '2026-01-01T00:00:00.000Z'`
      )
      .run();
    const expected = [...ids].sort().reverse();
    const first = await app.inject({
      method: "GET",
      url: "/api/v1/agent-messages?box=outbox&limit=10",
      headers: { cookie }
    });
    assert.equal(first.statusCode, 200, first.body);
    const firstBody = first.json() as {
      items: Array<{ id: string }>;
      nextCursor: string;
      hasMore: boolean;
    };
    assert.equal(firstBody.hasMore, true);
    assert.deepEqual(
      firstBody.items.map((message) => message.id),
      expected.slice(0, 10)
    );

    const inserted = await app.inject({
      method: "POST",
      url: "/api/v1/agent-messages",
      headers: { cookie },
      payload: {
        idempotencyKey: "cursor-newer-insert",
        recipientAgentId: agent.agentId,
        bodyText: "Inserted after the first page."
      }
    });
    assert.equal(inserted.statusCode, 201, inserted.body);
    getDatabase()
      .prepare(
        "UPDATE agent_messages SET status = 'claimed', updated_at = ? WHERE id = ?"
      )
      .run(new Date().toISOString(), expected[20]);

    const seen = firstBody.items.map((message) => message.id);
    let cursor: string | null = firstBody.nextCursor;
    while (cursor) {
      const pageResponse: Awaited<ReturnType<typeof app.inject>> =
        await app.inject({
          method: "GET",
          url: `/api/v1/agent-messages?box=outbox&limit=10&cursor=${encodeURIComponent(cursor)}`,
          headers: { cookie }
        });
      assert.equal(pageResponse.statusCode, 200, pageResponse.body);
      const body = pageResponse.json() as {
        items: Array<{ id: string }>;
        nextCursor: string | null;
      };
      seen.push(...body.items.map((message) => message.id));
      cursor = body.nextCursor;
    }
    assert.deepEqual(seen, expected);
    assert.equal(new Set(seen).size, 25);
    assert.equal(seen.includes(inserted.json().message.id as string), false);

    const wrongFilter = await app.inject({
      method: "GET",
      url: `/api/v1/agent-messages?box=outbox&status=handled&limit=10&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
      headers: { cookie }
    });
    assert.equal(wrongFilter.statusCode, 400, wrongFilter.body);
    assert.equal(wrongFilter.json().code, "agent_message_cursor_invalid");
    const legacyOffset = await app.inject({
      method: "GET",
      url: "/api/v1/agent-messages?box=outbox&limit=10&offset=0",
      headers: { cookie }
    });
    assert.equal(legacyOffset.statusCode, 400, legacyOffset.body);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("forwarded voice retention waits for the last message and resumes a failed cleanup on startup", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-agent-messages-retention-")
  );
  let app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: true,
    devrageMetricSync: false
  });
  try {
    const cookie = issueTestOperatorSessionCookie(app);
    const sourceAgent = await issueMessageAgent({
      app,
      cookie,
      label: "Retention source"
    });
    const targetAgent = await issueMessageAgent({
      app,
      cookie,
      label: "Retention target"
    });
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
      getDatabase()
        .prepare("SELECT 1 FROM artifacts WHERE id = ?")
        .get(artifactId) !== undefined,
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
      getDatabase()
        .prepare("SELECT 1 FROM artifacts WHERE id = ?")
        .get(artifactId),
      undefined
    );
    assert.equal(
      (
        getDatabase()
          .prepare(
            "SELECT COUNT(*) AS count FROM agent_message_voice_purge_jobs"
          )
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
          .prepare(
            "SELECT COUNT(*) AS count FROM agent_message_voice_purge_jobs"
          )
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
  const encodedPolicies = [
    ["m4a", "audio/mp4"],
    ["aac", "audio/aac"],
    ["mp3", "audio/mpeg"],
    ["webm", "audio/webm"],
    ["ogg", "audio/ogg"]
  ] as const;
  for (const [extension, mimeType] of encodedPolicies) {
    const accepted = await verifyAgentMessageMedia({
      buffer: Buffer.from(
        agentMessageEncodedMediaFixtures[extension],
        "base64"
      ),
      originalFileName: `voice.${extension}`,
      declaredMimeType: mimeType,
      declaredDurationMs: 0
    });
    assert.equal(accepted.extension, extension);
    assert.ok(accepted.durationMs > 0);
  }
  const variableBitRate = await verifyAgentMessageMedia({
    buffer: Buffer.from(agentMessageEncodedMediaFixtures.m4aVbr, "base64"),
    originalFileName: "voice-vbr.m4a",
    declaredMimeType: "audio/mp4",
    declaredDurationMs: 500
  });
  assert.equal(variableBitRate.codec, "MPEG-4/AAC");
  assert.equal(isAllowedAgentMessageCodec("m4a", "ALAC"), false);
  assert.equal(isAllowedAgentMessageCodec("aac", "AAC LC"), true);
  assert.equal(isAllowedAgentMessageCodec("mp3", "MPEG 1 Layer 2"), false);
  assert.equal(isAllowedAgentMessageCodec("wav", "GSM 6.10"), false);
  assert.equal(isAllowedAgentMessageCodec("webm", "Vorbis I"), false);
  assert.equal(isAllowedAgentMessageCodec("ogg", "Opus"), true);
  await assert.rejects(
    verifyAgentMessageMedia({
      buffer: valid,
      originalFileName: "voice.mp3",
      declaredMimeType: "audio/mpeg",
      declaredDurationMs: 1_000
    }),
    (error: { code?: string }) =>
      error.code === "agent_message_voice_format_invalid"
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
    (error: { code?: string }) =>
      error.code === "agent_message_voice_duration_exceeded"
  );
  const exactDuration = await verifyAgentMessageMedia({
    buffer: wavFixture(600),
    originalFileName: "voice.wav",
    declaredMimeType: "audio/wav",
    declaredDurationMs: 600_000
  });
  assert.equal(exactDuration.durationMs, 600_000);
  const exactBytes = Buffer.alloc(AGENT_MESSAGE_MAX_VOICE_BYTES);
  valid.copy(exactBytes);
  const exactSize = await verifyAgentMessageMedia({
    buffer: exactBytes,
    originalFileName: "voice.wav",
    declaredMimeType: "audio/wav",
    declaredDurationMs: 1_000
  });
  assert.equal(exactSize.byteSize, AGENT_MESSAGE_MAX_VOICE_BYTES);
  await assert.rejects(
    verifyAgentMessageMedia({
      buffer: Buffer.alloc(AGENT_MESSAGE_MAX_VOICE_BYTES + 1),
      originalFileName: "voice.wav",
      declaredMimeType: "audio/wav",
      declaredDurationMs: 1_000
    }),
    (error: { code?: string }) =>
      error.code === "agent_message_voice_size_invalid"
  );

  const canonical = await readFile(
    path.resolve("apps/api/migrations/136_agent_messages.sql")
  );
  const codex = await readFile(
    path.resolve(
      "plugins/codex/runtime/server/migrations/136_agent_messages.sql"
    )
  );
  const hermes = await readFile(
    path.resolve(
      "plugins/hermes/forge_hermes/runtime/apps/api/migrations/136_agent_messages.sql"
    )
  );
  const openclaw = await readFile(
    path.resolve("plugins/openclaw/server/migrations/136_agent_messages.sql")
  );
  assert.deepEqual(codex, canonical);
  assert.deepEqual(hermes, canonical);
  assert.deepEqual(openclaw, canonical);
});

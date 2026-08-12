import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";

test("global capture reviews text and file intents before one idempotent atomic write", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-capture-ready-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  const cookie = issueTestOperatorSessionCookie(app);

  try {
    const intent = {
      version: 1,
      kind: "text",
      text: "Capture the research decision\nKeep the evidence linked.",
      ownerUserId: "user_operator"
    } as const;
    const proposed = await app.inject({
      method: "POST",
      url: "/api/v1/capture/proposals",
      headers: { cookie },
      payload: { intent }
    });
    assert.equal(proposed.statusCode, 200, proposed.body);
    const proposal = (proposed.json() as { proposal: Record<string, unknown> })
      .proposal as {
      proposalId: string;
      targetType: "note";
      title: string;
      contentMarkdown: string;
      requiresConfirmation: boolean;
    };
    assert.equal(proposal.targetType, "note");
    assert.equal(proposal.requiresConfirmation, true);

    const confirmation = {
      proposalId: proposal.proposalId,
      idempotencyKey: "capture-text-stable-key",
      intent,
      selection: {
        targetType: proposal.targetType,
        title: proposal.title,
        contentMarkdown: proposal.contentMarkdown,
        description: null,
        relationshipKeys: []
      },
      fileContentBase64: null
    };
    const confirmed = await app.inject({
      method: "POST",
      url: "/api/v1/capture/confirm",
      headers: { cookie },
      payload: confirmation
    });
    assert.equal(confirmed.statusCode, 201, confirmed.body);
    const firstReceipt = (confirmed.json() as { receipt: { targetId: string; replayed: boolean } })
      .receipt;
    assert.equal(firstReceipt.replayed, false);

    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/capture/confirm",
      headers: { cookie },
      payload: confirmation
    });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.headers["idempotency-replayed"], "true");
    assert.equal(
      (replay.json() as { receipt: { targetId: string } }).receipt.targetId,
      firstReceipt.targetId
    );

    const changedReplay = await app.inject({
      method: "POST",
      url: "/api/v1/capture/confirm",
      headers: { cookie },
      payload: {
        ...confirmation,
        selection: { ...confirmation.selection, title: "Changed after commit" }
      }
    });
    assert.equal(changedReplay.statusCode, 409, changedReplay.body);

    const bytes = Buffer.from("reviewed artifact bytes", "utf8");
    const fileIntent = {
      version: 1,
      kind: "file",
      ownerUserId: "user_operator",
      text: "Primary evidence",
      file: {
        name: "evidence.txt",
        declaredMimeType: "text/plain",
        byteSize: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex")
      }
    } as const;
    const fileProposalResponse = await app.inject({
      method: "POST",
      url: "/api/v1/capture/proposals",
      headers: { cookie },
      payload: { intent: fileIntent }
    });
    assert.equal(fileProposalResponse.statusCode, 200, fileProposalResponse.body);
    const fileProposal = (fileProposalResponse.json() as {
      proposal: {
        proposalId: string;
        targetType: "artifact";
        title: string;
        description: string | null;
      };
    }).proposal;
    assert.equal(fileProposal.targetType, "artifact");

    const fileConfirmation = {
      proposalId: fileProposal.proposalId,
      idempotencyKey: "capture-file-stable-key",
      intent: fileIntent,
      selection: {
        targetType: "artifact",
        title: fileProposal.title,
        contentMarkdown: null,
        description: fileProposal.description,
        relationshipKeys: []
      },
      fileContentBase64: bytes.toString("base64")
    };
    const fileConfirmed = await app.inject({
      method: "POST",
      url: "/api/v1/capture/confirm",
      headers: { cookie },
      payload: fileConfirmation
    });
    assert.equal(fileConfirmed.statusCode, 201, fileConfirmed.body);
    const artifactReceipt = (fileConfirmed.json() as {
      receipt: { targetType: string; targetHref: string; relationshipCount: number };
    }).receipt;
    assert.equal(artifactReceipt.targetType, "artifact");
    assert.match(artifactReceipt.targetHref, /^\/artifacts\//u);
    assert.equal(artifactReceipt.relationshipCount, 0);

    const changedBytes = Buffer.from("different bytes", "utf8");
    const changedFile = await app.inject({
      method: "POST",
      url: "/api/v1/capture/confirm",
      headers: { cookie },
      payload: {
        ...fileConfirmation,
        fileContentBase64: changedBytes.toString("base64")
      }
    });
    assert.equal(changedFile.statusCode, 409, changedFile.body);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

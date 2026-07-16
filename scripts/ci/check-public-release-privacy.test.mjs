import assert from "node:assert/strict";
import test from "node:test";
import { findPublicReleasePrivacyFindings } from "./check-public-release-privacy.mjs";

test("rejects private planning trees and Codex handoff payloads", () => {
  assert.deepEqual(
    findPublicReleasePrivacyFindings(
      "docs/internal/people-handoff.md",
      "<codex_delegation><source_thread_id>thread</source_thread_id></codex_delegation>"
    ),
    [
      { kind: "path", label: "private planning path" },
      { kind: "content", label: "Codex delegation payload", line: 1 }
    ]
  );
});

test("rejects private goal, automation-memory, and GPT Pro captures", () => {
  const findings = findPublicReleasePrivacyFindings(
    "docs/review.md",
    [
      "Captured from GPT Pro.",
      "Goal: private/forge-goals/people/goal.md",
      "Memory: $CODEX_HOME/automations/people/memory.md"
    ].join("\n")
  );
  assert.deepEqual(
    findings.map(({ label, line }) => ({ label, line })),
    [
      { label: "Codex automation memory path", line: 3 },
      { label: "private Forge goal path", line: 2 },
      { label: "GPT Pro capture", line: 1 }
    ]
  );
});

test("allows public product documentation about memory, privacy, and audits", () => {
  assert.deepEqual(
    findPublicReleasePrivacyFindings(
      "docs/reference/people-and-peer-sharing.md",
      "Forge Memory keeps structured memory. The privacy and security audit covers personal data."
    ),
    []
  );
  assert.deepEqual(
    findPublicReleasePrivacyFindings(
      "docs/reference/repository-structure.md",
      "Conversation-derived planning notes do not belong in public Forge."
    ),
    []
  );
});

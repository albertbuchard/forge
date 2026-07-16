import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");

function read(relativePath: string) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function section(source: string, heading: string) {
  const start = source.indexOf(`## ${heading}`);
  expect(start, `${heading} section`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf("\n## ", start + 4);
  return source.slice(start, end < 0 ? undefined : end);
}

describe("PSY-09 adapter playbook contract", () => {
  it("keeps the exact vocabulary contract identical across adapters", () => {
    const psyche = read(
      "plugins/openclaw/skills/forge-openclaw/psyche_entity_playbooks.md"
    );
    const general = read(
      "plugins/openclaw/skills/forge-openclaw/entity_conversation_playbooks.md"
    );

    for (const target of [
      "plugins/codex/skills/forge-codex/psyche_entity_playbooks.md",
      "plugins/hermes/psyche_entity_playbooks.md",
      "plugins/hermes/forge_hermes/psyche_entity_playbooks.md"
    ]) {
      expect(read(target)).toBe(psyche);
    }
    for (const target of [
      "plugins/codex/skills/forge-codex/entity_conversation_playbooks.md",
      "plugins/hermes/entity_conversation_playbooks.md",
      "plugins/hermes/forge_hermes/entity_conversation_playbooks.md"
    ]) {
      expect(read(target)).toBe(general);
    }

    for (const source of [psyche, general]) {
      const eventType = section(source, "Event Type");
      const emotion = section(source, "Emotion Definition");

      expect(eventType).toMatch(/shared batch (?:search|CRUD)/i);
      expect(eventType).toMatch(/Search (?:`event_type` )?before creat/i);
      expect(eventType).toMatch(/system: true.*read-only/is);
      expect(eventType).toMatch(/owner-scoped|owner scope/i);
      expect(eventType).toMatch(/label.*description.*userId/is);
      expect(eventType).toMatch(/Unicode NFKC.*default\s+case fold/is);
      expect(eventType).toMatch(/searches\[\]\.userIds/);
      expect(eventType).toMatch(/operations\[\]\.idempotencyKey/);
      expect(eventType).toMatch(
        /base `read` or `write` plus `psyche\.read`|base `read` or\s+`write` plus `psyche\.read`/is
      );
      expect(eventType).toMatch(/hard deletion.*key terminal|key.*terminal/is);
      expect(eventType).toMatch(
        /soft-deleted reference.*unrelated report\s+updates.*returns?\s+on\s+restore/is
      );
      expect(eventType).toMatch(/no `aliases` field|Do not invent `aliases`/i);
      expect(eventType).toMatch(/customEventType/);
      expect(eventType).toMatch(
        /hard deletion clears\s+only\s+(?:its|the) reusable\s+reference/is
      );

      expect(emotion).toMatch(/shared batch (?:search|CRUD)/i);
      expect(emotion).toMatch(/Search (?:`emotion_definition` )?before creat/i);
      expect(emotion).toMatch(/system: true.*read-only/is);
      expect(emotion).toMatch(/owner-scoped|owner scope/i);
      expect(emotion).toMatch(/label.*description.*category.*userId/is);
      expect(emotion).toMatch(/Unicode NFKC.*default\s+case fold/is);
      expect(emotion).toMatch(/searches\[\]\.userIds/);
      expect(emotion).toMatch(/operations\[\]\.idempotencyKey/);
      expect(emotion).toMatch(
        /base `write` plus `psyche\.write`|base `write` plus\s+`psyche\.write`/is
      );
      expect(emotion).toMatch(/hard deletion.*key terminal|key.*terminal/is);
      expect(emotion).toMatch(
        /soft-deleted reference.*unrelated report\s+updates.*returns?\s+on\s+restore/is
      );
      expect(emotion).toMatch(
        /no `aliases` or `bodySignals` field|Do not invent `aliases` or `bodySignals`/i
      );
      expect(emotion).toMatch(/own `label`|own emotion word/i);
      expect(emotion).toMatch(
        /hard deletion clears\s+only\s+(?:its|the) reusable\s+reference/is
      );
    }
  });

  it("keeps source adapter payload and scope guidance aligned", () => {
    const skillPaths = [
      "plugins/openclaw/skills/forge-openclaw/SKILL.md",
      "plugins/codex/skills/forge-codex/SKILL.md",
      "plugins/hermes/skill.md",
      "plugins/hermes/forge_hermes/skill.md"
    ];
    expect(read(skillPaths[3])).toBe(read(skillPaths[2]));
    for (const skillPath of skillPaths) {
      const skill = read(skillPath);
      expect(skill).toMatch(/searches\[\]\.userIds/);
      expect(skill).toMatch(/operations\[\]\.idempotencyKey/);
      expect(skill).toMatch(
        /exact\s+retry[\s\S]*hard\s+deletion[\s\S]*terminal/i
      );
      expect(skill).toMatch(
        /dedicated event-type and emotion-definition[\s\S]*psyche\.read[\s\S]*psyche\.write[\s\S]*shared batch[\s\S]*base `read` or `write`/i
      );
    }
  });
});

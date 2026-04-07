import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");

function readRepoFile(relativePath: string) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("forge skill playbook parity", () => {
  it("keeps the shared Psyche playbook aligned across agent surfaces", () => {
    const canonical = readRepoFile(
      "skills/forge-openclaw/psyche_entity_playbooks.md"
    );

    expect(
      readRepoFile(
        "openclaw-plugin/skills/forge-openclaw/psyche_entity_playbooks.md"
      )
    ).toBe(canonical);
    expect(
      readRepoFile("plugins/forge-hermes/psyche_entity_playbooks.md")
    ).toBe(canonical);
    expect(
      readRepoFile("plugins/forge-hermes/forge_hermes/psyche_entity_playbooks.md")
    ).toBe(canonical);
    expect(
      readRepoFile("plugins/forge-codex/skills/forge-codex/psyche_entity_playbooks.md")
    ).toBe(canonical);
  });

  it("keeps the shared non-Psyche conversation playbook aligned across agent surfaces", () => {
    const canonical = readRepoFile(
      "skills/forge-openclaw/entity_conversation_playbooks.md"
    );

    expect(
      readRepoFile(
        "openclaw-plugin/skills/forge-openclaw/entity_conversation_playbooks.md"
      )
    ).toBe(canonical);
    expect(
      readRepoFile("plugins/forge-hermes/entity_conversation_playbooks.md")
    ).toBe(canonical);
    expect(
      readRepoFile("plugins/forge-hermes/forge_hermes/entity_conversation_playbooks.md")
    ).toBe(canonical);
    expect(
      readRepoFile("plugins/forge-codex/skills/forge-codex/entity_conversation_playbooks.md")
    ).toBe(canonical);
  });

  it("requires the Codex skill to reference the shared playbooks and missing-only intake", () => {
    const codexSkill = readRepoFile("plugins/forge-codex/skills/forge-codex/SKILL.md");

    expect(codexSkill).toMatch(/entity_conversation_playbooks\.md/);
    expect(codexSkill).toMatch(/psyche_entity_playbooks\.md/);
    expect(codexSkill).toMatch(/missing or unclear/i);
    expect(codexSkill).toMatch(/one orienting question/i);
    expect(codexSkill).toMatch(/each question have one job/i);
    expect(codexSkill).toMatch(/follow-up lane/i);
  });

  it("keeps the canonical playbooks focused on guided, one-lane questioning", () => {
    const entityPlaybook = readRepoFile("skills/forge-openclaw/entity_conversation_playbooks.md");
    const psychePlaybook = readRepoFile("skills/forge-openclaw/psyche_entity_playbooks.md");

    expect(entityPlaybook).toMatch(/Let each question have one job/i);
    expect(entityPlaybook).toMatch(/Question design rules/i);
    expect(entityPlaybook).toMatch(/Update loop/i);
    expect(entityPlaybook).toMatch(/Task Run/i);
    expect(entityPlaybook).toMatch(/offer a tentative title or summary/i);
    expect(entityPlaybook).toMatch(/reflect what the user is trying to[\s\S]*preserve, change, or make true/i);
    expect(entityPlaybook).toMatch(/short reflection -> one orienting question/i);
    expect(entityPlaybook).toMatch(/what would you be trying to make true/i);
    expect(entityPlaybook).toMatch(/already answered the usual opening question/i);
    expect(entityPlaybook).toMatch(/stop exploring broadly/i);
    expect(entityPlaybook).toMatch(/Do not over-warm or over-therapize logistical records/i);

    expect(psychePlaybook).toMatch(/Ask only one lane at a time/i);
    expect(psychePlaybook).toMatch(/Follow-up rhythm/i);
    expect(psychePlaybook).toMatch(/Before the next question, reflect back what you just heard/i);
    expect(psychePlaybook).toMatch(/formulation work/i);
    expect(psychePlaybook).toMatch(/what the experience is[\s\S]*trying to[\s\S]*protect, prevent, or hold onto/i);
    expect(psychePlaybook).toMatch(/choose the one that most[\s\S]*improves understanding/i);
    expect(psychePlaybook).toMatch(/feels true enough/i);
    expect(psychePlaybook).toMatch(/accuracy and steadiness/i);
    expect(psychePlaybook).toMatch(/What happened the last time this pattern showed up/i);
    expect(psychePlaybook).toMatch(/What did you find yourself doing the last time this move showed up/i);
    expect(psychePlaybook).toMatch(/When that reaction hits, what does it start telling you/i);
    expect(psychePlaybook).not.toMatch(/disappearing like that/i);
    expect(psychePlaybook).not.toMatch(/send the long message/i);
    expect(psychePlaybook).not.toMatch(/polished and unreachable/i);
  });
});

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

  it("keeps the agent-facing skills explicit about preferences, questionnaires, self-observation, and health surfaces", () => {
    const openclawSkill = readRepoFile("skills/forge-openclaw/SKILL.md");
    const hermesSkill = readRepoFile("plugins/forge-hermes/forge_hermes/skill.md");

    expect(openclawSkill).toMatch(/forge_get_preferences_workspace/);
    expect(openclawSkill).toMatch(/forge_start_preferences_game/);
    expect(openclawSkill).toMatch(/forge_list_questionnaires/);
    expect(openclawSkill).toMatch(/forge_get_self_observation_calendar/);
    expect(openclawSkill).toMatch(/Self-observation/);
    expect(openclawSkill).toMatch(/sleep_session/i);
    expect(openclawSkill).toMatch(/workout_session/i);

    expect(hermesSkill).toMatch(/high-level batch routes for basic Preferences CRUD/i);
    expect(hermesSkill).toMatch(/high-level batch routes for basic questionnaire CRUD/i);
    expect(hermesSkill).toMatch(/Self-observation is note-backed/i);
  });

  it("keeps the canonical playbooks focused on guided, one-lane questioning", () => {
    const entityPlaybook = readRepoFile("skills/forge-openclaw/entity_conversation_playbooks.md");
    const psychePlaybook = readRepoFile("skills/forge-openclaw/psyche_entity_playbooks.md");

    expect(entityPlaybook).toMatch(/Let each question have one job/i);
    expect(entityPlaybook).toMatch(/Question design rules/i);
    expect(entityPlaybook).toMatch(/Update loop/i);
    expect(entityPlaybook).toMatch(/Task Run/i);
    expect(entityPlaybook).toMatch(/## Tag/);
    expect(entityPlaybook).toMatch(/offer a tentative title or summary/i);
    expect(entityPlaybook).toMatch(/reflect what the user is trying to[\s\S]*preserve, change, or make true/i);
    expect(entityPlaybook).toMatch(/short reflection -> one orienting question/i);
    expect(entityPlaybook).toMatch(/what would you be trying to make true/i);
    expect(entityPlaybook).toMatch(/already answered the usual opening question/i);
    expect(entityPlaybook).toMatch(/stop exploring broadly/i);
    expect(entityPlaybook).toMatch(/Do not over-warm or over-therapize logistical records/i);
    expect(entityPlaybook).toMatch(/Lead with what the user is trying to preserve, change, resolve, or make true/i);
    expect(entityPlaybook).toMatch(/When the user is vague, ask for the smallest real example, desired outcome, or stake/i);
    expect(entityPlaybook).toMatch(/When the user is clear, say what the record seems to be becoming/i);
    expect(entityPlaybook).toMatch(/Steering moves/i);
    expect(entityPlaybook).toMatch(/feels true[\s\S]*or needs one correction/i);
    expect(entityPlaybook).toMatch(/Prefer "what", "when", and "how" before "why"/i);
    expect(entityPlaybook).toMatch(/reusable vocabulary or taxonomy records/i);
    expect(entityPlaybook).toMatch(/adjacent record becomes visible/i);
    expect(entityPlaybook).toMatch(/offer one revised formulation yourself/i);
    expect(entityPlaybook).toMatch(/## Preference Catalog/);
    expect(entityPlaybook).toMatch(/## Preference Catalog Item/);
    expect(entityPlaybook).toMatch(/## Preference Context/);
    expect(entityPlaybook).toMatch(/## Preference Item/);

    expect(psychePlaybook).toMatch(/Ask only one lane at a time/i);
    expect(psychePlaybook).toMatch(/Follow-up rhythm/i);
    expect(psychePlaybook).toMatch(/Before the next question, reflect back what you just heard/i);
    expect(psychePlaybook).toMatch(/formulation work/i);
    expect(psychePlaybook).toMatch(/what the experience is[\s\S]*trying to[\s\S]*protect, prevent, or hold onto/i);
    expect(psychePlaybook).toMatch(/choose the one that most[\s\S]*improves understanding/i);
    expect(psychePlaybook).toMatch(/feels true enough/i);
    expect(psychePlaybook).toMatch(/accuracy and steadiness/i);
    expect(psychePlaybook).toMatch(/Therapist micro-skills/i);
    expect(psychePlaybook).toMatch(/Prefer "what", "when", and "how" early/i);
    expect(psychePlaybook).toMatch(/whether it feels true, too sharp, or still misses something important/i);
    expect(psychePlaybook).toMatch(/one brief reflection[\s\S]*one missing-detail question/i);
    expect(psychePlaybook).toMatch(/what does it seem to prove in that moment/i);
    expect(psychePlaybook).toMatch(/Psyche update loop/i);
    expect(psychePlaybook).toMatch(/newly true, newly visible, or newly inaccurate/i);
    expect(psychePlaybook).toMatch(/What happened the last time this pattern showed up/i);
    expect(psychePlaybook).toMatch(/What did you find yourself doing the last time this move showed up/i);
    expect(psychePlaybook).toMatch(/When that reaction hits, what does it start telling you about you, them, or what happens next/i);
    expect(psychePlaybook).not.toMatch(/disappearing like that/i);
    expect(psychePlaybook).not.toMatch(/send the long message/i);
    expect(psychePlaybook).not.toMatch(/polished and unreachable/i);
  });

  it("covers representative user requests for preferences, questionnaires, self-observation, calendar, and health work", () => {
    const openclawSkill = readRepoFile("skills/forge-openclaw/SKILL.md");
    const hermesSkill = readRepoFile("plugins/forge-hermes/forge_hermes/skill.md");
    const entityPlaybook = readRepoFile("skills/forge-openclaw/entity_conversation_playbooks.md");
    const psychePlaybook = readRepoFile("skills/forge-openclaw/psyche_entity_playbooks.md");

    const fakeRequests = [
      {
        request:
          "Start the preference game for restaurants and learn what food I like.",
        required: [
          /forge_get_preferences_workspace/,
          /forge_start_preferences_game/,
          /batch routes for basic Preferences CRUD/i
        ],
        questioning: [/Ask only for what is missing or unclear/i]
      },
      {
        request:
          "Create a custom questionnaire draft for my weekly self-check and publish it later.",
        required: [
          /questionnaire_instrument/,
          /forge_ensure_questionnaire_draft/,
          /forge_publish_questionnaire_draft/,
          /batch routes for basic questionnaire CRUD/i
        ],
        questioning: [/Ask only for what is missing or unclear/i]
      },
      {
        request:
          "Log a self-observation from today about the withdrawal loop after my meeting.",
        required: [
          /forge_get_self_observation_calendar/,
          /Self-observation is note-backed/i,
          /frontmatter\.observedAt/,
          /Self-observation/
        ],
        questioning: [
          /ask one orienting question first/i,
          /one concrete-example question/i
        ]
      },
      {
        request:
          "Put a calendar event on Friday and sync it to my writable calendar.",
        required: [
          /forge_get_calendar_overview/,
          /forge_connect_calendar_provider/,
          /forge_sync_calendar_connection/,
          /entityType: "calendar_event"/
        ],
        questioning: [/For straightforward logistical entities such as tasks, calendar events/i]
      },
      {
        request:
          "Review my sleep and workout logs, then attach a note about how I felt.",
        required: [
          /forge_get_sleep_overview/,
          /forge_get_sports_overview/,
          /forge_update_sleep_session/,
          /forge_update_workout_session/,
          /sleep_session/i,
          /workout_session/i
        ],
        questioning: [/ask only for what is missing or unclear/i]
      }
    ];

    for (const scenario of fakeRequests) {
      for (const pattern of scenario.required) {
        const matched =
          pattern.test(openclawSkill) ||
          pattern.test(hermesSkill) ||
          pattern.test(entityPlaybook) ||
          pattern.test(psychePlaybook);
        expect(
          matched,
          `Expected coverage for fake request: ${scenario.request} via pattern ${pattern}`
        ).toBe(true);
      }
      for (const pattern of scenario.questioning) {
        const matched =
          pattern.test(entityPlaybook) ||
          pattern.test(psychePlaybook) ||
          pattern.test(openclawSkill) ||
          pattern.test(hermesSkill);
        expect(
          matched,
          `Expected questioning guidance for fake request: ${scenario.request} via pattern ${pattern}`
        ).toBe(true);
      }
    }
  });
});

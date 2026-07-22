import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function section(source, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^## ${escaped}$`, "m").exec(source);
  const start = match?.index ?? -1;
  assert.notEqual(start, -1, `Missing playbook section: ${heading}`);
  const next = source.indexOf("\n## ", start + match[0].length);
  return source.slice(start, next === -1 ? source.length : next);
}

const generalSectionByEntity = {
  goal: "Goal",
  project: "Project",
  strategy: "Strategy",
  task: "Task",
  habit: "Habit",
  tag: "Tag",
  person: "Person",
  note: "Note",
  insight: "Insight",
  calendar_event: "Calendar Event",
  work_block_template: "Work Block Template",
  task_timebox: "Task Timebox",
  life_event: "Life Events",
  sleep_session: "Sleep Session",
  workout_session: "Workout Session",
  preference_catalog: "Preference Catalog",
  preference_catalog_item: "Preference Catalog Item",
  preference_context: "Preference Context",
  preference_item: "Preference Item",
  preferences_workspace: "Preferences Workspace",
  questionnaire_instrument: "Questionnaire Instrument",
  task_run: "Task Run",
  work_adjustment: "Work Adjustment",
  questionnaire_run: "Questionnaire Run",
  preference_judgment: "Preference Judgment",
  preference_signal: "Preference Signal",
  calendar_connection: "Calendar Connection",
  wiki_page: "Wiki Page",
  course: "Course",
  concept: "Concept",
  artifact: "Artifact",
  attention_inbox: "Attention",
  entity_navigation: "Entity Navigation",
  movement: "Movement",
  life_force: "Life Force",
  workbench: "Workbench",
  self_observation: "Self Observation",
  sleep_overview: "Sleep Overview",
  sports_overview: "Sports Overview",
  training_load: "Training Load",
  weight_loss: "Weight Loss"
};

const psycheSectionByEntity = {
  psyche_value: "Value",
  behavior_pattern: "Behavior Pattern",
  behavior: "Behavior",
  belief_entry: "Belief",
  mode_profile: "Mode Profile",
  mode_guide_session: "Mode Guide Session",
  flashcard: "Flashcard",
  trigger_report: "Trigger Report",
  event_type: "Event Type",
  emotion_definition: "Emotion Definition"
};

test("every live onboarding entity has a complete conversational playbook", () => {
  const serverSource = read("apps/api/src/app.ts");
  const start = serverSource.indexOf(
    "const AGENT_ONBOARDING_ENTITY_CATALOG_BASE"
  );
  const end = serverSource.indexOf(
    "const AGENT_ONBOARDING_ENTITY_CONVERSATION_PLAYBOOKS"
  );
  assert.ok(start >= 0 && end > start, "Could not locate onboarding catalog");
  const entityTypes = [
    ...new Set(
      [
        ...serverSource.slice(start, end).matchAll(/entityType:\s*"([^"]+)"/g)
      ].map((match) => match[1])
    )
  ];
  const mappedEntityTypes = [
    ...Object.keys(generalSectionByEntity),
    ...Object.keys(psycheSectionByEntity)
  ];
  assert.deepEqual(
    entityTypes.toSorted(),
    mappedEntityTypes.toSorted(),
    "Update the adapter conversation map whenever the live entity catalog changes"
  );

  const general = read(
    "plugins/openclaw/skills/forge-openclaw/entity_conversation_playbooks.md"
  );
  const psyche = read(
    "plugins/openclaw/skills/forge-openclaw/psyche_entity_playbooks.md"
  );
  for (const entityType of entityTypes) {
    const heading =
      generalSectionByEntity[entityType] ?? psycheSectionByEntity[entityType];
    const source = generalSectionByEntity[entityType] ? general : psyche;
    const playbook = section(source, heading);
    assert.match(playbook, /^Aim:/m, `${entityType} needs a coaching aim`);
    assert.match(playbook, /^Arc:/m, `${entityType} needs a progressive arc`);
    assert.match(
      playbook,
      /^Ready to .+ when:/m,
      `${entityType} needs an explicit readiness boundary`
    );
    assert.match(
      playbook,
      /^Preferred opening question:/m,
      `${entityType} needs a tested opening question`
    );
  }
});

test("all adapters ship byte-identical shared playbooks", () => {
  const general = read(
    "plugins/openclaw/skills/forge-openclaw/entity_conversation_playbooks.md"
  );
  const psyche = read(
    "plugins/openclaw/skills/forge-openclaw/psyche_entity_playbooks.md"
  );
  for (const target of [
    "plugins/hermes/entity_conversation_playbooks.md",
    "plugins/hermes/forge_hermes/entity_conversation_playbooks.md",
    "plugins/codex/skills/forge-codex/entity_conversation_playbooks.md"
  ]) {
    assert.equal(
      read(target),
      general,
      `${target} drifted from the shared playbook`
    );
  }
  for (const target of [
    "plugins/hermes/psyche_entity_playbooks.md",
    "plugins/hermes/forge_hermes/psyche_entity_playbooks.md",
    "plugins/codex/skills/forge-codex/psyche_entity_playbooks.md"
  ]) {
    assert.equal(
      read(target),
      psyche,
      `${target} drifted from the Psyche playbook`
    );
  }
  assert.equal(
    read("plugins/hermes/skill.md"),
    read("plugins/hermes/forge_hermes/skill.md"),
    "Hermes source and packaged skill contracts must be identical"
  );
});

test("adapter skills reconcile with onboarding and keep route families exact", () => {
  const skills = [
    "plugins/openclaw/skills/forge-openclaw/SKILL.md",
    "plugins/hermes/skill.md",
    "plugins/codex/skills/forge-codex/SKILL.md"
  ].map((target) => [target, read(target)]);
  const serverSource = read("apps/api/src/app.ts");
  const batchStart = serverSource.indexOf(
    "const AGENT_ONBOARDING_BATCH_ROUTE_BASES"
  );
  const batchEnd = serverSource.indexOf(
    "type OnboardingEntityClassification",
    batchStart
  );
  const batchEntities = [
    ...serverSource
      .slice(batchStart, batchEnd)
      .matchAll(/^\s{2}([a-z_]+):\s*"\/api\/v1\//gm)
  ].map((match) => match[1]);

  for (const [target, skill] of skills) {
    for (const phrase of [
      "## Live Contract And Missing-Information Gate",
      "`minimumCreateFields`",
      "`questionFlow`",
      "private missing-information diff",
      "Never call batch CRUD with",
      '`entityType: "issue"`',
      '`entityType: "subtask"`',
      "forge_call_movement_route",
      "forge_call_life_event_route",
      "forge_call_life_force_route",
      "forge_call_workbench_route",
      "forge_call_course_route",
      "forge_call_calendar_connection_route",
      "forge_call_wiki_route",
      "GET /api/v1/life-force",
      '`{"routeKey":"selection"',
      '`{"routeKey":"runFlow"',
      "`memoryClarity` as `unspecified`",
      "Save a sparse `draft`",
      "`interpretationConsent: true`",
      "`expectedRevision`"
    ]) {
      assert.ok(skill.includes(phrase), `${target} is missing: ${phrase}`);
    }
    for (const entityType of batchEntities) {
      assert.ok(
        skill.includes(`\`${entityType}\``),
        `${target} does not name batch entity ${entityType}`
      );
    }
  }
});

test("People guidance stays batch-first, scoped, useful, and human-controlled", () => {
  const skills = [
    "plugins/openclaw/skills/forge-openclaw/SKILL.md",
    "plugins/hermes/skill.md",
    "plugins/codex/skills/forge-codex/SKILL.md"
  ].map((target) => [target, read(target)]);

  for (const [target, skill] of skills) {
    for (const phrase of [
      "`person` is an owner-scoped local record",
      "forge_search_entities",
      "forge_create_entities",
      "forge_update_entities",
      "forge_delete_entities",
      "forge_restore_entities",
      "general `links`",
      "not a Forge `User`",
      "forge_call_people_route",
      "forge_call_peer_route",
      "listPeopleReadModel",
      "getPersonContext",
      "interpretPersonQuestion",
      "executePersonQuestion",
      "listPeerRelationships",
      "getPeerSyncStatus",
      "Pairing acceptance",
      "Calendar availability interpretation",
      "Goal-horizon interpretation",
      "Cycling aggregate interpretation",
      "result.metadata.source",
      "redactedFields",
      "never infer withheld fields"
    ]) {
      assert.ok(skill.includes(phrase), `${target} is missing: ${phrase}`);
    }
    assert.match(
      skill,
      /An operator session does not\s+substitute\s+for that token/,
      `${target} must require an agent token rather than an operator session`
    );
    assert.ok(
      skill.includes("resync requests") && skill.includes("human-only"),
      `${target} must classify resync as human-only`
    );
    const peerToolGuidance = skill.match(
      /- `forge_call_peer_route` exposes only[\s\S]*?(?=\n- Pairing acceptance)/
    )?.[0];
    assert.ok(peerToolGuidance, `${target} is missing peer tool guidance`);
    assert.doesNotMatch(
      peerToolGuidance,
      /requestPeerResync/,
      `${target} must not advertise resync through the agent tool`
    );
  }

  const person = section(
    read(
      "plugins/openclaw/skills/forge-openclaw/entity_conversation_playbooks.md"
    ),
    "Person"
  );
  for (const phrase of [
    "contact form",
    "Search the intended owner's Person records",
    "Leave contacts, birthdays, private notes, and sensitive facts unasked",
    "general `links:",
    "not a local `User`",
    "Agents cannot accept pairing"
  ]) {
    assert.ok(person.includes(phrase), `Person playbook is missing: ${phrase}`);
  }
});

test("Psyche contract requires active formulation, correction, and consent", () => {
  const psyche = read(
    "plugins/openclaw/skills/forge-openclaw/psyche_entity_playbooks.md"
  );
  for (const phrase of [
    "## Therapeutic state checkpoint",
    "the user's accepted wording and any wording they rejected",
    "offer one grounded hypothesis",
    "A correction replaces the rejected hypothesis",
    "third broad question"
  ]) {
    assert.ok(psyche.includes(phrase), `Psyche contract is missing: ${phrase}`);
  }
  assert.match(
    psyche,
    /ask for save consent or act on the\s+consent already given/,
    "Psyche contract must move accepted wording to consent without reopening intake"
  );
});

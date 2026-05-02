import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");

function readRepoFile(relativePath: string) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const entityPlaybook = readRepoFile(
  "skills/forge-openclaw/entity_conversation_playbooks.md"
);
const psychePlaybook = readRepoFile(
  "skills/forge-openclaw/psyche_entity_playbooks.md"
);

function getSectionSlice(document: string, section: string) {
  const headingRegex = new RegExp(`^## ${section}$`, "m");
  const headingMatch = headingRegex.exec(document);
  const heading = `## ${section}`;
  const start = headingMatch?.index ?? -1;
  expect(start, `${section} heading should exist`).toBeGreaterThanOrEqual(0);
  const nextHeadingRegex = /\n## /g;
  nextHeadingRegex.lastIndex = start + heading.length;
  const match = nextHeadingRegex.exec(document);
  const end = match ? match.index : document.length;
  return document.slice(start, end);
}

describe("question flow simulation cycles", () => {
  const nonPsycheSections = [
    "Goal",
    "Project",
    "Strategy",
    "Task",
    "Habit",
    "Tag",
    "Note",
    "Wiki Page",
    "Insight",
    "Calendar Event",
    "Work Block Template",
    "Task Timebox",
    "Task Run",
    "Work Adjustment",
    "Self Observation",
    "Sleep Session",
    "Workout Session",
    "Calendar Connection",
    "Preference Judgment",
    "Preference Signal",
    "Movement",
    "Life Force",
    "Workbench",
    "Preference Catalog",
    "Preference Catalog Item",
    "Preference Context",
    "Preference Item",
    "Questionnaire Instrument",
    "Questionnaire Run"
  ] as const;

  const psycheSections = [
    "Value",
    "Behavior Pattern",
    "Behavior",
    "Belief",
    "Mode Profile",
    "Mode Guide Session",
    "Trigger Report",
    "Event Type",
    "Emotion Definition"
  ] as const;

  const simulatedUserScenarios: Record<
    (typeof nonPsycheSections)[number] | (typeof psycheSections)[number],
    string
  > = {
    Goal: "Save a goal about rebuilding my clinical writing confidence.",
    Project: "Turn this vague thesis-support idea into a real project.",
    Strategy:
      "Create a strategy for getting from rough literature notes to a defensible chapter.",
    Task: "Add the next concrete AI-session task under that project.",
    Habit: "Track a negative habit where I avoid starting difficult writing.",
    Tag: "Create a tag for things that belong to professional identity repair.",
    Note: "Preserve this reflection without turning it into a full Psyche record yet.",
    "Wiki Page":
      "Create a durable reference page for a recurring research method.",
    Insight:
      "Save the pattern I noticed from the last three blocked work sessions.",
    "Calendar Event": "Schedule a focused review call in local time.",
    "Work Block Template":
      "Make a repeating protected writing block that blocks other work.",
    "Task Timebox": "Reserve tomorrow morning for one existing Forge task.",
    "Task Run": "Start live work on the current thesis task.",
    "Work Adjustment":
      "Add 35 minutes of real work that happened outside a live run.",
    "Self Observation": "Log what I noticed in the moment before I disengaged.",
    "Sleep Session": "Attach reflective context to last night's poor sleep.",
    "Workout Session": "Connect a hard workout to mood and recovery context.",
    "Calendar Connection":
      "Connect a calendar so Forge can read commitments and write planning blocks.",
    "Preference Judgment":
      "Record which of two writing environments I prefer for deep work.",
    "Preference Signal": "Mark this cafe as a veto for serious writing.",
    Movement: "Correct a missing movement span and then review the timeline.",
    "Life Force": "Change the model because Mondays crash after lunch.",
    Workbench:
      "Inspect a failed flow run and read the latest output for one node.",
    "Preference Catalog": "Create a comparison pool for places to work from.",
    "Preference Catalog Item":
      "Add one cafe candidate without making later comparisons ambiguous.",
    "Preference Context":
      "Define a context where preferences differ when I am tired.",
    "Preference Item":
      "Save one preference candidate and decide if it is a signal or comparison item.",
    "Questionnaire Instrument":
      "Draft a reusable questionnaire for post-session reflection.",
    "Questionnaire Run":
      "Continue an in-progress reflection run and finish the next answer.",
    Value: "Clarify why professional courage feels important right now.",
    "Behavior Pattern": "Map the loop where I freeze after critical feedback.",
    Behavior:
      "Understand the recurring move where I over-edit instead of submitting.",
    Belief:
      "Save the belief sentence that says my work will be exposed as unserious.",
    "Mode Profile":
      "Describe the part that takes over when judgment feels near.",
    "Mode Guide Session":
      "Guide a present-moment mode inquiry after a sharp shame reaction.",
    "Trigger Report":
      "Capture the emotionally meaningful episode from today's meeting.",
    "Event Type":
      "Name the recurring kind of moment where feedback feels like danger.",
    "Emotion Definition":
      "Define the lived signature of dread versus ordinary anxiety."
  };

  it("cycle 1: every entity flow starts with visible direction instead of field collection", () => {
    expect(entityPlaybook).toMatch(/direction of the intake visible/i);
    expect(entityPlaybook).toMatch(/Opening move recipes/i);
    expect(entityPlaybook).toMatch(/Strategic record:/i);
    expect(entityPlaybook).toMatch(/Reusable record:/i);
    expect(entityPlaybook).toMatch(/Operational record:/i);
    expect(entityPlaybook).toMatch(
      /trying to understand,\s*preserve,\s*decide,\s*schedule,\s*or change something/i
    );
    expect(entityPlaybook).toMatch(
      /Do not ask for separate user-story references/i
    );
    expect(entityPlaybook).toMatch(/do not widen[\s\S]*meta lane question/i);
    expect(entityPlaybook).toMatch(
      /another agent could follow[\s\S]*without guessing/i
    );

    for (const section of nonPsycheSections) {
      const sectionSlice = getSectionSlice(entityPlaybook, section);
      expect(sectionSlice).toMatch(/Aim:/);
      expect(sectionSlice).toMatch(/Preferred opening question:/);
      expect(sectionSlice).toMatch(/Ready to (save|act|update|start)/i);
    }

    for (const section of psycheSections) {
      const sectionSlice = getSectionSlice(psychePlaybook, section);
      expect(sectionSlice).toMatch(/Aim:/);
      expect(sectionSlice).toMatch(/Preferred opening question:/);
      expect(sectionSlice).toMatch(/Ready to save/i);
    }
  });

  it("uses explicit simulated scenarios for every required entity and surface in each cycle", () => {
    expect(Object.keys(simulatedUserScenarios).sort()).toEqual(
      [...nonPsycheSections, ...psycheSections].sort()
    );

    for (const section of nonPsycheSections) {
      expect(simulatedUserScenarios[section], `${section} scenario`).toMatch(
        /\w/
      );
      const sectionSlice = getSectionSlice(entityPlaybook, section);
      expect(
        sectionSlice,
        `${section} should have actionable guidance`
      ).toMatch(/Aim:|Arc:/);
    }

    for (const section of psycheSections) {
      expect(simulatedUserScenarios[section], `${section} scenario`).toMatch(
        /\w/
      );
      const sectionSlice = getSectionSlice(psychePlaybook, section);
      expect(
        sectionSlice,
        `${section} should have therapeutic guidance`
      ).toMatch(/Aim:|Arc:/);
    }
  });

  it("cycle 2: all flows keep a guided reflective stance, with stronger therapist-like pacing for Psyche", () => {
    expect(entityPlaybook).toMatch(/feels important to keep true/i);
    expect(entityPlaybook).toMatch(/Close cleanly/i);
    expect(entityPlaybook).toMatch(/what seems clear now is/i);
    expect(entityPlaybook).toMatch(
      /For review requests, ask what practical question they want the read to answer/i
    );
    expect(entityPlaybook).toMatch(
      /what this would help them decide later is often the clearest scope signal/i
    );
    expect(entityPlaybook).toMatch(/what workflow they are trying to unlock/i);
    expect(entityPlaybook).toMatch(
      /emotionally loaded but the record is still non-Psyche[\s\S]*lived stake once[\s\S]*operational question/i
    );
    expect(entityPlaybook).toMatch(
      /what sentence future-you would need to recover from this note later/i
    );
    expect(entityPlaybook).toMatch(
      /what belongs inside the boundary and what can stay out if the scope still[\s\S]*feels muddy/i
    );
    expect(entityPlaybook).toMatch(
      /situation -> cue -> emotion\/body -> thought\/meaning -> behavior\/urge/i
    );
    expect(entityPlaybook).toMatch(
      /Do not promote self-observation over functional analysis/i
    );
    expect(entityPlaybook).toMatch(
      /Use `wiki_page` when the user wants durable memory/i
    );
    expect(psychePlaybook).toMatch(/## Schema Theme Routing/i);
    expect(psychePlaybook).toMatch(
      /schema theme[\s\S]*belief_entry[\s\S]*behavior_pattern[\s\S]*mode_profile/i
    );
    expect(entityPlaybook).toMatch(
      /self_observation[\s\S]*note-backed|note-backed[\s\S]*self_observation/i
    );
    expect(entityPlaybook).toMatch(
      /sleep_session[\s\S]*shared batch CRUD routes|shared batch CRUD routes[\s\S]*sleep_session/i
    );
    expect(entityPlaybook).toMatch(
      /workout_session[\s\S]*shared batch CRUD routes|shared batch CRUD routes[\s\S]*workout_session/i
    );

    expect(psychePlaybook).toMatch(/living center of the moment/i);
    expect(psychePlaybook).toMatch(/First reflection menu/i);
    expect(psychePlaybook).toMatch(/Permission pivots/i);
    expect(psychePlaybook).toMatch(/graspable enough/i);
    expect(psychePlaybook).toMatch(/accurate enough to be held/i);
    expect(psychePlaybook).toMatch(/contain before you interpret/i);
    expect(psychePlaybook).toMatch(
      /old wording no longer holds the whole experience/i
    );
    expect(psychePlaybook).toMatch(/emotionally meaningful kind of moment/i);
    expect(psychePlaybook).toMatch(/lived signature/i);
    expect(psychePlaybook).toMatch(/Interpretive Hypotheses/i);
    expect(psychePlaybook).toMatch(/collaborative formulations/i);
    expect(psychePlaybook).toMatch(/protecting, predicting, relieving, or\s+costing/i);

    const reflectiveNonPsyche = [
      "Goal",
      "Habit",
      "Note",
      "Self Observation",
      "Sleep Session",
      "Workout Session",
      "Preference Context",
      "Questionnaire Instrument"
    ] as const;

    for (const section of reflectiveNonPsyche) {
      const sectionSlice = getSectionSlice(entityPlaybook, section);
      expect(sectionSlice).toMatch(/Helpful follow-up lanes:|Arc:/);
    }

    for (const section of psycheSections) {
      const sectionSlice = getSectionSlice(psychePlaybook, section);
      expect(sectionSlice).toMatch(/Helpful follow-up lanes:/);
      expect(sectionSlice).toMatch(/Likely linked entities:/);
    }
  });

  it("cycle 3: all flows close efficiently, preserve only helpful questions, and avoid reopening settled formulations", () => {
    expect(entityPlaybook).toMatch(/If no detail is still decision-relevant/i);
    expect(entityPlaybook).toMatch(/revise the working formulation once/i);
    expect(entityPlaybook).toMatch(
      /What feels different enough now that this record needs to change/i
    );
    expect(entityPlaybook).toMatch(
      /I can stay narrow here\. What is the one thing that no longer fits/i
    );
    expect(entityPlaybook).toMatch(
      /When the user already gave the correction in usable language,[\s\S]*what still[\s\S]*seems true,[\s\S]*one thing that no longer fits/i
    );
    expect(entityPlaybook).toMatch(
      /what this would help[\s\S]*decide later is/i
    );
    expect(entityPlaybook).toMatch(
      /meaning-bearing updates[\s\S]*feels newly true/i
    );
    expect(entityPlaybook).toMatch(/repair or revise one saved overlay/i);
    expect(entityPlaybook).toMatch(/delete one saved overlay/i);
    expect(entityPlaybook).toMatch(
      /inspect one saved movement box before repairing it/i
    );
    expect(entityPlaybook).toMatch(
      /read the timeline or saved-box[\s\S]*detail before you mutate it/i
    );
    expect(entityPlaybook).toMatch(
      /repeatable day-shape such as "Mondays crash after lunch"/i
    );
    expect(entityPlaybook).toMatch(
      /public input contract or a published output/i
    );
    expect(entityPlaybook).toMatch(
      /send one follow-up message into a saved flow chat/i
    );
    expect(entityPlaybook).toMatch(/run[\s\S]*summary/i);
    expect(entityPlaybook).toMatch(/one node result/i);
    expect(entityPlaybook).toMatch(/latest node output/i);
    expect(entityPlaybook).toMatch(/published output/i);
    expect(entityPlaybook).toMatch(/do not ask a broad review question again/i);
    expect(entityPlaybook).toMatch(
      /already gave usable wording[\s\S]*rename it for style/i
    );
    expect(entityPlaybook).toMatch(
      /skip the meta lane question when the user already named[\s\S]*exact correction or[\s\S]*review target/i
    );
    expect(entityPlaybook).toMatch(
      /skip the meta lane[\s\S]*ask only for the missing run, node, or output scope/i
    );
    expect(entityPlaybook).toMatch(
      /skip the meta lane[\s\S]*ask only for the specific weekday, profile field, or signal/i
    );
    expect(entityPlaybook).toMatch(/latest successful node output/i);
    expect(entityPlaybook).toMatch(
      /stable public input contract or published output/i
    );
    expect(entityPlaybook).toMatch(
      /user already gave the correction in usable language/i
    );
    expect(entityPlaybook).toMatch(
      /next answer would not change the entity type, route, wording, timing, or useful links/i
    );
    expect(entityPlaybook).toMatch(
      /read the overview back when the user is[\s\S]*practical impact of the change/i
    );

    expect(psychePlaybook).toMatch(/Change and save pivots/i);
    expect(psychePlaybook).toMatch(/When the user says the formulation lands/i);
    expect(psychePlaybook).toMatch(
      /When the user offers their own sentence[\s\S]*stay inside that sentence first/i
    );
    expect(psychePlaybook).toMatch(
      /what the old wording was trying to[\s\S]*hold and what the new episode or evidence changes/i
    );
    expect(psychePlaybook).toMatch(/Do not reopen the full origin story/i);
    expect(psychePlaybook).toMatch(
      /Do you want to revise the whole formulation, or only the part that now feels inaccurate/i
    );
    expect(psychePlaybook).toMatch(
      /recent charged episode[\s\S]*before you rename the durable/i
    );
    expect(psychePlaybook).toMatch(
      /If the user already gives the new sentence in usable language,[\s\S]*revise the wording[\s\S]*once and save/i
    );
    expect(psychePlaybook).toMatch(/Do not open a second broad origin story/i);
    expect(psychePlaybook).toMatch(
      /formulation already lands[\s\S]*stop asking and save/i
    );
    expect(psychePlaybook).toMatch(
      /do not ask for evidence, origin, or repair[\s\S]*all that is[\s\S]*missing/i
    );
    expect(psychePlaybook).toMatch(
      /do not switch containers unless the user wants to/i
    );
    expect(psychePlaybook).toMatch(
      /say in plain language what makes you think/i
    );
  });
});

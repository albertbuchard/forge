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

describe("question flow quality coverage", () => {
  it("covers every non-Psyche entity flow with intent-first guidance", () => {
    const scenarios = [
      ["Goal", /keep hold of here/i, /why it matters now/i],
      ["Project", /make true in your life or work/i, /bounded workstream/i],
      ["Strategy", /actually trying to arrive at/i, /major phases/i],
      ["Task", /next concrete move here/i, /actionable move/i],
      ["Habit", /strengthen or interrupt/i, /honest check-in/i],
      ["Tag", /help you notice or find again later/i, /inside versus outside/i],
      ["Note", /worth preserving in a note/i, /durable or temporary/i],
      ["Wiki Page", /main reference for/i, /durable reference page/i],
      ["Insight", /future-you or the agent/i, /practical recommendation/i],
      ["Calendar Event", /when should it happen in your local time/i, /timezone/i],
      ["Work Block Template", /when should it repeat/i, /allows or blocks work/i],
      ["Task Timebox", /make time for/i, /planned work with completed work/i],
      ["Task Run", /Which task should I start/i, /Start the run instead of turning it into intake/i],
      ["Work Adjustment", /time correction belong to/i, /truthfully/i],
      ["Self Observation", /notice most clearly in that moment/i, /support later reflection/i],
      ["Sleep Session", /important enough to remember or connect/i, /reflective takeaway/i],
      ["Workout Session", /most worth remembering or connecting/i, /subjective effort, mood, meaning/i],
      ["Calendar Connection", /calendar provider are you trying to connect/i, /workflow they are trying to unlock/i],
      ["Preference Judgment", /comparison are you actually trying to settle/i, /pairwise preference decision/i],
      ["Preference Signal", /remember about this item right now/i, /favorite, veto, bookmark,[\s\S]*compare-later/i],
      ["Movement", /stayed and traveled/i, /dedicated movement read or write path/i],
      ["Life Force", /current energy picture/i, /dedicated life-force path/i],
      ["Workbench", /inspect a flow, change it, run it/i, /dedicated workbench route family/i],
      ["Preference Catalog", /decision or taste question should this catalog help with/i, /comparison pool/i],
      ["Preference Catalog Item", /meaningfully worth comparing/i, /clear and fair/i],
      ["Preference Context", /treat your preferences differently here/i, /inside versus outside/i],
      ["Preference Item", /make clearer by saving this item/i, /favorite, veto, or compare-later/i],
      ["Questionnaire Instrument", /help someone notice or track/i, /reusable questionnaire/i],
      ["Questionnaire Run", /start, continue, review, or finish a questionnaire run/i, /next answer or note that matters/i],
      ["Event Type", /keeps happening/i, /future reports stay[\s\S]*consistent/i],
      ["Emotion Definition", /not a nearby one/i, /future reports stay precise/i]
    ] as const;

    for (const [section, opening, purpose] of scenarios) {
      const sectionSlice = getSectionSlice(entityPlaybook, section);
      expect(sectionSlice, `${section} should exist`).toContain(`## ${section}`);
      expect(sectionSlice, `${section} should have an opening question`).toMatch(opening);
      expect(sectionSlice, `${section} should state the job of the record`).toMatch(
        purpose
      );
    }
  });

  it("keeps the shared stance centered on guided clarification instead of form filling", () => {
    expect(entityPlaybook).toMatch(
      /Start by saying what seems to matter here or what the record is becoming/i
    );
    expect(entityPlaybook).toMatch(
      /After each substantive answer, briefly say what is becoming clearer/i
    );
    expect(entityPlaybook).toMatch(/## Turn shapes/i);
    expect(entityPlaybook).toMatch(/Middle turn:/i);
    expect(entityPlaybook).toMatch(/Closing turn:/i);
    expect(entityPlaybook).toMatch(/One focused question is the default/i);
    expect(entityPlaybook).toMatch(
      /The first question should usually clarify lived meaning, use, stake, or timing/i
    );
    expect(entityPlaybook).toMatch(
      /trying to understand,\s*preserve,\s*decide,\s*schedule,\s*or change something/i
    );
    expect(entityPlaybook).toMatch(/hidden checklist says it is next/i);
    expect(entityPlaybook).toMatch(
      /If the next question would only decorate the record[\s\S]*skip it/i
    );
  });

  it("keeps abstract and reusable records grounded in future use before label wording", () => {
    expect(entityPlaybook).toMatch(/## Abstract And Reusable Record Moves/);
    expect(entityPlaybook).toMatch(/## Name, Define, Connect/);
    expect(entityPlaybook).toMatch(
      /Start from the future use, decision, or repeated moment the record should clarify/i
    );
    expect(entityPlaybook).toMatch(
      /For vocabulary records, ask what counts as inside versus outside the term/i
    );
    expect(entityPlaybook).toMatch(
      /offer a candidate label yourself and invite[\s\S]*correction/i
    );
    expect(entityPlaybook).toMatch(
      /what kind of honest moment or decision it should help someone answer/i
    );
    expect(entityPlaybook).toMatch(
      /keep it provisional[\s\S]*future use are clear/i
    );
    expect(entityPlaybook).toMatch(
      /future reports to name the same way each time/i
    );
    expect(entityPlaybook).toMatch(
      /what workflow they are trying to unlock/i
    );
    expect(entityPlaybook).toMatch(
      /what felt most important to name before it gets smoothed over or forgotten/i
    );
    expect(entityPlaybook).toMatch(
      /what sentence future-you would need to recover from this note later/i
    );
    expect(entityPlaybook).toMatch(
      /what belongs inside the boundary and what can stay out if the scope still[\s\S]*feels muddy/i
    );
    expect(entityPlaybook).toMatch(
      /smallest concrete slice if the observation still feels vague[\s\S]*global/i
    );
    expect(entityPlaybook).toMatch(
      /do not ask a broad review question again[\s\S]*then act/i
    );
    expect(entityPlaybook).toMatch(
      /what would make the comparison confusing or unfair if the label stayed as-is/i
    );
    expect(entityPlaybook).toMatch(
      /what would make the instrument distinct instead of redundant/i
    );
  });

  it("covers every Psyche entity flow with example-first therapist-like questioning", () => {
    const scenarios = [
      ["Value", /pull or absence of this value/i, /ordinary behavior would show the value/i],
      ["Behavior Pattern", /last time this pattern showed up/i, /what the loop protects/i],
      ["Behavior", /last time this move showed up/i, /what it does for the user in the moment/i],
      ["Belief", /what does it start telling you/i, /one explicit sentence/i],
      ["Mode Profile", /what feels most at risk/i, /protect, prevent, or control/i],
      ["Mode Guide Session", /what just happened/i, /candidate mode labels only after enough evidence exists/i],
      ["Trigger Report", /what happened in that moment/i, /emotionally meaningful episode/i]
    ] as const;

    for (const [section, opening, anchor] of scenarios) {
      const sectionSlice = getSectionSlice(psychePlaybook, section);
      expect(sectionSlice, `${section} should exist`).toContain(`## ${section}`);
      expect(sectionSlice, `${section} should have its own opening question`).toMatch(
        opening
      );
      expect(sectionSlice, `${section} should stay grounded in lived experience`).toMatch(
        anchor
      );
    }
  });

  it("keeps the Psyche playbook paced around reflection before interpretation or repair", () => {
    expect(psychePlaybook).toMatch(
      /Name the emotional center or lived stake in plain language before the next question/i
    );
    expect(psychePlaybook).toMatch(
      /ask permission before moving from understanding into[\s\S]*naming, challenging, or solution-finding/i
    );
    expect(psychePlaybook).toMatch(/Contain:/);
    expect(psychePlaybook).toMatch(
      /makes the moment feel holdable before you deepen or name it/i
    );
    expect(psychePlaybook).toMatch(
      /Do not ask for evidence, alternative beliefs, or repair plans before the user has had/i
    );
    expect(psychePlaybook).toMatch(/## Therapeutic turn shapes/i);
    expect(psychePlaybook).toMatch(/## Name, Define, Connect/i);
    expect(psychePlaybook).toMatch(/Do not make the user prove the experience/i);
    expect(psychePlaybook).toMatch(
      /Do not widen into adjacent entities until the current one has a working sentence/i
    );
    expect(psychePlaybook).toMatch(/If the user says it lands, move toward the write/i);
    expect(psychePlaybook).toMatch(/name the core meaning in the user's language/i);
  });
});

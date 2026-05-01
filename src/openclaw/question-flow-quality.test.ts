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
      ["Wiki Page", /remember or reuse later/i, /durable memory/i],
      ["Insight", /future-you or the agent/i, /practical recommendation/i],
      ["Calendar Event", /when should it happen in your local time/i, /timezone/i],
      ["Work Block Template", /when should it repeat/i, /allows or blocks work/i],
      ["Task Timebox", /make time for/i, /planned work with completed work/i],
      ["Task Run", /Which task should I start/i, /Start the run instead of turning it into intake/i],
      ["Work Adjustment", /time correction belong to/i, /truthfully/i],
      ["Self Observation", /what happened in the situation/i, /situation, cue, emotion\/body, thought\/meaning, behavior\/urge, and consequence/i],
      ["Sleep Session", /important enough to remember or connect/i, /reflective takeaway/i],
      ["Workout Session", /most worth remembering or connecting/i, /subjective effort, mood, meaning/i],
      ["Calendar Connection", /calendar provider are you trying to connect/i, /workflow they are trying to unlock/i],
      ["Preference Judgment", /comparison are you actually trying to settle/i, /pairwise preference decision/i],
      ["Preference Signal", /remember about this item right now/i, /favorite, veto, bookmark,[\s\S]*compare-later/i],
      ["Movement", /understand, correct, or preserve/i, /timeline[\s\S]*overlay[\s\S]*repair/i],
      ["Life Force", /energy picture right now/i, /dedicated life-force path/i],
      ["Workbench", /inspect, change, run, or publish/i, /dedicated workbench route family/i],
      ["Preference Catalog", /decision or taste question should this catalog help with/i, /comparison pool/i],
      ["Preference Catalog Item", /meaningfully worth comparing/i, /clear and fair/i],
      ["Preference Context", /treat your preferences differently here/i, /inside versus outside/i],
      ["Preference Item", /make clearer by saving this item/i, /favorite, veto, or compare-later/i],
      ["Questionnaire Instrument", /help someone notice or track/i, /reusable questionnaire/i],
      ["Questionnaire Run", /start, continue, review, or finish a questionnaire run/i, /next answer or note that matters/i]
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
      /For updates,[\s\S]*smallest thing[\s\S]*newly visible/i
    );
    expect(entityPlaybook).toMatch(
      /For review requests, ask what practical question they want the read to answer/i
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
      /what they are actually trying[\s\S]*save, decide, review, or change/i
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
    expect(entityPlaybook).toMatch(/## Update And Review Shortcuts/i);
    expect(entityPlaybook).toMatch(
      /I can stay narrow here\. What is the one thing that no longer fits/i
    );
    expect(entityPlaybook).toMatch(
      /what this would help them decide later is often the clearest scope signal/i
    );
    expect(entityPlaybook).toMatch(
      /read the overview back if they want to see the updated picture/i
    );
    expect(entityPlaybook).toMatch(
      /read[\s\S]*relevant timeline back instead of leaving the correction ungrounded/i
    );
    expect(entityPlaybook).toMatch(
      /if the truth of one uncertain span is still unclear,[\s\S]*read the timeline or saved-box[\s\S]*detail before you mutate it/i
    );
    expect(entityPlaybook).toMatch(
      /if the user is asking where they were during one uncertain window,[\s\S]*prefer a timeline[\s\S]*read before you create a correction/i
    );
    expect(entityPlaybook).toMatch(
      /repeatable day-shape such as "Mondays crash after lunch"[\s\S]*weekday-template question/i
    );
    expect(entityPlaybook).toMatch(/debugging one failed run|debug one failed execution/i);
    expect(entityPlaybook).toMatch(/run[\s\S]*summary/i);
    expect(entityPlaybook).toMatch(/latest node output/i);
    expect(entityPlaybook).toMatch(/published output/i);
    expect(entityPlaybook).toMatch(/POST \/api\/v1\/workbench\/flows/);
    expect(entityPlaybook).toMatch(/PATCH \/api\/v1\/workbench\/flows\/:id/);
    expect(entityPlaybook).toMatch(/DELETE \/api\/v1\/workbench\/flows\/:id/);
    expect(entityPlaybook).toMatch(
      /inspect one already-saved movement correction before editing/i
    );
    expect(entityPlaybook).toMatch(/DELETE \/api\/v1\/movement\/user-boxes\/:id/i);
    expect(entityPlaybook).toMatch(/send one follow-up message into a saved flow chat/i);
    expect(entityPlaybook).toMatch(
      /Self-observation is not the default container for psychological material/i
    );
    expect(entityPlaybook).toMatch(
      /functional analysis:[\s\S]*situation -> cue -> emotion\/body -> thought\/meaning -> behavior\/urge/i
    );
    expect(entityPlaybook).toMatch(
      /Use `behavior_pattern` for a recurring loop/i
    );
    expect(entityPlaybook).toMatch(
      /Use `wiki_page` when the user wants durable memory, a book\/article\/source summary/i
    );
    expect(entityPlaybook).toMatch(
      /what sentence future-you would need to recover from this note later/i
    );
    expect(entityPlaybook).toMatch(
      /already gave usable wording[\s\S]*rename it for style/i
    );
    expect(entityPlaybook).toMatch(
      /what belongs inside the boundary and what can stay out if the scope still[\s\S]*feels muddy/i
    );
    expect(entityPlaybook).toMatch(
      /what happened in the situation[\s\S]*cue, trigger[\s\S]*emotion, body signal[\s\S]*what the user did/i
    );
    expect(entityPlaybook).toMatch(
      /Do not promote self-observation over functional analysis/i
    );
    expect(entityPlaybook).toMatch(
      /book, article, source, concept, person, conversation, project\s+reference, or personal manual/i
    );
    expect(psychePlaybook).toMatch(/## Schema Theme Routing/i);
    expect(psychePlaybook).toMatch(
      /schema theme[\s\S]*belief_entry[\s\S]*behavior_pattern[\s\S]*mode_profile/i
    );
    expect(psychePlaybook).toMatch(
      /wiki_page[\s\S]*durable explanation of a schema theme/i
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
    expect(entityPlaybook).toMatch(/## Route posture checkpoint/i);
    expect(entityPlaybook).toMatch(
      /Normal stored Forge entities use the shared batch entity routes by default/i
    );
    expect(entityPlaybook).toMatch(
      /wiki_page[\s\S]*calendar_connection[\s\S]*specialized CRUD areas/i
    );
    expect(entityPlaybook).toMatch(
      /task_run[\s\S]*work_adjustment[\s\S]*questionnaire_run[\s\S]*preference_judgment[\s\S]*preference_signal[\s\S]*self_observation[\s\S]*action workflows/i
    );
    expect(entityPlaybook).toMatch(
      /Do not ask route-neutral reflective questions[\s\S]*action path is already obvious/i
    );
    expect(entityPlaybook).toMatch(
      /preference_judgment[\s\S]*POST \/api\/v1\/preferences\/judgments[\s\S]*not batch\s+CRUD/i
    );
    expect(entityPlaybook).toMatch(
      /preference_signal[\s\S]*POST \/api\/v1\/preferences\/signals[\s\S]*not batch\s+CRUD/i
    );
    expect(entityPlaybook).toMatch(
      /preference_catalog[\s\S]*normal stored Preferences CRUD/i
    );
    expect(entityPlaybook).toMatch(
      /preference_catalog_item[\s\S]*normal stored Preferences CRUD/i
    );
    expect(entityPlaybook).toMatch(
      /preference_context[\s\S]*normal stored Preferences CRUD/i
    );
    expect(entityPlaybook).toMatch(
      /preference_item[\s\S]*normal stored Preferences CRUD/i
    );
    expect(entityPlaybook).toMatch(
      /questionnaire_instrument[\s\S]*normal stored CRUD/i
    );
    expect(entityPlaybook).toMatch(
      /questionnaire_run[\s\S]*action workflow/i
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
      ["Trigger Report", /what happened in that moment/i, /emotionally meaningful episode/i],
      ["Event Type", /keeps happening/i, /emotionally meaningful kind of moment/i],
      ["Emotion Definition", /not a nearby one/i, /lived signature/i]
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
    expect(psychePlaybook).toMatch(/feel less alone with the experience/i);
    expect(psychePlaybook).toMatch(/more\s+able to name it/i);
    expect(psychePlaybook).toMatch(/Contain:/);
    expect(psychePlaybook).toMatch(
      /makes the moment feel holdable before you deepen or name it/i
    );
    expect(psychePlaybook).toMatch(
      /Do not ask for evidence, alternative beliefs, or repair plans before the user has had/i
    );
    expect(psychePlaybook).toMatch(
      /moment is still hot[\s\S]*painful, dangerous, or protective/i
    );
    expect(psychePlaybook).toMatch(
      /If the user already gives the new sentence in usable language,[\s\S]*revise the wording[\s\S]*once and save/i
    );
    expect(psychePlaybook).toMatch(/## Therapeutic turn shapes/i);
    expect(psychePlaybook).toMatch(/## Name, Define, Connect/i);
    expect(psychePlaybook).toMatch(/Do not make the user prove the experience/i);
    expect(psychePlaybook).toMatch(
      /Do not widen into adjacent entities until the current one has a working sentence/i
    );
    expect(psychePlaybook).toMatch(/## Update micro-openers/i);
    expect(psychePlaybook).toMatch(
      /Something about the old wording no longer holds the whole experience/i
    );
    expect(psychePlaybook).toMatch(
      /same pain, but not quite the same meaning/i
    );
    expect(psychePlaybook).toMatch(
      /clearer[\s\S]*language,[\s\S]*better understanding,[\s\S]*next-step help/i
    );
    expect(psychePlaybook).toMatch(/If the user says it lands, move toward the write/i);
    expect(psychePlaybook).toMatch(/name the core meaning in the user's language/i);
  });
});

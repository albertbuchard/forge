import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");

function readRepoFile(relativePath: string) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const entityPlaybook = readRepoFile(
  "plugins/openclaw/skills/forge-openclaw/entity_conversation_playbooks.md"
);
const psychePlaybook = readRepoFile(
  "plugins/openclaw/skills/forge-openclaw/psyche_entity_playbooks.md"
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
      ["Task", /next concrete move here/i, /one-session work item/i],
      ["Habit", /strengthen or interrupt/i, /honest check-in/i],
      ["Tag", /help you notice or find again later/i, /inside versus outside/i],
      ["Note", /worth preserving in a note/i, /durable or temporary/i],
      ["Wiki Page", /remember or reuse later/i, /durable memory/i],
      ["Artifact", /find, prove, review, or preserve later/i, /trusted file/i],
      ["Insight", /future-you or the agent/i, /practical recommendation/i],
      ["Calendar Event", /what time should Forge hold/i, /timezone/i],
      ["Work Block Template", /when should this recurring block repeat/i, /allows or blocks work/i],
      ["Task Timebox", /reserve focused time/i, /planned work with completed work/i],
      ["Task Run", /Which task should I start/i, /Start the run instead of turning it into intake/i],
      ["Work Adjustment", /time correction belong to/i, /truthfully/i],
      ["Operator Overview", /understand about Forge overall/i, /read-model-only operator surface/i],
      ["Operator Context", /current work, risk, or next move/i, /read-model-only operator surface/i],
      ["Self Observation", /what happened in the situation/i, /situation, cue, emotion\/body, thought\/meaning, behavior\/urge, and consequence/i],
      ["Sleep Session", /important enough to remember or connect/i, /reflective takeaway/i],
      ["Workout Session", /most worth remembering or connecting/i, /subjective effort, mood, meaning/i],
      ["Sleep Overview", /understand from your sleep picture/i, /read-model-only surface/i],
      ["Sports Overview", /understand from your workout picture/i, /read-model-only surface/i],
      ["Training Load", /training-load decision/i, /read-model-only/i],
      ["Weight Loss", /food-body link/i, /dedicated nutrition/i],
      ["Calendar Overview", /understand or decide from your calendar picture/i, /read-model-only calendar surface/i],
      ["Calendar Connection", /workflow do you want this calendar connection to unlock/i, /provider/i],
      ["Preference Judgment", /comparison are you actually trying to settle/i, /pairwise preference decision/i],
      ["Preference Signal", /remember about this item right now/i, /favorite, veto, bookmark,[\s\S]*compare-later/i],
      ["Movement", /understand, correct, or preserve/i, /timeline[\s\S]*overlay[\s\S]*repair/i],
      ["Life Events", /place on your life timeline/i, /chronology[\s\S]*calendar[\s\S]*ticket/i],
      ["Life Force", /energy picture right now/i, /dedicated life-force path/i],
      ["Workbench", /inspect, change, run, or publish/i, /dedicated workbench route family/i],
      ["Preference Catalog", /decision or taste question should this catalog help with/i, /comparison pool/i],
      ["Preference Catalog Item", /meaningfully worth comparing/i, /clear and fair/i],
      ["Preference Context", /treat your preferences differently here/i, /inside versus outside/i],
      ["Preference Item", /make clearer by saving this item/i, /favorite, veto, or compare-later/i],
      ["Questionnaire Instrument", /honest moment or decision/i, /reusable questionnaire/i],
      ["Questionnaire Run", /start, continue, review, or finish this run/i, /next answer or note that matters/i]
    ] as const;

    for (const [section, opening, purpose] of scenarios) {
      const sectionSlice = getSectionSlice(entityPlaybook, section);
      expect(sectionSlice, `${section} should exist`).toContain(`## ${section}`);
      expect(sectionSlice, `${section} should have an opening question`).toMatch(opening);
      expect(sectionSlice, `${section} should state the job of the record`).toMatch(
        purpose
      );
    }
    expect(getSectionSlice(entityPlaybook, "Artifact")).toMatch(
      /OpenAPI documents human-only download and encryption paths[\s\S]*intentionally absent from `forge_call_artifact_route`[\s\S]*must not be called by agents/i
    );
  });

  it("keeps the shared stance centered on guided clarification instead of form filling", () => {
    expect(entityPlaybook).toMatch(
      /Start by saying what seems to matter here or what the record is becoming/i
    );
    expect(entityPlaybook).toMatch(
      /After each substantive answer, briefly say what is becoming clearer/i
    );
    expect(entityPlaybook).toMatch(/## Turn shapes/i);
    expect(entityPlaybook).toMatch(/## Active-listening turn contract/i);
    expect(entityPlaybook).toMatch(
      /Reflect the specific stake, working shape, or product object/i
    );
    expect(entityPlaybook).toMatch(
      /wording, boundary, placement, timing,[\s\S]*route scope,[\s\S]*support action,[\s\S]*verification read,[\s\S]*preservation choice,[\s\S]*consent/i
    );
    expect(entityPlaybook).toMatch(
      /For Movement, Life Events, Life Force, and Workbench,[\s\S]*movement span, place boundary, Life Event, calendar match, ticket artifact, travel status, weekday curve, fatigue signal, flow, run, node output/i
    );
    expect(entityPlaybook).toMatch(/## Second-turn discipline/i);
    expect(entityPlaybook).toMatch(
      /After the user answers the opening question[\s\S]*choose exactly one next lane/i
    );
    expect(entityPlaybook).toMatch(
      /record\s+shape, route choice, useful wording, timing, or links/i
    );
    expect(entityPlaybook).toMatch(/## Depth calibration/i);
    expect(entityPlaybook).toMatch(
      /Quick capture:[\s\S]*usable wording[\s\S]*one structural, accuracy, or consent detail/i
    );
    expect(entityPlaybook).toMatch(
      /Guided formulation:[\s\S]*understand, name, map, decide, or work[\s\S]*Psyche hypotheses/i
    );
    expect(entityPlaybook).toMatch(
      /Review-first:[\s\S]*Read the relevant stored entity, overview, or specialized surface/i
    );
    expect(entityPlaybook).toMatch(
      /Action-first:[\s\S]*task run[\s\S]*Movement correction[\s\S]*Life Event calendar sync, ticket import, or\s+status read[\s\S]*Life Force signal\/template[\s\S]*Workbench\s+run\/output/i
    );
    expect(entityPlaybook).toMatch(
      /Do not downgrade psychologically meaningful material into quick capture/i
    );
    expect(entityPlaybook).toMatch(
      /Replace "that sounds\s+important"[\s\S]*surface,[\s\S]*CRUD,[\s\S]*payload/i
    );
    expect(entityPlaybook).toMatch(/Middle turn:/i);
    expect(entityPlaybook).toMatch(/Closing turn:/i);
    expect(entityPlaybook).toMatch(/One focused question is the default/i);
    expect(entityPlaybook).toMatch(
      /do not bundle name, scope, and timing into one opener/i
    );
    expect(entityPlaybook).toMatch(/route-changing missing detail\s+first/i);
    expect(entityPlaybook).toMatch(
      /The first question should usually clarify lived meaning, use, stake, or timing/i
    );
    expect(entityPlaybook).toMatch(
      /Before asking, decide the API posture internally/i
    );
    expect(entityPlaybook).toMatch(
      /Do not let API uncertainty leak out as vague wording/i
    );
    expect(entityPlaybook).toMatch(
      /Do not use vague reflective filler[\s\S]*tell me more about that[\s\S]*concrete\s+target, span, object, wording, or correction[\s\S]*one question that would change the save, read, run, link, or update/i
    );
    expect(entityPlaybook).toMatch(/## Dedicated surface lane translation/i);
    expect(entityPlaybook).toMatch(/## Dedicated surface route fallback/i);
    expect(entityPlaybook).toMatch(
      /route-key tool is unavailable, stale, or lacks the needed route key[\s\S]*exact `methodRoutes` entry/i
    );
    expect(entityPlaybook).toMatch(
      /Do not fall back to generic batch CRUD for Movement, Life Events, Life Force, or Workbench/i
    );
    expect(entityPlaybook).toMatch(
      /tool schema, live onboarding, and OpenAPI disagree[\s\S]*contract bug/i
    );
    expect(entityPlaybook).toMatch(/## Route execution handoff/i);
    expect(entityPlaybook).toMatch(
      /Freeze the accepted user-facing formulation or target object/i
    );
    expect(entityPlaybook).toMatch(
      /Choose exactly one execution lane:[\s\S]*shared batch CRUD,[\s\S]*specialized CRUD,[\s\S]*action\s+workflow,[\s\S]*read-model route,[\s\S]*specialized domain route/i
    );
    expect(entityPlaybook).toMatch(
      /For shared batch CRUD,[\s\S]*catalog `entityType`[\s\S]*\/api\/v1\/entities\/search[\s\S]*\/api\/v1\/entities\/create[\s\S]*\/api\/v1\/entities\/update[\s\S]*\/api\/v1\/entities\/delete[\s\S]*\/api\/v1\/entities\/restore/i
    );
    expect(entityPlaybook).toMatch(
      /Movement, Life Events, Life Force, and Workbench,[\s\S]*`routeKey`, method, path,[\s\S]*`methodRoutes`[\s\S]*`pathParams`/i
    );
    expect(entityPlaybook).toMatch(
      /Do not put IDs into `routeKey`, hide placeholders in `query` or `body`,\s+or use nearby guessed paths/i
    );
    expect(entityPlaybook).toMatch(/## Internal action trace, external wording/i);
    expect(entityPlaybook).toMatch(
      /private action trace:[\s\S]*intent,[\s\S]*entity or dedicated\s+domain lane,[\s\S]*exact read\/write\/run tool/i
    );
    expect(entityPlaybook).toMatch(/Do not narrate that trace to the user/i);
    expect(entityPlaybook).toMatch(/## Known-target fast path/i);
    expect(entityPlaybook).toMatch(
      /already name the object, action, and likely route lane/i
    );
    expect(entityPlaybook).toMatch(
      /task hierarchy[\s\S]*project, issue, or parent task/i
    );
    expect(entityPlaybook).toMatch(
      /Movement[\s\S]*missing interval, boundary, saved\s+object, or\s+confirmation/i
    );
    expect(entityPlaybook).toMatch(
      /Life Force[\s\S]*weekday\/time shape, profile field, signal\s+intensity, or planning effect/i
    );
    expect(entityPlaybook).toMatch(
      /Workbench[\s\S]*flow, run, node, input, output, or\s+preservation choice/i
    );
    expect(entityPlaybook).toMatch(
      /direct Psyche saves[\s\S]*accuracy or consent question instead of restarting\s+exploration/i
    );
    expect(entityPlaybook).toMatch(
      /saved the belief,[\s\S]*corrected the missing stay,[\s\S]*updated the weekday energy pattern,[\s\S]*read the failed\s+node/i
    );
    expect(entityPlaybook).toMatch(
      /route\s+choice is an internal classification step, not a user-facing menu/i
    );
    expect(entityPlaybook).toMatch(
      /Translate "day, month, all-time, timeline, trip detail, or selection"/i
    );
    expect(entityPlaybook).toMatch(
      /Translate "overview, profile, weekdayTemplate, or fatigueSignal"/i
    );
    expect(entityPlaybook).toMatch(
      /Translate "listFlows, boxCatalog, runDetail, nodeResult, latestNodeOutput, or\s+publishedOutput"/i
    );
    expect(entityPlaybook).toMatch(
      /Avoid generic reflections such as "that sounds important"/i
    );
    expect(entityPlaybook).toMatch(
      /route key,[\s\S]*batch route,[\s\S]*endpoint[\s\S]*missing\s+stay/i
    );
    expect(entityPlaybook).toMatch(
      /If you cannot\s+name the product noun yet,[\s\S]*ask one grounding question/i
    );
    expect(entityPlaybook).toMatch(
      /For updates,[\s\S]*smallest thing[\s\S]*newly visible/i
    );
    expect(entityPlaybook).toMatch(
      /## Progressive disclosure after partial answers/i
    );
    expect(entityPlaybook).toMatch(
      /Treat partial answers as progress[\s\S]*operation, entity or surface, target record,[\s\S]*time span, working wording, owner or placement, route lane, and consent/i
    );
    expect(entityPlaybook).toMatch(
      /first missing detail that[\s\S]*would\s+change the action:[\s\S]*duplicate disambiguation[\s\S]*hierarchy parent[\s\S]*flow, run, node/i
    );
    expect(entityPlaybook).toMatch(
      /do not ask for tags, priority, status, color, links,\s+dates, or assignees/i
    );
    expect(entityPlaybook).toMatch(
      /skip the route-family question[\s\S]*target span, place, event, artifact, weekday, profile field, flow, run, node, output, correction, or\s+consent/i
    );
    expect(psychePlaybook).toMatch(/## Psyche progressive disclosure/i);
    expect(psychePlaybook).toMatch(/## Psyche depth calibration/i);
    expect(psychePlaybook).toMatch(
      /## Psyche active-listening turn contract/i
    );
    expect(psychePlaybook).toMatch(
      /Reflect the specific felt stake or protective move[\s\S]*danger, shame,[\s\S]*protection, relief, cost, or value conflict/i
    );
    expect(psychePlaybook).toMatch(
      /belief sentence,[\s\S]*functional loop,[\s\S]*mode voice,[\s\S]*trigger sequence,[\s\S]*emotion signature,[\s\S]*flashcard cue/i
    );
    expect(psychePlaybook).toMatch(
      /tentative hypothesis and one fit-or-correction question instead of asking another\s+broad exploratory question/i
    );
    expect(psychePlaybook).toMatch(/## Hypothesis versus reflection gate/i);
    expect(psychePlaybook).toMatch(
      /another broad question would make them\s+carry the interpretation alone/i
    );
    expect(psychePlaybook).toMatch(
      /change the saveable wording, primary Psyche\s+container, likely links, flashcard\/support action, or next question/i
    );
    expect(psychePlaybook).toMatch(
      /Direct save:[\s\S]*belief sentence[\s\S]*functional loop[\s\S]*ask one accuracy or consent question/i
    );
    expect(psychePlaybook).toMatch(
      /Guided formulation:[\s\S]*pattern, mode, belief,[\s\S]*schema theme[\s\S]*testable hypothesis/i
    );
    expect(psychePlaybook).toMatch(
      /Do not use quick capture to minimize functional analysis, triggers, behavior\s+patterns, modes, beliefs, or schemas/i
    );
    expect(psychePlaybook).toMatch(
      /offered belief sentence, value phrase, part voice, urge sentence, trigger\s+episode, event kind, emotion signature, or functional loop/i
    );
    expect(psychePlaybook).toMatch(
      /ask one accuracy or consent\s+question instead of reopening origin, evidence, or repair/i
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
    expect(entityPlaybook).toMatch(/## Mixed-intent sequencing/i);
    expect(entityPlaybook).toMatch(
      /review this and\s+fix it[\s\S]*save the pattern and make me a card[\s\S]*inspect the run and publish the\s+output/i
    );
    expect(entityPlaybook).toMatch(/## Post-read synthesis/i);
    expect(entityPlaybook).toMatch(
      /After a review, overview, navigation, or specialized read returns data/i
    );
    expect(entityPlaybook).toMatch(/## Review-before-write checkpoint/i);
    expect(entityPlaybook).toMatch(
      /Use this when the user asks to review, guide, inspect, compare, or understand before\s+changing anything/i
    );
    expect(entityPlaybook).toMatch(
      /shared batch search or read hints[\s\S]*wiki\/calendar dedicated reads[\s\S]*read-model routes[\s\S]*Movement, Life Events, Life Force, or Workbench dedicated reads/i
    );
    expect(entityPlaybook).toMatch(
      /After the read, answer the practical question[\s\S]*before asking for\s+any write detail/i
    );
    expect(entityPlaybook).toMatch(
      /If the read produces several possible actions[\s\S]*do not hand the user a broad menu/i
    );
    expect(entityPlaybook).toMatch(
      /If the answer does not create a concrete next action, close cleanly/i
    );
    expect(entityPlaybook).toMatch(
      /Ask a follow-up only if it changes the next action:[\s\S]*save, update, correct, link,\s+schedule, run, publish, enrich, or open the UI/i
    );
    expect(entityPlaybook).toMatch(
      /Movement, Life Events, Life Force, Workbench, calendar, health, and operator overviews/i
    );
    expect(entityPlaybook).toMatch(
      /For Psyche-adjacent reads,[\s\S]*Psyche formulation, a flashcard, a note, a task, a habit, or no\s+write at all/i
    );
    expect(entityPlaybook).toMatch(
      /Movement timeline or box\s+detail comes before correction[\s\S]*Workbench run or node detail comes before editing[\s\S]*Life Force overview comes before changing planning\s+assumptions/i
    );
    expect(entityPlaybook).toMatch(
      /current truth is uncertain[\s\S]*Movement timeline, saved-box, trip, place, or settings[\s\S]*Life Force overview[\s\S]*Workbench flow, run, node, latest\s+output, or published-output/i
    );
    expect(entityPlaybook).toMatch(
      /After that read,[\s\S]*missing detail[\s\S]*correction,[\s\S]*planning effect,[\s\S]*rerun,[\s\S]*edit,[\s\S]*publish,[\s\S]*preservation choice/i
    );
    expect(entityPlaybook).toMatch(
      /formulate the\s+Psyche record first[\s\S]*flashcard, note, value link, task, or habit/i
    );
    expect(entityPlaybook).toMatch(/## Search-before-write and existing-record disambiguation/i);
    expect(entityPlaybook).toMatch(
      /search the shared batch route by entity type[\s\S]*title or wording[\s\S]*owner[\s\S]*distinctive content/i
    );
    expect(entityPlaybook).toMatch(
      /update that record, link to it, or become a separate new record/i
    );
    expect(entityPlaybook).toMatch(
      /For Movement, Life Events, Life Force, and Workbench,[\s\S]*dedicated read lane/i
    );
    expect(entityPlaybook).toMatch(/## Destructive and replacement actions/i);
    expect(entityPlaybook).toMatch(
      /delete, archive, invalidate, overwrite, replace,[\s\S]*disconnect/i
    );
    expect(entityPlaybook).toMatch(
      /For Psyche records,[\s\S]*updated, linked as history, archived, or kept distinct/i
    );
    expect(entityPlaybook).toMatch(
      /Movement repair,[\s\S]*user-defined overlay[\s\S]*automatic box[\s\S]*stay, trip, or point/i
    );
  });

  it("keeps abstract and reusable records grounded in future use before label wording", () => {
    expect(entityPlaybook).toMatch(/## Abstract And Reusable Record Moves/);
    expect(entityPlaybook).toMatch(/## Reflection-sensitive non-Psyche records/);
    expect(entityPlaybook).toMatch(
      /questionnaire_instrument[\s\S]*questionnaire_run[\s\S]*self_observation[\s\S]*sleep_session[\s\S]*workout_session/i
    );
    expect(entityPlaybook).toMatch(
      /what the reflection should help the user understand, decide,\s+notice, remember, or change later/i
    );
    expect(entityPlaybook).toMatch(
      /Do not turn answer collection into generic Psyche intake[\s\S]*belief, mode, trigger report, or behavior pattern clearly emerges/i
    );
    expect(entityPlaybook).toMatch(
      /questionnaire_instrument[\s\S]*shared batch routes[\s\S]*questionnaire_run[\s\S]*questionnaire run actions[\s\S]*self_observation[\s\S]*note-backed[\s\S]*wiki_page[\s\S]*wiki routes/i
    );
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
      /After a Movement read, translate the returned data into one next action[\s\S]*manual overlay[\s\S]*place boundary correction[\s\S]*settings change[\s\S]*linked note/i
    );
    expect(entityPlaybook).toMatch(
      /preserve movement context with another Forge record[\s\S]*do\s+not invent a movement-link route[\s\S]*dedicated Movement read or selection[\s\S]*normal linked `note`[\s\S]*`\/api\/v1\/entities\/create` or `\/api\/v1\/entities\/update`/i
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
    expect(entityPlaybook).toMatch(
      /planning decision[\s\S]*workload[\s\S]*recovery[\s\S]*timebox/i
    );
    expect(entityPlaybook).toMatch(
      /After a Life Force overview, translate the read into one planning implication[\s\S]*lighter workload[\s\S]*added recovery[\s\S]*protected timebox/i
    );
    expect(entityPlaybook).toMatch(
      /only needs an explanation or planning read[\s\S]*overview first/i
    );
    expect(entityPlaybook).toMatch(
      /overview route key is `overview`[\s\S]*GET \/api\/v1\/life-force[\s\S]*Do not invent `\/api\/v1\/life-force\/overview`/i
    );
    expect(entityPlaybook).toMatch(/debugging one failed run|debug one failed execution/i);
    expect(entityPlaybook).toMatch(/run[\s\S]*summary/i);
    expect(entityPlaybook).toMatch(/latest node output/i);
    expect(entityPlaybook).toMatch(/published output/i);
    expect(entityPlaybook).toMatch(
      /After a Workbench read, translate the returned artifact into one next action[\s\S]*rerun with clearer input[\s\S]*inspect a specific node[\s\S]*publish or\s+preserve the output/i
    );
    expect(entityPlaybook).toMatch(
      /flow catalog questions[\s\S]*GET \/api\/v1\/workbench\/flows[\s\S]*available box\s+inputs[\s\S]*GET \/api\/v1\/workbench\/catalog\/boxes/i
    );
    expect(entityPlaybook).toMatch(
      /For new flows,[\s\S]*what the flow should reliably produce[\s\S]*input contract[\s\S]*first node or box/i
    );
    expect(entityPlaybook).toMatch(
      /one-off execution[\s\S]*temporary[\s\S]*durable[\s\S]*POST \/api\/v1\/workbench\/run/i
    );
    expect(entityPlaybook).toMatch(
      /do not create a saved flow unless the user wants reuse/i
    );
    expect(entityPlaybook).toMatch(
      /For flow edits,[\s\S]*what behavior should change[\s\S]*public contract stays\s+stable/i
    );
    expect(entityPlaybook).toMatch(
      /For flow deletion,[\s\S]*confirm the saved flow[\s\S]*published outputs or run\s+history/i
    );
    expect(entityPlaybook).toMatch(
      /Treat day, month, all-time, timeline, trip detail, and selection as internal read\s+lanes/i
    );
    expect(entityPlaybook).toMatch(
      /settings as a separate movement lane[\s\S]*passive capture[\s\S]*publish mode[\s\S]*retention/i
    );
    expect(entityPlaybook).toMatch(
      /place creation or cleanup[\s\S]*label[\s\S]*boundary[\s\S]*future use/i
    );
    expect(entityPlaybook).toMatch(
      /dedicated place routes[\s\S]*not a tag or batch entity write/i
    );
    expect(entityPlaybook).toMatch(/GET \/api\/v1\/movement\/settings/);
    expect(entityPlaybook).toMatch(/PATCH \/api\/v1\/movement\/settings/);
    expect(entityPlaybook).toMatch(
      /Treat overview, profile, weekday-template, and fatigue-signal lanes as internal\s+route choices/i
    );
    expect(entityPlaybook).toMatch(
      /Treat saved-flow catalog, box catalog, run history, run detail, node result, latest\s+node output, and published output as internal read lanes/i
    );
    expect(entityPlaybook).toMatch(/POST \/api\/v1\/workbench\/flows/);
    expect(entityPlaybook).toMatch(/PATCH \/api\/v1\/workbench\/flows\/:id/);
    expect(entityPlaybook).toMatch(/DELETE \/api\/v1\/workbench\/flows\/:id/);
    expect(entityPlaybook).toMatch(
      /inspect one already-saved movement correction before editing/i
    );
    expect(entityPlaybook).toMatch(/DELETE \/api\/v1\/movement\/user-boxes\/:id/i);
    expect(entityPlaybook).toMatch(/send one follow-up message into a saved flow chat/i);
    expect(entityPlaybook).toMatch(/POST \/api\/v1\/workbench\/flows\/:id\/chat/);
    expect(entityPlaybook).toMatch(
      /flow chat follow-ups[\s\S]*new flow\s+run, note, or generic entity update/i
    );
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
      /Use the wiki tools and[\s\S]*\/api\/v1\/wiki\/pages[\s\S]*family/i
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
    expect(psychePlaybook).toMatch(/## Psyche API Posture/i);
    expect(psychePlaybook).toMatch(
      /Psyche records[\s\S]*normal stored Forge\s+entities for API purposes/i
    );
    expect(psychePlaybook).toMatch(
      /shared batch entity routes[\s\S]*psyche_value[\s\S]*emotion_definition/i
    );
    expect(psychePlaybook).toMatch(
      /Keep the route decision internal[\s\S]*lived moment/i
    );
    expect(psychePlaybook).toMatch(
      /schema theme[\s\S]*belief_entry[\s\S]*behavior_pattern[\s\S]*mode_profile/i
    );
    expect(psychePlaybook).toMatch(/Hypotheses are not decorative reassurance/i);
    expect(psychePlaybook).toMatch(
      /Do not make the user supply every interpretation alone/i
    );
    expect(psychePlaybook).toMatch(
      /understanding plus an immediate support action[\s\S]*formulate the primary Psyche record first[\s\S]*derive the support action/i
    );
    expect(psychePlaybook).toMatch(
      /behavior_pattern[\s\S]*flashcard[\s\S]*belief_entry[\s\S]*counter-message[\s\S]*trigger_report[\s\S]*event_type[\s\S]*emotion_definition/i
    );
    expect(psychePlaybook).toMatch(
      /similar Psyche record[\s\S]*update the existing record, link to it, or stand as a distinct new version/i
    );
    expect(psychePlaybook).toMatch(
      /beliefs,[\s\S]*sentence[\s\S]*patterns,[\s\S]*cue,[\s\S]*payoff,[\s\S]*cost[\s\S]*flashcards,[\s\S]*urge sentence and message/i
    );
    expect(psychePlaybook).toMatch(
      /destructive or replacement requests[\s\S]*preserve therapeutic history/i
    );
    expect(psychePlaybook).toMatch(
      /Do not delete a\s+Psyche record merely because a cleaner formulation now exists/i
    );
    expect(psychePlaybook).toMatch(/## Hypothesis To Record Bridge/i);
    expect(psychePlaybook).toMatch(
      /Once a hypothesis lands or is corrected[\s\S]*saveable Forge shape/i
    );
    expect(psychePlaybook).toMatch(
      /Name what the hypothesis is becoming:[\s\S]*belief sentence[\s\S]*functional loop[\s\S]*mode[\s\S]*trigger report/i
    );
    expect(psychePlaybook).toMatch(
      /Do not leave the user with interpretation alone[\s\S]*name the primary Forge record[\s\S]*accuracy or consent\s+question/i
    );
    expect(psychePlaybook).toMatch(
      /nearest saveable shape:[\s\S]*belief sentence[\s\S]*functional loop[\s\S]*part voice[\s\S]*trigger chain[\s\S]*emotion signature/i
    );
    expect(psychePlaybook).toMatch(
      /wiki_page[\s\S]*durable explanation of a schema theme/i
    );
    expect(entityPlaybook).toMatch(
      /do not ask a broad review question again[\s\S]*then act/i
    );
    expect(getSectionSlice(entityPlaybook, "Event Type")).toMatch(
      /Psyche taxonomy[\s\S]*emotionally meaningful moment[\s\S]*shared batch CRUD/i
    );
    expect(getSectionSlice(entityPlaybook, "Emotion Definition")).toMatch(
      /Psyche taxonomy[\s\S]*lived signature[\s\S]*shared batch CRUD/i
    );
    expect(entityPlaybook).toMatch(
      /what would make the comparison confusing or unfair if the label stayed as-is/i
    );
    expect(entityPlaybook).toMatch(
      /what would make the instrument distinct instead of redundant/i
    );
    expect(entityPlaybook).toMatch(
      /what the answers should help the respondent understand or choose/i
    );
    expect(entityPlaybook).toMatch(
      /item shape, response scale, scoring, or provenance only after the purpose/i
    );
    expect(entityPlaybook).toMatch(/## Route posture checkpoint/i);
    expect(entityPlaybook).toMatch(
      /Normal stored Forge entities use the shared batch entity routes by default/i
    );
    expect(entityPlaybook).toMatch(
      /Every normal entity section below inherits that batch-route default/i
    );
    expect(entityPlaybook).toMatch(
      /If the tool schema and live onboarding disagree[\s\S]*contract mismatch/i
    );
    expect(entityPlaybook).toMatch(
      /wiki_page[\s\S]*calendar_connection[\s\S]*specialized CRUD areas/i
    );
    expect(entityPlaybook).toMatch(
      /calendar_connection[\s\S]*specialized CRUD surface[\s\S]*POST \/api\/v1\/calendar\/discovery[\s\S]*GET \/api\/v1\/calendar\/macos-local\/discovery/i
    );
    expect(entityPlaybook).toMatch(
      /PATCH \/api\/v1\/calendar\/connections\/:id[\s\S]*DELETE \/api\/v1\/calendar\/connections\/:id/i
    );
    expect(entityPlaybook).toMatch(
      /task_run[\s\S]*work_adjustment[\s\S]*questionnaire_run[\s\S]*preference_judgment[\s\S]*preference_signal[\s\S]*self_observation[\s\S]*action workflows/i
    );
    expect(entityPlaybook).toMatch(
      /sleep_overview[\s\S]*read-model-only health surface|read-model-only health surface[\s\S]*sleep_overview/i
    );
    expect(entityPlaybook).toMatch(
      /sports_overview[\s\S]*read-model-only health surface|read-model-only health surface[\s\S]*sports_overview/i
    );
    expect(entityPlaybook).toMatch(
      /weight_loss[\s\S]*health read model plus dedicated nutrition write workflow/i
    );
    expect(entityPlaybook).toMatch(
      /operator_overview[\s\S]*read-model-only operator surface|read-model-only operator surface[\s\S]*operator_overview/i
    );
    expect(entityPlaybook).toMatch(
      /operator_context[\s\S]*read-model-only operator surface|read-model-only operator surface[\s\S]*operator_context/i
    );
    expect(entityPlaybook).toMatch(
      /calendar_overview[\s\S]*read-model-only calendar surface|read-model-only calendar surface[\s\S]*calendar_overview/i
    );
    expect(entityPlaybook).toMatch(/forge_get_sleep_overview/);
    expect(entityPlaybook).toMatch(/forge_get_sports_overview/);
    expect(entityPlaybook).toMatch(/forge_get_weight_loss_overview/);
    expect(entityPlaybook).toMatch(/forge_get_operator_overview/);
    expect(entityPlaybook).toMatch(/forge_get_operator_context/);
    expect(entityPlaybook).toMatch(/forge_get_calendar_overview/);
    expect(entityPlaybook).toMatch(
      /task_run[\s\S]*\/api\/v1\/tasks\/:id\/runs[\s\S]*\/api\/v1\/task-runs\/:id\/heartbeat/i
    );
    expect(entityPlaybook).toMatch(
      /self_observation[\s\S]*\/api\/v1\/psyche\/self-observation\/calendar/i
    );
    expect(entityPlaybook).toMatch(
      /questionnaire_instrument[\s\S]*\/api\/v1\/psyche\/questionnaires[\s\S]*\/:id\/draft[\s\S]*\/:id\/publish/i
    );
    expect(entityPlaybook).toMatch(
      /questionnaire_run[\s\S]*\/api\/v1\/psyche\/questionnaires\/:id\/runs[\s\S]*\/api\/v1\/psyche\/questionnaire-runs\/:id\/complete/i
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

  it("keeps owner and user-scope questions late, purposeful, and multi-user aware", () => {
    const skill = readRepoFile("plugins/openclaw/skills/forge-openclaw/SKILL.md");
    const onboardingSource = readRepoFile("apps/api/src/app.ts");

    expect(entityPlaybook).toMatch(/## Owner And User-Scope Checkpoint/);
    expect(entityPlaybook).toMatch(
      /Most normal stored Forge entities can carry `userId`[\s\S]*human or bot assignees/i
    );
    expect(entityPlaybook).toMatch(
      /Do not open with "who owns this\?"[\s\S]*explicitly delegating/i
    );
    expect(entityPlaybook).toMatch(
      /ownership changes accountability,\s+visibility,\s+review scope,\s+automation behavior,\s+or later filtering/i
    );
    expect(entityPlaybook).toMatch(
      /For reviews and overviews,[\s\S]*user or owner scope[\s\S]*answer would change across humans or bots/i
    );
    expect(entityPlaybook).toMatch(
      /When owner scope is irrelevant,[\s\S]*meaning,\s+timing,\s+route,\s+or\s+links/i
    );
    expect(skill).toMatch(
      /Treat `userId` and human\/bot assignees as accountability and scope/i
    );
    expect(onboardingSource).toMatch(
      /Treat userId, owner, and human\/bot assignees as accountability and scope/i
    );
    expect(onboardingSource).toMatch(
      /For read and overview requests,[\s\S]*human or bot user scope[\s\S]*differ across owners/i
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
      ["Flashcard", /exact urge sentence or situation/i, /one simple message/i],
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
      /active listening, not just mirroring[\s\S]*names what seems at stake[\s\S]*keeps the hypothesis correctable/i
    );
    expect(psychePlaybook).toMatch(
      /Do not drift into vague supportive filler[\s\S]*concrete moment, belief\s+sentence, cue, mode voice, body signal, or trigger sequence[\s\S]*one question that would change the\s+belief, loop, mode, trigger report, flashcard cue, emotion signature, link, or save\s+confirmation/i
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
    expect(psychePlaybook).toMatch(/## Interpretive Hypotheses/i);
    expect(psychePlaybook).toMatch(
      /Do not minimize functional analysis, trigger chains, behavior patterns, modes,\s+beliefs, or schema themes/i
    );
    expect(psychePlaybook).toMatch(
      /After at least one concrete example is clear, offer one tentative interpretive\s+hypothesis/i
    );
    expect(psychePlaybook).toMatch(
      /what the response protects,[\s\S]*what danger it predicts,[\s\S]*what belief or mode may be active/i
    );
    expect(psychePlaybook).toMatch(/## Hypothesis Wording Shape/i);
    expect(psychePlaybook).toMatch(/evidence in the user's own example/i);
    expect(psychePlaybook).toMatch(/Name the function without blame/i);
    expect(psychePlaybook).toMatch(/Ask for correction/i);
    expect(psychePlaybook).toMatch(/Does that fit, or is the danger\/need somewhere else/i);
    expect(psychePlaybook).toMatch(/## Hypothesis Without Cross-Examination/i);
    expect(psychePlaybook).toMatch(/reduce the user's burden of formulation/i);
    expect(psychePlaybook).toMatch(
      /Avoid following a\s+hypothesis with a stack of questions about evidence, origin, and repair/i
    );
    expect(psychePlaybook).toMatch(
      /smallest lived cue or contrast that\s+would change the formulation/i
    );
    expect(psychePlaybook).toMatch(
      /If the user rejects the hypothesis, accept the correction and revise once/i
    );
    expect(psychePlaybook).toMatch(/## Hypothesis Timing Checkpoint/i);
    expect(psychePlaybook).toMatch(
      /before asking a second or third deepening question/i
    );
    expect(psychePlaybook).toMatch(
      /one concrete episode, body cue, belief sentence, behavior, or\s+mode voice/i
    );
    expect(psychePlaybook).toMatch(
      /would change the record shape, wording, links, or next action/i
    );
    expect(psychePlaybook).toMatch(
      /Do not offer a hypothesis yet[\s\S]*no concrete moment is visible[\s\S]*direct mechanical save[\s\S]*flooded, unsafe/i
    );
    expect(psychePlaybook).toMatch(
      /rejects it without offering a\s+replacement[\s\S]*one contrast that would disconfirm the hypothesis/i
    );
    expect(psychePlaybook).toMatch(
      /moment is still hot[\s\S]*painful, dangerous, or protective/i
    );
    expect(psychePlaybook).toMatch(
      /If the user already gives the new sentence in usable language,[\s\S]*revise the wording[\s\S]*once and save/i
    );
    expect(psychePlaybook).toMatch(
      /Ask one confirmation question about accuracy, not another broad exploration\s+question/i
    );
    expect(psychePlaybook).toMatch(
      /Save through shared batch entity routes only after the user accepts the working\s+wording/i
    );
    expect(psychePlaybook).toMatch(/## Therapeutic turn shapes/i);
    expect(psychePlaybook).toMatch(/## Second-turn therapeutic discipline/i);
    expect(psychePlaybook).toMatch(
      /After the user's first real answer[\s\S]*choose one next lane/i
    );
    expect(psychePlaybook).toMatch(
      /interpretive hypothesis[\s\S]*protecting, predicting, relieving, or\s+costing/i
    );
    expect(psychePlaybook).toMatch(
      /accepted formulation is already accurate enough to save[\s\S]*stop deepening/i
    );
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

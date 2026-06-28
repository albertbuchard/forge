import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");

function readRepoFile(relativePath: string) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function extractOpenClawToolList(skill: string) {
  const startMarker =
    "When the user asks which Forge tools are available, list exactly these tools:";
  const endMarker = "\n\nAdditional first-class surfaces:";
  const start = skill.indexOf(startMarker);
  expect(start, "OpenClaw tool-list marker should exist").toBeGreaterThanOrEqual(0);
  const end = skill.indexOf(endMarker, start);
  expect(end, "OpenClaw tool-list end marker should exist").toBeGreaterThanOrEqual(0);
  return Array.from(skill.slice(start, end).matchAll(/`(forge_[a-z0-9_]+)`/g)).map(
    (match) => match[1]
  );
}

function extractRegisteredOpenClawTools(source: string) {
  return Array.from(source.matchAll(/name:\s*"(forge_[a-z0-9_]+)"/g)).map(
    (match) => match[1]
  );
}

describe("forge skill playbook parity", () => {
  it("keeps the shared Psyche playbook aligned across agent surfaces", () => {
    const canonical = readRepoFile(
      "plugins/openclaw/skills/forge-openclaw/psyche_entity_playbooks.md"
    );

    expect(
      readRepoFile(
        "plugins/openclaw/skills/forge-openclaw/psyche_entity_playbooks.md"
      )
    ).toBe(canonical);
    expect(
      readRepoFile("plugins/hermes/psyche_entity_playbooks.md")
    ).toBe(canonical);
    expect(
      readRepoFile("plugins/hermes/forge_hermes/psyche_entity_playbooks.md")
    ).toBe(canonical);
    expect(
      readRepoFile("plugins/codex/skills/forge-codex/psyche_entity_playbooks.md")
    ).toBe(canonical);
  });

  it("keeps the shared non-Psyche conversation playbook aligned across agent surfaces", () => {
    const canonical = readRepoFile(
      "plugins/openclaw/skills/forge-openclaw/entity_conversation_playbooks.md"
    );

    expect(
      readRepoFile(
        "plugins/openclaw/skills/forge-openclaw/entity_conversation_playbooks.md"
      )
    ).toBe(canonical);
    expect(
      readRepoFile("plugins/hermes/entity_conversation_playbooks.md")
    ).toBe(canonical);
    expect(
      readRepoFile("plugins/hermes/forge_hermes/entity_conversation_playbooks.md")
    ).toBe(canonical);
    expect(
      readRepoFile("plugins/codex/skills/forge-codex/entity_conversation_playbooks.md")
    ).toBe(canonical);
  });

  it("requires the Codex skill to reference the shared playbooks and missing-only intake", () => {
    const codexSkill = readRepoFile("plugins/codex/skills/forge-codex/SKILL.md");

    expect(codexSkill).toMatch(/entity_conversation_playbooks\.md/);
    expect(codexSkill).toMatch(/psyche_entity_playbooks\.md/);
    expect(codexSkill).toMatch(/missing or unclear/i);
    expect(codexSkill).toMatch(/one orienting question/i);
    expect(codexSkill).toMatch(/each question have one job/i);
    expect(codexSkill).toMatch(/follow-up lane/i);
  });

  it("keeps the agent-facing skills explicit about preferences, questionnaires, self-observation, and health surfaces", () => {
    const openclawSkill = readRepoFile("plugins/openclaw/skills/forge-openclaw/SKILL.md");
    const hermesSkill = readRepoFile("plugins/hermes/forge_hermes/skill.md");
    const hermesRootSkill = readRepoFile("plugins/hermes/skill.md");
    const codexSkill = readRepoFile("plugins/codex/skills/forge-codex/SKILL.md");

    expect(openclawSkill).toMatch(/forge_get_preferences_workspace/);
    expect(openclawSkill).toMatch(/forge_start_preferences_game/);
    expect(openclawSkill).toMatch(/forge_list_questionnaires/);
    expect(openclawSkill).toMatch(/forge_get_self_observation_calendar/);
    expect(openclawSkill).toMatch(/Self-observation/);
    expect(openclawSkill).toMatch(/sleep_session/i);
    expect(openclawSkill).toMatch(/workout_session/i);
    expect(openclawSkill).toMatch(/description:[^\n]*training_load/i);
    expect(openclawSkill).toMatch(/Health side covers[\s\S]*training-load surface/i);
    expect(openclawSkill).toMatch(/\/api\/v1\/movement/i);
    expect(openclawSkill).toMatch(/\/api\/v1\/life-force/i);
    expect(openclawSkill).toMatch(/\/api\/v1\/workbench/i);
    expect(openclawSkill).toMatch(/\/forge\/v1\/movement/i);
    expect(openclawSkill).toMatch(/\/forge\/v1\/life-force/i);
    expect(openclawSkill).toMatch(/\/forge\/v1\/workbench/i);
    expect(openclawSkill).toMatch(/forge_adjust_work_minutes/);
    expect(openclawSkill).toMatch(/forge_submit_preferences_judgment/);
    expect(openclawSkill).toMatch(/forge_submit_preferences_signal/);
    expect(openclawSkill).toMatch(/item\.foodId/);
    expect(openclawSkill).toMatch(/caloriesKcal[\s\S]*proteinG[\s\S]*carbsG[\s\S]*fatG/);
    expect(openclawSkill).toMatch(/never save a name-only food/i);
    expect(openclawSkill).toMatch(/Batch CRUD is the default for simple entities|shared batch entity tools/i);
    expect(openclawSkill).toMatch(
      /four major stored-entity surfaces,\s+read-model surfaces,\s+specialized CRUD surfaces,\s+and three specialized domain surfaces/i
    );
    expect(openclawSkill).toMatch(/specialized domain surfaces are Movement, Life Force, and Workbench/i);
    expect(openclawSkill).toMatch(/dedicated route families instead of forcing them through batch CRUD/i);
    expect(openclawSkill).toMatch(/Movement is a specialized domain surface, not batch CRUD/i);
    expect(openclawSkill).toMatch(/Life Force is a specialized domain surface, not batch CRUD/i);
    expect(openclawSkill).toMatch(/Workbench is a specialized domain surface, not batch CRUD/i);
    for (const skill of [openclawSkill, hermesSkill, hermesRootSkill, codexSkill]) {
      expect(skill).toMatch(/## Entity Route Posture/i);
      expect(skill).toMatch(/Keep the operation lane explicit across every entity family/i);
      expect(skill).toMatch(
        /Normal stored entities[\s\S]*added, updated, reviewed(?: or |\/)navigated,[\s\S]*linked,[\s\S]*placed/i
      );
      expect(skill).toMatch(
        /start, continue, complete, adjust, judge, signal, publish, sync,\s+or\s+observe/i
      );
      expect(skill).toMatch(
        /Movement, Life Force, and Workbench[\s\S]*review, correct,\s+repair, run, inspect,\s+publish,\s+or\s+preserve/i
      );
      expect(skill).toMatch(/formulation before storage/i);
      expect(skill).toMatch(/Batch CRUD is the default for normal stored entities/i);
      expect(skill).toMatch(/readModelOnlySurfaces/i);
      expect(skill).toMatch(/sleepOverview[\s\S]*sportsOverview[\s\S]*trainingLoad[\s\S]*sleep_overview[\s\S]*sports_overview[\s\S]*training_load/i);
      expect(skill).toMatch(/operatorOverview[\s\S]*operatorContext[\s\S]*calendarOverview/i);
      expect(skill).toMatch(/operator_overview[\s\S]*operator_context[\s\S]*calendar_overview/i);
      expect(skill).toMatch(/read-only(?: overview)? surfaces[\s\S]*not batch CRUD\s+entities/i);
      expect(skill).toMatch(/forge_get_operator_overview[\s\S]*forge_get_operator_context[\s\S]*forge_get_calendar_overview/i);
      expect(skill).toMatch(/wiki_page[\s\S]*calendar_connection[\s\S]*specialized CRUD surfaces/i);
      expect(skill).toMatch(/task_run[\s\S]*work_adjustment[\s\S]*questionnaire_run[\s\S]*preference_judgment[\s\S]*preference_signal[\s\S]*self_observation[\s\S]*action workflows/i);
      expect(skill).toMatch(/Movement, Life Force, and Workbench are specialized domain surfaces/i);
      expect(skill).toMatch(/entityRouteModel\.specializedDomainSurfaces/i);
      expect(skill).toMatch(/forge_call_movement_route/);
      expect(skill).toMatch(/forge_call_life_force_route/);
      expect(skill).toMatch(/forge_call_workbench_route/);
      expect(skill).toMatch(/live onboarding `routeKeys` list,[\s\S]*`methodRoutes` map[\s\S]*route-key tool schemas[\s\S]*exact route-key to method\/path/i);
      expect(skill).toMatch(/routeKeys[\s\S]*allowed names[\s\S]*methodRoutes[\s\S]*route-key-to-`METHOD \/api\/v1\/\.\.\.` source of truth/i);
      expect(skill).toMatch(/POST aggregate reads[\s\S]*Movement `selection`[\s\S]*DELETE\s+repair paths/i);
      expect(skill).toMatch(
        /Do not place IDs inside[\s\S]*`routeKey`, `query`, or `body`[\s\S]*invent a raw route\s+string/i
      );
      expect(skill).toMatch(/pathParams[\s\S]*placeholder names exactly/i);
      expect(skill).toMatch(/:slug[\s\S]*:pointId/i);
      expect(skill).toMatch(/routeKey`, `query`, or `body`|routeKey, query, or body/i);
      expect(skill).toMatch(/schema and live\s+onboarding disagree[\s\S]*contract bug/i);
      expect(skill).toMatch(
        /specialized route-key tool is unavailable, stale, or missing the needed route\s+key/i
      );
      expect(skill).toMatch(
        /do not fall back to generic batch CRUD[\s\S]*exact `methodRoutes` entry/i
      );
      expect(skill).toMatch(/reflection-sensitive records/i);
      expect(skill).toMatch(/Calibrate depth before deepening/i);
      expect(skill).toMatch(
        /quick capture[\s\S]*guided formulation[\s\S]*review-first[\s\S]*action-first/i
      );
      expect(skill).toMatch(
        /one structural, accuracy, or consent detail[\s\S]*do\s+not force full exploration/i
      );
      expect(skill).toMatch(/understand, decide, notice, remember, or\s+change later/i);
      expect(skill).toMatch(/minimum save-readiness\s+checkpoint/i);
      expect(skill).toMatch(/accepted wording[\s\S]*meaningful body[\s\S]*route lane/i);
      expect(skill).toMatch(/write, read, run, or update[\s\S]*instead of collecting optional\s+fields/i);
      expect(skill).toMatch(
        /read's decision value[\s\S]*rules\s+in[\s\S]*rules\s+out[\s\S]*answer-changing\s+uncertainty/i
      );
      expect(skill).toMatch(
        /save, update, review,\s+link, schedule, correct, run, publish, preserve,\s+enrich, open the UI, or stop/i
      );
      expect(skill).toMatch(/user-facing wording guard/i);
      expect(skill).toMatch(
        /do not say "that sounds important" unless you name the specific stake/i
      );
      expect(skill).toMatch(
        /do not ask\s+"what would you like to do with this\?"[\s\S]*one next action visible/i
      );
      expect(skill).toMatch(
        /replace endpoint, payload, mutation, batch\s+route, and route key language with product nouns/i
      );
      expect(skill).toMatch(
        /missing stay[\s\S]*weekday\s+energy curve[\s\S]*saved flow[\s\S]*failed run[\s\S]*node output[\s\S]*belief sentence/i
      );
      expect(skill).toMatch(
        /no answer-changing\s+uncertainty remains[\s\S]*summarize the product result and stop/i
      );
      expect(skill).toMatch(/Psyche save-readiness checkpoint/i);
      expect(skill).toMatch(/belief sentence[\s\S]*functional loop[\s\S]*flashcard cue\/message/i);
      expect(skill).toMatch(/hypothesis timing checkpoint/i);
      expect(skill).toMatch(
        /concrete episode, body cue, belief sentence,\s+behavior[\s\S]*record shape,\s+wording, links, or next action/i
      );
      expect(skill).toMatch(
        /no concrete moment is\s+visible[\s\S]*direct mechanical save[\s\S]*flooded or unsafe/i
      );
      expect(skill).toMatch(/When one message combines several jobs/i);
      expect(skill).toMatch(
        /read before a correction[\s\S]*formulate[\s\S]*primary Psyche record[\s\S]*flashcard or note/i
      );
      expect(skill).toMatch(/Search before creating duplicates|check for duplicates/i);
      expect(skill).toMatch(/review-first requests/i);
      expect(skill).toMatch(
        /shared batch search or read hints[\s\S]*wiki\/calendar[\s\S]*read-model routes[\s\S]*Movement, Life Force, or Workbench dedicated reads/i
      );
      expect(skill).toMatch(
        /answer the practical question[\s\S]*before asking for any save, correction,\s+link,\s+run, enrichment, or publish detail/i
      );
      expect(skill).toMatch(
        /update (?:it|that record), link to it, or save a separate new record/i
      );
      expect(skill).toMatch(
        /Before deleting, archiving, invalidating, disconnecting, or replacing a record/i
      );
      expect(skill).toMatch(/preserve\s+therapeutic history/i);
      expect(skill).toMatch(/Concrete route-key examples for internal use/i);
      expect(skill).toMatch(
        /If no card fits[\s\S]*cue or urge sentence[\s\S]*short message[\s\S]*visual\s+style[\s\S]*colors[\s\S]*tags[\s\S]*optional links/i
      );
      expect(skill).toMatch(/Movement all-time read[\s\S]*"routeKey":"allTime"/i);
      expect(skill).toMatch(/Movement timeline read[\s\S]*"routeKey":"timeline"/i);
      expect(skill).toMatch(/Movement selection aggregate[\s\S]*"routeKey":"selection"[\s\S]*"body"[\s\S]*"placeIds"/i);
      expect(skill).not.toMatch(
        /Movement selection aggregate:\s*\n\s*`\{"routeKey":"selection","query"/i
      );
      expect(skill).toMatch(/Movement trip detail[\s\S]*"routeKey":"tripDetail"/i);
      expect(skill).toMatch(/Movement settings read[\s\S]*"routeKey":"settings"/i);
      expect(skill).toMatch(/Movement settings update[\s\S]*"routeKey":"settingsUpdate"/i);
      expect(skill).toMatch(/Movement known-place creation[\s\S]*"routeKey":"placeCreate"/i);
      expect(skill).toMatch(/Movement known-place update[\s\S]*"routeKey":"placeUpdate"/i);
      expect(skill).toMatch(/GET \/api\/v1\/movement\/settings[\s\S]*PATCH \/api\/v1\/movement\/settings/i);
      expect(skill).toMatch(/passive capture[\s\S]*publish mode[\s\S]*retention mode/i);
      expect(skill).toMatch(/Movement missing-stay correction[\s\S]*"routeKey":"userBoxPreflight"[\s\S]*"routeKey":"userBoxCreate"/i);
      expect(skill).toMatch(/Movement saved-overlay update[\s\S]*"routeKey":"userBoxUpdate"/i);
      expect(skill).toMatch(/Movement saved-overlay delete[\s\S]*"routeKey":"userBoxDelete"/i);
      expect(skill).toMatch(/Life Force overview[\s\S]*"routeKey":"overview"/i);
      expect(skill).toMatch(/Life Force profile edit[\s\S]*"routeKey":"profile"/i);
      expect(skill).toMatch(/Life Force weekday template edit[\s\S]*"routeKey":"weekdayTemplate"/i);
      expect(skill).toMatch(/Life Force fatigue signal[\s\S]*"routeKey":"fatigueSignal"/i);
      expect(skill).toMatch(/Workbench flow catalog[\s\S]*"routeKey":"listFlows"/i);
      expect(skill).toMatch(/Workbench flow detail[\s\S]*"routeKey":"flowDetail"/i);
      expect(skill).toMatch(/Workbench box catalog[\s\S]*"routeKey":"boxCatalog"/i);
      expect(skill).toMatch(/Workbench flow creation[\s\S]*"routeKey":"createFlow"/i);
      expect(skill).toMatch(/Workbench flow edit[\s\S]*"routeKey":"updateFlow"/i);
      expect(skill).toMatch(/Workbench flow deletion[\s\S]*"routeKey":"deleteFlow"/i);
      expect(skill).toMatch(/Workbench run history[\s\S]*"routeKey":"runHistory"/i);
      expect(skill).toMatch(/Workbench run detail[\s\S]*"routeKey":"runDetail"/i);
      expect(skill).toMatch(/Workbench run nodes[\s\S]*"routeKey":"runNodes"/i);
      expect(skill).toMatch(/Workbench node result[\s\S]*"routeKey":"nodeResult"/i);
      expect(skill).toMatch(/Workbench published output[\s\S]*"routeKey":"publishedOutput"/i);
      expect(skill).toMatch(/Workbench latest node output[\s\S]*"routeKey":"latestNodeOutput"/i);
      expect(skill).toMatch(/Workbench run execution[\s\S]*"routeKey":"runFlow"/i);
      expect(skill).toMatch(/Workbench one-off input execution[\s\S]*"routeKey":"runByPayload"/i);
      expect(skill).toMatch(/Workbench flow chat follow-up[\s\S]*"routeKey":"chatFlow"/i);
      expect(skill).toMatch(/stable input contract[\s\S]*intended\s+published output[\s\S]*smallest structural change/i);
      expect(skill).toMatch(/deletion[\s\S]*published outputs or run\s+history need preservation/i);
      expect(skill).toMatch(/POST \/api\/v1\/workbench\/flows\/:id\/chat/i);
      expect(skill).toMatch(/new run, note, or generic entity update/i);
    }
    expect(openclawSkill).toMatch(/conversation is clearly about a Forge entity or domain surface/i);
    expect(openclawSkill).toMatch(/movement, life_force, workbench/i);
    expect(openclawSkill).toMatch(/wiki_page/i);
    expect(openclawSkill).toMatch(/calendar_connection/i);
    expect(openclawSkill).toMatch(/preference judgment/i);
    expect(openclawSkill).toMatch(/work_adjustment/i);
    expect(openclawSkill).toMatch(/Minimum-field checkpoint, not a question script/i);
    expect(openclawSkill).toMatch(/Only ask if missing or unclear/i);
    expect(openclawSkill).toMatch(/assigneeUserIds/);
    expect(openclawSkill).toMatch(/issue, one-session task, or subtask/i);
    expect(openclawSkill).toMatch(/productRequirementsDocument/);
    expect(openclawSkill).toMatch(/workflowStatus/);
    expect(openclawSkill).toMatch(/schedulingRules/);
    expect(openclawSkill).not.toMatch(/Use this intake map when the user agrees/i);
    expect(openclawSkill).not.toMatch(/\n\s*Ask:\n/);

    expect(hermesSkill).toMatch(/high-level batch routes for basic Preferences CRUD/i);
    expect(hermesSkill).toMatch(/high-level batch routes for basic questionnaire CRUD/i);
    expect(hermesSkill).toMatch(/Health side covers[\s\S]*training-load surface/i);
    expect(hermesSkill).toMatch(/Read-model-only surfaces:[^\n]*training load/i);
    expect(hermesSkill).toMatch(/add, update, review, compare, navigate, link, or run/i);
    expect(hermesSkill).toMatch(/exact correction in usable language/i);
    expect(hermesSkill).toMatch(/stop asking and write/i);
    expect(hermesSkill).toMatch(/review, compare, inspect, or navigate an existing Forge/i);
    expect(hermesSkill).toMatch(/reflection-sensitive records/i);
    expect(hermesSkill).toMatch(/understand, decide, notice, remember, or\s+change later/i);
    expect(hermesSkill).toMatch(/Self-observation is note-backed/i);
    expect(hermesSkill).toMatch(/Batch CRUD is the default for simple entities/i);
    expect(hermesSkill).toMatch(/route jungle|one-route-per-entity/i);
    expect(hermesSkill).toMatch(/specializedDomainSurfaces/i);
    expect(hermesSkill).toMatch(/routeSelectionQuestions/i);
    expect(hermesSkill).toMatch(/read the relevant specialized view back/i);
    expect(hermesSkill).toMatch(/work_adjustment/i);
    expect(hermesSkill).toMatch(/preference_judgment/i);
    expect(hermesSkill).toMatch(/preference_signal/i);
    expect(codexSkill).toMatch(/sleep_session/i);
    expect(codexSkill).toMatch(/workout_session/i);
    expect(codexSkill).toMatch(/`training_load` surface/i);
    expect(codexSkill).toMatch(/add, update, review, compare, navigate, link, or run/i);
    expect(codexSkill).toMatch(/exact correction in usable language/i);
    expect(codexSkill).toMatch(/stop asking and write/i);
    expect(codexSkill).toMatch(/reflection-sensitive records/i);
    expect(codexSkill).toMatch(/understand, decide, notice, remember, or\s+change later/i);
    expect(codexSkill).toMatch(/simple entities/i);
    expect(codexSkill).toMatch(/hundreds of individual CRUD routes|route jungle/i);
    expect(codexSkill).toMatch(/specializedDomainSurfaces/i);
    expect(codexSkill).toMatch(/routeSelectionQuestions/i);
    expect(codexSkill).toMatch(/specialized_domain_surface/i);
    expect(codexSkill).toMatch(/relevant[\s\S]*specialized view back/i);
    expect(codexSkill).toMatch(/\/api\/v1\/movement\/day/i);
    expect(codexSkill).toMatch(/\/api\/v1\/movement\/automatic-boxes\/:id\/invalidate/i);
    expect(codexSkill).toMatch(/\/api\/v1\/life-force\/profile/i);
    expect(codexSkill).toMatch(/\/api\/v1\/workbench\/flows\/:id\/run/i);
    expect(codexSkill).toMatch(/\/api\/v1\/workbench\/flows\/:id\/chat/i);
    expect(codexSkill).toMatch(/PATCH \/api\/v1\/workbench\/flows\/:id/i);
    expect(codexSkill).toMatch(/DELETE \/api\/v1\/workbench\/flows\/:id/i);
    expect(codexSkill).toMatch(/timeline,[\s\S]*overlay,[\s\S]*weekday\s+template,[\s\S]*published output,[\s\S]*run detail,[\s\S]*node result/i);
    expect(hermesSkill).toMatch(/timeline,[\s\S]*overlay,[\s\S]*weekday\s+template,[\s\S]*published output,[\s\S]*run detail,[\s\S]*node result/i);
    expect(hermesSkill).toMatch(/PATCH \/api\/v1\/workbench\/flows\/:id/i);
    expect(hermesSkill).toMatch(/DELETE \/api\/v1\/workbench\/flows\/:id/i);
    expect(hermesSkill).toMatch(/\/api\/v1\/workbench\/flows\/:id\/chat/i);
    expect(hermesSkill).toMatch(
      /four major stored-entity surfaces,\s+read-model surfaces,\s+specialized CRUD surfaces,\s+and three specialized domain surfaces/i
    );
    expect(hermesSkill).toMatch(/specialized domain surfaces are Movement,[\s\S]*Life Force,[\s\S]*Workbench/i);
    expect(hermesSkill).toMatch(/dedicated route families instead of[\s\S]*batch CRUD/i);
    expect(hermesSkill).toMatch(/item\.foodId/);
    expect(hermesSkill).toMatch(/name-only custom foods/i);
    expect(codexSkill).toMatch(/\/forge\/v1\/movement/i);
    expect(codexSkill).toMatch(/forge_adjust_work_minutes/);
    expect(codexSkill).toMatch(/preference_judgment/i);
    expect(codexSkill).toMatch(/preference_signal/i);
    expect(codexSkill).toMatch(/specialized Movement, Life Force, and Workbench domain surfaces/i);
    expect(codexSkill).toMatch(/Movement, Life Force, and Workbench use dedicated route[\s\S]*batch CRUD/i);
    expect(codexSkill).toMatch(/item\.foodId/);
    expect(codexSkill).toMatch(/name-only custom foods/i);

    for (const skill of [openclawSkill, hermesSkill, codexSkill]) {
      expect(skill).toMatch(/flashcard/);
      expect(skill).toMatch(/flashcard \{ message \}|`flashcard`[\s\S]*message/i);
      expect(skill).toMatch(/`event_type`[\s\S]*`emotion_definition`/);
      expect(skill).toMatch(/psychologically meaningful Psyche\s+records/i);
      expect(skill).toMatch(/repeated lived moment or felt\s+signature/i);
      expect(skill).toMatch(/Do not minimize functional analysis/i);
      expect(skill).toMatch(/interpretive hypothesis/i);
      expect(skill).toMatch(/collaborative and testable/i);
      expect(skill).toMatch(/hypothesis timing checkpoint/i);
    }
    expect(readRepoFile("plugins/openclaw/skills/forge-openclaw/psyche_entity_playbooks.md")).toMatch(
      /Hypotheses are not decorative reassurance[\s\S]*Do not make the user supply every interpretation alone/i
    );
    expect(readRepoFile("plugins/openclaw/skills/forge-openclaw/psyche_entity_playbooks.md")).toMatch(
      /Hypothesis Timing Checkpoint[\s\S]*second or third deepening question[\s\S]*record shape, wording, links, or next action/i
    );
    expect(readRepoFile("plugins/openclaw/skills/forge-openclaw/psyche_entity_playbooks.md")).toMatch(
      /no concrete moment is\s+visible[\s\S]*direct mechanical save[\s\S]*flooded, unsafe[\s\S]*diagnosis-like label/i
    );
    expect(
      readRepoFile("plugins/openclaw/skills/forge-openclaw/entity_conversation_playbooks.md")
    ).toMatch(/custom food[\s\S]*calories plus protein, carbohydrate, and fat/i);
  });

  it("keeps OpenClaw's exact tool list aligned with the current curated tool surface", () => {
    const openclawSkill = readRepoFile("plugins/openclaw/skills/forge-openclaw/SKILL.md");
    const toolSource = readRepoFile("apps/web/src/openclaw/tools.ts");
    const listedTools = extractOpenClawToolList(openclawSkill);

    expect(listedTools).toEqual(extractRegisteredOpenClawTools(toolSource));
  });

  it("keeps OpenClaw data-root guidance focused on effective runtime config", () => {
    const openclawSkill = readRepoFile("plugins/openclaw/skills/forge-openclaw/SKILL.md");
    const dataLocationSlice = openclawSkill.slice(
      openclawSkill.indexOf("Forge data location rule:"),
      openclawSkill.indexOf("Psyche interview rule:")
    );

    expect(dataLocationSlice).toMatch(/never answer from a generic default/i);
    expect(dataLocationSlice).toMatch(/configured `dataRoot`/);
    expect(dataLocationSlice).toMatch(/`FORGE_DATA_ROOT`/);
    expect(dataLocationSlice).toMatch(/live runtime file handle/);
    expect(dataLocationSlice).toMatch(/Do not merge side databases unless an ID\/content-level audit proves/i);
    expect(dataLocationSlice).not.toMatch(/~\/\.openclaw\/extensions\/forge-openclaw-plugin\/forge\.sqlite/);
    expect(dataLocationSlice).not.toMatch(/<repo>\/plugins\/openclaw\/forge\.sqlite/);
  });

  it("keeps OpenClaw and Hermes explicit about habit semantics and the shared check-in path", () => {
    const openclawSkill = readRepoFile("plugins/openclaw/skills/forge-openclaw/SKILL.md");
    const hermesSkill = readRepoFile("plugins/hermes/forge_hermes/skill.md");

    for (const skill of [openclawSkill, hermesSkill]) {
      expect(skill).toMatch(/negative habit/i);
      expect(skill).toMatch(/bad habit was[\s\S]*resisted|habit was[\s\S]*resisted/i);
      expect(skill).toMatch(/xp bonus/i);
      expect(skill).toMatch(
        /forge_update_entities[\s\S]*(patch\.checkIn|patch:\s*\{\s*checkIn)/i
      );
      expect(skill).not.toMatch(/direct raw calls? to \/api\/v1\/habits\/:id\/check-ins[\s\S]*preferred/i);
    }
  });

  it("keeps the canonical playbooks focused on guided, one-lane questioning", () => {
    const entityPlaybook = readRepoFile("plugins/openclaw/skills/forge-openclaw/entity_conversation_playbooks.md");
    const psychePlaybook = readRepoFile("plugins/openclaw/skills/forge-openclaw/psyche_entity_playbooks.md");

    expect(entityPlaybook).toMatch(/Let each question have one job/i);
    expect(entityPlaybook).toMatch(/Question design rules/i);
    expect(entityPlaybook).toMatch(/Update loop/i);
    expect(entityPlaybook).toMatch(/Update-first openers/i);
    expect(entityPlaybook).toMatch(/Task Run/i);
    expect(entityPlaybook).toMatch(/dedicated task-run tool/i);
    expect(entityPlaybook).toMatch(/Do not bounce to the Forge UI, a browser session, or a generic web route/i);
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
    expect(entityPlaybook).toMatch(/Review And Navigation Moves/i);
    expect(entityPlaybook).toMatch(/Review-before-write checkpoint/i);
    expect(entityPlaybook).toMatch(
      /The read is part of the help, not a pretext for a new form/i
    );
    expect(entityPlaybook).toMatch(/Question Calibration Loop/i);
    expect(entityPlaybook).toMatch(/Turn shapes/i);
    expect(entityPlaybook).toMatch(/Name, Define, Connect/i);
    expect(entityPlaybook).toMatch(/One focused question is the default/i);
    expect(entityPlaybook).toMatch(/Before asking, decide the API posture internally/i);
    expect(entityPlaybook).toMatch(/Do not let API uncertainty leak out as vague wording/i);
    expect(entityPlaybook).toMatch(/Avoid generic reflections such as "that sounds important"/i);
    expect(entityPlaybook).toMatch(/Operation lane checkpoint/i);
    expect(entityPlaybook).toMatch(/Mixed-intent sequencing/i);
    expect(entityPlaybook).toMatch(/Search-before-write and existing-record disambiguation/i);
    expect(entityPlaybook).toMatch(/Destructive and replacement actions/i);
    expect(entityPlaybook).toMatch(
      /Movement timeline or box\s+detail comes before correction[\s\S]*Workbench run or node detail comes before editing[\s\S]*Life Force overview comes before changing planning\s+assumptions/i
    );
    expect(entityPlaybook).toMatch(
      /save the pattern and make me a card[\s\S]*formulate the\s+Psyche record first/i
    );
    expect(entityPlaybook).toMatch(
      /shared batch route by entity type[\s\S]*update that record, link to it, or become a separate new record/i
    );
    expect(entityPlaybook).toMatch(
      /wiki_page[\s\S]*calendar_connection[\s\S]*dedicated search\/list\/read routes/i
    );
    expect(entityPlaybook).toMatch(
      /soft-delete path[\s\S]*hard deletion[\s\S]*permanent removal/i
    );
    expect(entityPlaybook).toMatch(
      /downstream sync, published output, backlinks, run history,[\s\S]*completed runs/i
    );
    expect(entityPlaybook).toMatch(/add, update, review, compare, navigate, link, or run/i);
    expect(entityPlaybook).toMatch(/what is becoming clearer/i);
    expect(entityPlaybook).toMatch(/feels true[\s\S]*or needs one correction/i);
    expect(entityPlaybook).toMatch(/Prefer "what", "when", and "how" before "why"/i);
    expect(entityPlaybook).toMatch(
      /naming question[\s\S]*unless the meaning is already clear/i
    );
    expect(entityPlaybook).toMatch(/reusable vocabulary or taxonomy records/i);
    expect(entityPlaybook).toMatch(/emotionally meaningful vocabulary records/i);
    expect(entityPlaybook).toMatch(/adjacent record becomes visible/i);
    expect(entityPlaybook).toMatch(/offer one revised formulation yourself/i);
    expect(entityPlaybook).toMatch(/repeated moment back in plain language/i);
    expect(entityPlaybook).toMatch(/felt signature back in plain language/i);
    expect(entityPlaybook).toMatch(/another agent could follow[\s\S]*without guessing/i);
    expect(entityPlaybook).toMatch(/confirm only the missing route-selecting detail[\s\S]*then act/i);
    expect(entityPlaybook).toMatch(/meaning-bearing updates[\s\S]*feels newly true/i);
    expect(entityPlaybook).toMatch(/self_observation[\s\S]*note-backed|note-backed[\s\S]*self_observation/i);
    expect(entityPlaybook).toMatch(/sleep_session[\s\S]*shared batch CRUD routes|shared batch CRUD routes[\s\S]*sleep_session/i);
    expect(entityPlaybook).toMatch(/workout_session[\s\S]*shared batch CRUD routes|shared batch CRUD routes[\s\S]*workout_session/i);
    expect(entityPlaybook).toMatch(/## Preference Catalog/);
    expect(entityPlaybook).toMatch(/## Preference Catalog Item/);
    expect(entityPlaybook).toMatch(/## Preference Context/);
    expect(entityPlaybook).toMatch(/## Preference Item/);
    expect(entityPlaybook).toMatch(/## Preference Judgment/);
    expect(entityPlaybook).toMatch(/## Preference Signal/);
    expect(entityPlaybook).toMatch(/## Wiki Page/);
    expect(entityPlaybook).toMatch(/## Calendar Connection/);
    expect(entityPlaybook).toMatch(/## Work Adjustment/);
    expect(entityPlaybook).toMatch(/## Movement/);
    expect(entityPlaybook).toMatch(/## Life Force/);
    expect(entityPlaybook).toMatch(/## Workbench/);
    expect(entityPlaybook).toMatch(/Lane-to-route map:/);
    expect(entityPlaybook).toMatch(/## Full Route Posture Matrix/);
    expect(entityPlaybook).toMatch(/`movement`[\s\S]*specialized domain surface/i);
    expect(entityPlaybook).toMatch(/`life_force`[\s\S]*specialized domain surface/i);
    expect(entityPlaybook).toMatch(/`workbench`[\s\S]*specialized domain surface/i);
    expect(entityPlaybook).toMatch(/`psyche_value`[\s\S]*`emotion_definition`[\s\S]*normal stored entities for API purposes/i);
    expect(entityPlaybook).toMatch(/Every normal entity section below inherits that batch-route default/i);
    expect(entityPlaybook).toMatch(/If the tool schema and live onboarding disagree[\s\S]*contract mismatch/i);
    expect(entityPlaybook).toMatch(/`work_adjustment` is an action workflow/i);
    expect(entityPlaybook).toMatch(/\/api\/v1\/wiki\/pages[\s\S]*family/i);
    expect(entityPlaybook).toMatch(/\/api\/v1\/tasks\/:id\/runs/);
    expect(entityPlaybook).toMatch(/\/api\/v1\/psyche\/self-observation\/calendar/);
    expect(entityPlaybook).toMatch(/\/api\/v1\/psyche\/questionnaires\/:id\/runs/);
    expect(entityPlaybook).toMatch(/\/api\/v1\/psyche\/questionnaire-runs\/:id\/complete/);
    expect(entityPlaybook).toMatch(/\/api\/v1\/movement\/day/);
    expect(entityPlaybook).toMatch(/\/api\/v1\/movement\/automatic-boxes\/:id\/invalidate/);
    expect(entityPlaybook).toMatch(/\/api\/v1\/life-force\/profile/);
    expect(entityPlaybook).toMatch(/\/api\/v1\/workbench\/flows\/:id\/run/);
    expect(entityPlaybook).toMatch(
      /day, month, all-time, timeline, places, trip-detail,[\s\S]*selection,[\s\S]*settings route/i
    );
    expect(entityPlaybook).toMatch(/stable public input contract or published output/i);
    expect(entityPlaybook).toMatch(/favorite, veto, or compare-later/i);
    expect(entityPlaybook).toMatch(/Movement, Life Force, or Workbench work/i);
    expect(entityPlaybook).toMatch(/Do not promote self-observation over functional analysis/i);
    expect(entityPlaybook).toMatch(/behavior_pattern` for recurring loops|Use `behavior_pattern` for a recurring loop/i);
    expect(entityPlaybook).toMatch(/wiki_page` when the user wants durable memory|Use `wiki_page` when the user wants durable memory/i);
    expect(entityPlaybook).toMatch(/candidate label[\s\S]*what kinds of moments belong inside it/i);
    expect(entityPlaybook).toMatch(/keep it provisional[\s\S]*future use are clear/i);
    expect(entityPlaybook).toMatch(/When the record is already clear enough to save, save it/i);
    expect(entityPlaybook).toMatch(/if the user confirms it, stop asking and save/i);

    expect(psychePlaybook).toMatch(/Ask only one lane at a time/i);
    expect(psychePlaybook).toMatch(/Therapeutic Direction Check/i);
    expect(psychePlaybook).toMatch(/Therapeutic turn shapes/i);
    expect(psychePlaybook).toMatch(/Name, Define, Connect/i);
    expect(psychePlaybook).toMatch(/Follow-up rhythm/i);
    expect(psychePlaybook).toMatch(/Before the next question, reflect back what you just heard/i);
    expect(psychePlaybook).toMatch(/formulation work/i);
    expect(psychePlaybook).toMatch(/what the experience is[\s\S]*trying to[\s\S]*protect, prevent, or hold onto/i);
    expect(psychePlaybook).toMatch(/choose the one that most[\s\S]*improves understanding/i);
    expect(psychePlaybook).toMatch(/feels true enough/i);
    expect(psychePlaybook).toMatch(/accuracy and steadiness/i);
    expect(psychePlaybook).toMatch(/Therapist micro-skills/i);
    expect(psychePlaybook).toMatch(/## Schema Theme Routing/i);
    expect(psychePlaybook).toMatch(/## Psyche API Posture/i);
    expect(psychePlaybook).toMatch(/## Psyche Hypothesis Map/i);
    expect(psychePlaybook).toMatch(
      /understanding plus an immediate support action[\s\S]*derive the support action from the accepted wording/i
    );
    expect(psychePlaybook).toMatch(
      /similar Psyche record[\s\S]*not treat similarity as a cold duplicate\s+failure/i
    );
    expect(psychePlaybook).toMatch(
      /update the existing record, link to it, or stand as a distinct new version/i
    );
    expect(psychePlaybook).toMatch(
      /preserve therapeutic history unless the user\s+clearly wants removal/i
    );
    expect(psychePlaybook).toMatch(
      /Do not delete a\s+Psyche record merely because a cleaner formulation now exists/i
    );
    expect(psychePlaybook).toMatch(
      /Do not ask for every adjacent entity at once/i
    );
    expect(psychePlaybook).toMatch(/`behavior_pattern`[\s\S]*cue[\s\S]*short-term payoff[\s\S]*long-term cost/i);
    expect(psychePlaybook).toMatch(/`belief_entry`[\s\S]*rule, prediction, or self\/other\/world sentence/i);
    expect(psychePlaybook).toMatch(/`mode_profile`[\s\S]*protective job[\s\S]*feared danger[\s\S]*burden/i);
    expect(psychePlaybook).toMatch(/`flashcard`[\s\S]*cue[\s\S]*urge sentence[\s\S]*brief message/i);
    expect(psychePlaybook).toMatch(/`emotion_definition`[\s\S]*body signature[\s\S]*urge[\s\S]*warning/i);
    expect(psychePlaybook).toMatch(/shared batch entity routes[\s\S]*psyche_value[\s\S]*emotion_definition/i);
    expect(psychePlaybook).toMatch(/Keep the route decision internal/i);
    expect(psychePlaybook).toMatch(
      /schema theme[\s\S]*belief_entry[\s\S]*behavior_pattern[\s\S]*mode_profile/i
    );
    expect(psychePlaybook).toMatch(
      /wiki_page[\s\S]*durable explanation of a schema theme/i
    );
    expect(psychePlaybook).toMatch(/Prefer "what", "when", and "how" early/i);
    expect(psychePlaybook).toMatch(/whether it feels true, too sharp, or still misses something important/i);
    expect(psychePlaybook).toMatch(/one brief reflection[\s\S]*one missing-detail question/i);
    expect(psychePlaybook).toMatch(/what does it seem to prove in that moment/i);
    expect(psychePlaybook).toMatch(/Psyche update loop/i);
    expect(psychePlaybook).toMatch(/what the old wording was trying to[\s\S]*hold/i);
    expect(psychePlaybook).toMatch(/revise the whole formulation, or only the part that now feels inaccurate/i);
    expect(psychePlaybook).toMatch(/newly true, newly visible, or newly inaccurate/i);
    expect(psychePlaybook).toMatch(/charged episode[\s\S]*before you rename the durable|recent charged episode[\s\S]*before you re-check the durable/i);
    expect(psychePlaybook).toMatch(/accurate enough to be held/i);
    expect(psychePlaybook).toMatch(/do not ask for evidence, origin, or repair[\s\S]*all that is[\s\S]*missing/i);
    expect(psychePlaybook).toMatch(/Do not make the user prove the experience/i);
    expect(psychePlaybook).toMatch(/Do not widen into adjacent entities until the current one has a working sentence/i);
    expect(psychePlaybook).toMatch(/If the user says it lands, move toward the write/i);
    expect(psychePlaybook).toMatch(/choose the clearest primary[\s\S]*container first/i);
    expect(psychePlaybook).toMatch(/stop deepening and[\s\S]*name it cleanly/i);
    expect(psychePlaybook).toMatch(/What happened the last time this pattern showed up/i);
    expect(psychePlaybook).toMatch(/What did you find yourself doing the last time this move showed up/i);
    expect(psychePlaybook).toMatch(/When that reaction hits, what does it start telling you about you, them, or what happens next/i);
    expect(psychePlaybook).toMatch(/What exact urge sentence or situation should make this card appear/i);
    expect(psychePlaybook).toMatch(/What kind of moment keeps happening that you want future reports to name the same way each time/i);
    expect(psychePlaybook).toMatch(/When this feeling is present, what tells you it is this feeling and not a nearby one/i);
    expect(psychePlaybook).toMatch(/emotionally meaningful kind of moment/i);
    expect(psychePlaybook).toMatch(/lived signature/i);
    expect(psychePlaybook).not.toMatch(/disappearing like that/i);
    expect(psychePlaybook).not.toMatch(/send the long message/i);
    expect(psychePlaybook).not.toMatch(/polished and unreachable/i);
  });

  it("covers representative user requests for preferences, questionnaires, self-observation, calendar, and health work", () => {
    const openclawSkill = readRepoFile("plugins/openclaw/skills/forge-openclaw/SKILL.md");
    const hermesSkill = readRepoFile("plugins/hermes/forge_hermes/skill.md");
    const entityPlaybook = readRepoFile("plugins/openclaw/skills/forge-openclaw/entity_conversation_playbooks.md");
    const psychePlaybook = readRepoFile("plugins/openclaw/skills/forge-openclaw/psyche_entity_playbooks.md");

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
          "I feel the urge to drink. Help me with the flashcard I made for this.",
        required: [
          /entityTypes: \["flashcard"\]/,
          /show the card message first|show the flashcard message first/i,
          /urge-surfing|cognitive defusion|values-based support/i
        ],
        questioning: [/exact urge sentence or situation/i]
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
          /forge_get_training_load_overview/,
          /forge_update_sleep_session/,
          /forge_update_workout_session/,
          /batch routes for ordinary health-session CRUD|ordinary `sleep_session` and `workout_session` CRUD belongs on the shared batch routes/i,
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

  it("keeps onboarding source and OpenAPI schema aligned for specialized surfaces and action-heavy flows", () => {
    const appSource = readRepoFile("apps/api/src/app.ts");
    const openApiSource = readRepoFile("apps/api/src/openapi.ts");

    expect(appSource).toMatch(/focus:\s*"work_adjustment"/);
    expect(appSource).toMatch(/focus:\s*"preference_judgment"/);
    expect(appSource).toMatch(/focus:\s*"preference_signal"/);
    expect(appSource).toMatch(/focus:\s*"movement"/);
    expect(appSource).toMatch(/focus:\s*"life_force"/);
    expect(appSource).toMatch(/focus:\s*"workbench"/);
    expect(appSource).toMatch(/entityType:\s*"work_adjustment"/);
    expect(appSource).toMatch(/entityType:\s*"preference_judgment"/);
    expect(appSource).toMatch(/entityType:\s*"preference_signal"/);
    expect(appSource).toMatch(/entityType:\s*"movement"/);
    expect(appSource).toMatch(/entityType:\s*"life_force"/);
    expect(appSource).toMatch(/entityType:\s*"workbench"/);
    expect(appSource).toMatch(/specialized_domain_surface/);
    expect(appSource).toMatch(/workAdjustment:/);
    expect(appSource).toMatch(/work_adjustment:\s*\{/);
    expect(appSource).toMatch(/preference_judgment:\s*\{/);
    expect(appSource).toMatch(/preference_signal:\s*\{/);
    expect(appSource).toMatch(/self_observation:\s*\{/);
    expect(appSource).toMatch(/adjustMinutes:\s*"\/api\/v1\/work-adjustments"/);
    expect(appSource).toMatch(/action:\s*"\/api\/v1\/preferences\/judgments"/);
    expect(appSource).toMatch(/action:\s*"\/api\/v1\/preferences\/signals"/);
    expect(appSource).toMatch(/specializedDomainSurfaces:/);
    expect(appSource).toMatch(/life_force:\s*\{/);
    expect(appSource).toMatch(/aliases:\s*\[\s*"life_force"/);
    expect(appSource).toMatch(/routeKeys:\s*\[/);
    expect(appSource).toMatch(/routeKeys:\s*\[\s*"overview",\s*"profile",\s*"weekdayTemplate",\s*"fatigueSignal"\s*\]/);
    expect(appSource).toMatch(/methodRoutes:/);
    expect(appSource).toMatch(/selection:\s*"POST \/api\/v1\/movement\/selection"/);
    expect(appSource).toMatch(/overview:\s*"GET \/api\/v1\/life-force"/);
    expect(appSource).toMatch(/runFlow:\s*"POST \/api\/v1\/workbench\/flows\/:id\/run"/);
    expect(appSource).toMatch(/flowDetail:\s*"GET \/api\/v1\/workbench\/flows\/:id"/);
    expect(appSource).toMatch(/runHistory:\s*"GET \/api\/v1\/workbench\/flows\/:id\/runs"/);
    expect(appSource).toMatch(/movementAllTime:/);
    expect(appSource).toMatch(/movementAutomaticBoxInvalidate:/);
    expect(appSource).toMatch(/movementTripPointUpdate:/);
    expect(appSource).toMatch(/workbenchFlows:/);
    expect(appSource).toMatch(/specializedSurfaceRule:/);
    expect(appSource).toMatch(/another agent could follow the same path without guessing/i);
    expect(appSource).toMatch(/read the relevant dedicated view before you mutate it/i);
    expect(appSource).toMatch(/shared batch CRUD path for ordinary sleep_session create or update work/i);
    expect(appSource).toMatch(/shared batch CRUD path for ordinary workout_session create or update work/i);

    expect(openApiSource).toMatch(/"workAdjustment"/);
    expect(openApiSource).toMatch(/"movement"/);
    expect(openApiSource).toMatch(/"lifeForce"/);
    expect(openApiSource).toMatch(/aliases/);
    expect(openApiSource).toMatch(/routeKeys/);
    expect(openApiSource).toMatch(/methodRoutes/);
    expect(openApiSource).toMatch(/"workbench"/);
    expect(openApiSource).toMatch(/"specializedDomainSurfaces"/);
    expect(openApiSource).toMatch(/"specialized_domain_surface"/);
    expect(openApiSource).toMatch(/"movementTimeline"/);
    expect(openApiSource).toMatch(/"movementAllTime"/);
    expect(openApiSource).toMatch(/"movementSettings"/);
    expect(openApiSource).toMatch(/"movementSettingsUpdate"/);
    expect(openApiSource).toMatch(/"movementAutomaticBoxInvalidate"/);
    expect(openApiSource).toMatch(/"workbenchFlows"/);
  });
});

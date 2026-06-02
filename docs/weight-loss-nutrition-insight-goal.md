# Goal: Forge Weight Loss, Nutrition, And Body Insight Surface

## Goal Prompt

Use this prompt to start the `/goal` run:

```text
/goal Implement the Forge Weight Loss, Nutrition, and Body Insight surface described in /Users/omarclaw/Documents/aurel-monorepo/projects/forge/docs/weight-loss-nutrition-insight-goal.md.

Work on Forge main only. Read the applicable AGENTS.md files and Forge .vision files first. Build this as a first-class Forge health surface, not a MyFitnessPal clone.

The feature must combine calorie balance, food logging, body trend, subjective energy, gut symptoms, appearance check-ins, sports/food interaction, and Forge entity links into one personal pattern-discovery system.

Use the existing OpenAI Codex OAuth / ChatGPT subscription-backed provider path already present in Forge and OpenClaw/Hermes. Do not add or default to OpenAI Platform API-key billing for v1. AI food parsing and photo interpretation must go through the existing openai-codex provider contract or a narrow extension of that contract.

Carry the work through implementation, tests, OpenClaw/Hermes tool parity, generated types/OpenAPI updates, and live runtime verification.
```

## Product Mandate

Build `/weight-loss` as a rich Forge health cockpit. The user should be able to see and edit food intake, weight trend, calorie balance, training fuel, body changes, gut health, and subjective effects in one place. The view should help the user discover personal links between food, workouts, sleep, movement, mood, energy, appearance, gut symptoms, places, and Forge notes.

This is not a simple calorie counter. Calorie balance is necessary, but the enchanting part is the personal insight layer: "this kind of dinner makes tomorrow's face look puffy," "low-carb leg day raises RPE," "late spicy meals correlate with reflux," "high-fiber lunches stabilize afternoon energy," "higher protein plus lifting preserves the look I want."

The product should be honest about uncertainty without becoming boring. Show confidence, source quality, and repeated-observation strength, but present the user with concrete next actions and experiments.

## Binding Constraints

- Work inside `/Users/omarclaw/Documents/aurel-monorepo/projects/forge`.
- All Forge git work stays on `main`.
- Respect Forge's local-first SQLite architecture, Fastify API, generated OpenAPI, React 19, TypeScript 5.x, Vite 6, Tailwind CSS 4, OpenClaw/Hermes/Codex adapter layers, and Swift iPhone companion direction.
- Use the existing `openai-codex` provider path for ChatGPT-login-backed inference:
  - `server/src/managers/platform/llm-manager.ts`
  - `server/src/managers/platform/openai-responses-provider.ts`
  - `server/src/services/openai-codex-oauth.ts`
  - Settings -> Models "OpenAI Codex OAuth"
- Do not introduce a default OpenAI Platform API key path for this feature.
- Store AI outputs as unconfirmed candidates until the user accepts them.
- Avoid medical diagnosis. This is personal tracking, pattern discovery, and experiment support.
- Appearance tracking must be private, user-defined, and non-shaming. Do not implement universal attractiveness rankings.

## Research Spine

Use the literature and product evidence below as implementation guidance:

- Digital self-monitoring supports weight loss when intake, weight, and feedback are frequent, but retention is fragile: https://pmc.ncbi.nlm.nih.gov/articles/PMC12838191/
- Ecological momentary assessment is the right method for food, appetite, cravings, mood, energy, and lapse-risk links: https://pmc.ncbi.nlm.nih.gov/articles/PMC6893429/
- Appetite can be captured with brief repeated visual analogue style ratings: https://pmc.ncbi.nlm.nih.gov/articles/PMC4302437/
- Food-craving and eating behavior can be studied with EMA: https://pubmed.ncbi.nlm.nih.gov/24930596/
- Wearable energy expenditure is useful directionally but inaccurate enough to need trend calibration: https://pmc.ncbi.nlm.nih.gov/articles/PMC7509623/
- Ultra-processed food exposure can drive greater energy intake and weight gain under controlled conditions: https://pmc.ncbi.nlm.nih.gov/articles/PMC7946062/
- Meal timing matters enough to track windows and late eating: https://pmc.ncbi.nlm.nih.gov/articles/PMC11530941/
- Higher protein and resistance training help protect lean mass during energy restriction: https://pmc.ncbi.nlm.nih.gov/articles/PMC6179508/ and https://pmc.ncbi.nlm.nih.gov/articles/PMC9285060/
- Waist-to-height ratio is a useful body-shape/cardiometabolic proxy: https://pmc.ncbi.nlm.nih.gov/articles/PMC3810792/
- Low-FODMAP and food-trigger tracking are relevant for gut symptom discovery: https://pmc.ncbi.nlm.nih.gov/articles/PMC8354978/
- Food/symptom diary apps can support IBS-style trigger discovery: https://pmc.ncbi.nlm.nih.gov/articles/PMC4822101/
- PROMIS GI domains provide a useful symptom vocabulary: https://pmc.ncbi.nlm.nih.gov/articles/PMC4285435/
- N-of-1 nutrition methods are appropriate for personal effect discovery: https://pmc.ncbi.nlm.nih.gov/articles/PMC10097352/
- Image-based dietary assessment is promising but must remain confirmation-based: https://pmc.ncbi.nlm.nih.gov/articles/PMC9776640/
- Use official food data sources:
  - USDA FoodData Central: https://fdc.nal.usda.gov/api-guide
  - Open Food Facts: https://openfoodfacts.github.io/documentation/docs/
  - ASA24 as a structured dietary recall reference: https://epi.grants.cancer.gov/asa24/
- Use state-of-the-art app ideas without copying blindly:
  - MacroFactor expenditure inference: https://help.macrofactorapp.com/en/articles/20-expenditure
  - Oura meal timing / metabolic context: https://support.ouraring.com/hc/en-us/articles/40264659421843-Meals
  - ZOE-style gut/metabolic personalization: https://zoe.com/
  - Cronometer-style micronutrient completeness: https://cronometer.com/
- ChatGPT subscription and OpenAI API billing are separate; this feature must use the existing ChatGPT/Codex OAuth path, not API billing: https://help.openai.com/en/articles/9039756-managing-billing-settings-on-chatgpt-web-and-platform

## Core Data Model

Add SQLite-backed storage for:

- Nutrition targets: calories, protein, fiber, macro ranges, weight goal, desired weekly rate, optional body-composition goal, preferred diet style.
- Food catalog cache: source, source id, barcode, name, brand, serving options, nutrients, NOVA/processing tags when available, confidence.
- Food logs: meal id, time, place/stay link, source, confirmation state, notes, linked workout/sleep/day, image ids, parser provenance.
- Meal items: food id or free-text candidate, quantity, serving unit, nutrients, confidence, user corrections.
- Body measurements: weight, waist, hip, neck, chest, arm, thigh, body-fat estimate if user supplies it, clothing fit.
- Appearance check-ins: private photo refs, face puffiness, leanness, muscularity, posture, bloating look, confidence/look score, user notes.
- Subjective check-ins: hunger, fullness, cravings, energy, focus, mood, sleepiness/crash, stress, time-relative-to-meal.
- Gut check-ins: Bristol stool type, frequency, bloating, gas, reflux, abdominal pain, urgency, nausea, constipation, diarrhea, notes.
- Nutrition hypotheses: repeated candidate links between food/timing/training/sleep/context and outcomes.
- N-of-1 experiments: hypothesis, baseline window, intervention windows, adherence, tracked outcomes, result summary.

Prefer explicit tables over hiding everything in JSON blobs. JSON is acceptable for flexible nutrient maps, parser details, and hypothesis evidence payloads.

## API And Read Model

Add a new route family under `/api/v1/health/weight-loss`.

Minimum routes:

- `GET /api/v1/health/weight-loss`
- `POST /api/v1/health/weight-loss/foods/search`
- `POST /api/v1/health/weight-loss/foods/barcode`
- `POST /api/v1/health/weight-loss/food-logs`
- `PATCH /api/v1/health/weight-loss/food-logs/:id`
- `DELETE /api/v1/health/weight-loss/food-logs/:id`
- `POST /api/v1/health/weight-loss/parse`
- `POST /api/v1/health/weight-loss/body-checkins`
- `POST /api/v1/health/weight-loss/appearance-checkins`
- `POST /api/v1/health/weight-loss/subjective-checkins`
- `POST /api/v1/health/weight-loss/gut-checkins`
- `GET /api/v1/health/weight-loss/patterns`
- `POST /api/v1/health/weight-loss/experiments`
- `PATCH /api/v1/health/weight-loss/experiments/:id`

The `GET` read model must include:

- Today ledger: intake, meals, macros, protein, fiber, key micronutrients when known, hydration/caffeine/alcohol if logged.
- Energy model: active energy, resting energy, wearable confidence, inferred TDEE, deficit/surplus, weekly trend.
- Weight/body model: trend weight, rate of change, waist-to-height, measurement deltas, appearance check-ins.
- Food quality: processing tags, fruit/vegetable/fiber/protein quality, late eating, meal timing windows.
- Training-fuel board: pre-workout fuel, post-workout recovery, protein distribution, RPE/performance links.
- Gut board: symptoms, likely lag windows, trigger candidates, FODMAP-like tags where known.
- Subjective board: energy, hunger, cravings, focus, mood, post-meal crash links.
- Hypothesis cards: possible links, confidence, evidence count, confounders, suggested next experiment.
- Data quality: logging coverage, unconfirmed AI candidates, missing high-value check-ins.

## AI Parser Contract

Use `LlmManager.runTextPrompt` or a narrow extension of that interface for multimodal input. Route through the stored `openai-codex` profile only.

The parser should accept:

- natural language meals
- pasted restaurant/menu text
- barcode lookup context
- optional photo references or multimodal image payloads when supported by the existing ChatGPT/Codex backend path
- user context: targets, recent foods, preferred units, locale, common meals

The parser must return strict JSON:

- candidate meal time
- items with names, quantities, serving units, confidence, and alternate interpretations
- source database match hints
- estimated nutrients
- uncertainty reasons
- clarification questions when needed
- tags: high protein, high fiber, high sodium, high fat, spicy, alcohol, caffeine, dairy, gluten, high FODMAP candidate, ultra-processed candidate, pre-workout, post-workout, late meal

Persist parser results as unconfirmed candidates. The user must accept, correct, or discard them before they affect serious metrics.

If the OpenAI Codex OAuth profile is missing, show setup guidance for Settings -> Models. Do not silently fall back to OpenAI API billing.

## UI Requirements

Add a Health route `/weight-loss` with a serious, dense, Forge-native dashboard.

Required sections:

- Top summary: trend weight, weekly change, average deficit, protein coverage, logging coverage, main insight.
- Today ledger: meals, fast edit, unconfirmed candidates, source confidence.
- Log food panel:
  - text/chat
  - barcode
  - food search
  - saved meals
  - photo
  - manual entry
- Body board:
  - weight trend
  - waist and measurement trends
  - appearance check-in strip
  - private photo timeline if photos exist
- Sports-food board:
  - training sessions
  - pre/post workout nutrition
  - protein distribution
  - RPE/performance/recovery links
- Gut board:
  - Bristol/stool state
  - symptom timeline
  - food trigger candidates
- Energy/mood board:
  - post-meal energy
  - hunger/cravings
  - focus/mood/stress
- Hypothesis lab:
  - generated possible links
  - confidence and confounders
  - start experiment button
- Data quality panel:
  - missing logs
  - weak source data
  - unconfirmed AI estimates
  - prompt to add the highest-value next check-in

Design should fit the existing Forge health pages and route catalog. Keep mobile and desktop usable in the same pass.

## Metrics To Implement

Core:

- trend weight
- weekly weight rate
- calorie intake
- active/resting energy
- inferred TDEE
- deficit/surplus
- protein per kg
- fiber
- logging coverage
- source confidence

Nutrition quality:

- protein distribution across meals
- fiber consistency
- sodium and potassium when known
- caffeine and alcohol if logged
- fruit/vegetable servings when inferable
- NOVA/ultra-processed flag when available
- Nutri-Score/Open Food Facts fields when available
- micronutrient completeness when FoodData Central detail supports it

Sports/food interaction:

- pre-workout fuel window
- post-workout protein/carbs
- RPE/perceived effort link
- workout performance link
- soreness and recovery link
- HRV/resting HR/sleep-recovery link
- low-energy-availability warning when intake is repeatedly low relative to training load

Appearance/body:

- waist-to-height
- waist-to-hip
- measurement deltas
- clothing fit
- face puffiness
- leanness
- muscularity
- posture
- bloating look
- user confidence/look score

Subjective:

- hunger
- fullness
- cravings
- mood
- energy
- focus
- stress
- sleepiness/crash
- time since meal

Gut health:

- Bristol stool type
- stool frequency
- bloating
- gas
- reflux
- abdominal pain
- urgency
- nausea
- constipation
- diarrhea
- candidate trigger tags and lag windows

Pattern discovery:

- same-day links
- 2-hour post-meal links
- next-morning links
- 24-48h gut symptom links
- confounders: sleep, stress, alcohol, training load, cycle, travel, place, illness, late meals
- evidence count and confidence

## Forge Entity Links

Link nutrition records to existing Forge entities wherever useful:

- Movement stays and places
- workouts and training load
- sleep nights
- vitals
- Psyche observations, mood, behaviors, triggers, values
- notes/wiki pages
- calendar events
- projects/tasks when diet is linked to work performance
- companion HealthKit sync data where available

Add a compact weight-loss summary to the operator overview so OpenClaw, Hermes, and Codex can reason over the surface without raw-log dumping.

## OpenClaw, Hermes, And Codex Tools

Add or update agent tools and skill playbooks for:

- `forge_get_weight_loss_overview`
- `forge_log_food`
- `forge_search_foods`
- `forge_parse_food_log_with_chatgpt`
- `forge_log_body_checkin`
- `forge_log_appearance_checkin`
- `forge_log_gut_checkin`
- `forge_log_subjective_food_effect`
- `forge_get_nutrition_patterns`
- `forge_start_nutrition_experiment`
- `forge_update_nutrition_experiment`

Tool descriptions must make clear:

- AI estimates are candidates until confirmed.
- Food/photo parsing uses ChatGPT/Codex OAuth, not OpenAI API billing.
- Ordinary raw CRUD should use the dedicated health/weight-loss route family.
- Insight requests should start by reading the overview.

Update OpenClaw/Hermes/Codex parity tests so the tool surface stays synchronized.

## Implementation Order

1. Add backend nutrition/body/gut/subjective schemas, persistence, and read model.
2. Add API routes and OpenAPI schema.
3. Add FoodData Central and Open Food Facts lookup/cache.
4. Add AI parser contract through `openai-codex` only.
5. Add React API wrappers/types.
6. Add `/weight-loss` route, route catalog entry, nav entry, and page UI.
7. Add OpenClaw/Hermes/Codex tools and skill-playbook parity.
8. Add hypothesis generation and N-of-1 experiment support.
9. Add tests and generated artifacts.
10. Run required Forge verification: type-check, focused tests, backend health, live UI route.

## Acceptance Criteria

The goal is complete when:

- `/weight-loss` exists and renders a complete responsive Forge health surface.
- A user can log food by text, search, barcode, manual entry, saved meal, and photo/candidate flow.
- Food logs remain editable and deletable.
- Food lookup uses USDA FoodData Central and Open Food Facts with local caching.
- AI parsing uses the existing ChatGPT/Codex OAuth backend path only.
- No new default OpenAI API billing path exists for this feature.
- Unconfirmed AI candidates do not distort final metrics until accepted.
- The overview calculates calorie balance, trend weight, inferred TDEE, protein, fiber, food quality, body metrics, subjective metrics, gut metrics, and data quality.
- The surface links meals to workouts, sleep, movement, places, vitals, Psyche, notes, and calendar context where data exists.
- Hypothesis cards identify repeated personal patterns with evidence and confounders.
- N-of-1 experiments can be created and summarized.
- OpenClaw, Hermes, and Codex expose the weight-loss/nutrition tools.
- OpenAPI/types/tests are updated.
- Forge verification passes, including live route verification.

## Non-Goals For V1

- No medical diagnosis.
- No eating-disorder treatment workflow.
- No universal attractiveness score.
- No paid OpenAI API fallback.
- No cloud-first storage.
- No pretending wearable calorie burn is exact.
- No automatic permanent logging from AI guesses without user confirmation.

# Goal: Forge Weight Loss, Nutrition, And Body Insight Surface

## Goal Prompt

Use this prompt to start the `/goal` run:

```text
/goal Implement the Forge Weight Loss, Nutrition, and Body Insight surface described in /Users/omarclaw/Documents/aurel-monorepo/projects/forge/docs/weight-loss-nutrition-insight-goal.md.

Work on Forge main only. Read the applicable AGENTS.md files and Forge .vision files first. Build this as a first-class Forge health surface, not a MyFitnessPal clone.

The feature must combine calorie balance, food logging, body trend, subjective energy, gut symptoms, appearance check-ins, sports/food interaction, and Forge entity links into one personal pattern-discovery system.

Use the existing OpenAI Codex OAuth / ChatGPT subscription-backed provider path already present in Forge and OpenClaw/Hermes. Do not add or default to OpenAI Platform API-key billing for v1. AI food parsing and photo interpretation must go through the existing openai-codex provider contract or a narrow extension of that contract.

The guided plan flow must ask current state first, prefill every known value from Forge/iOS data, then ask the objective, generate sane default target weight and weekly rate values, then show active calories as independent evidence, and only then compute calories, macros, micronutrients, and sport-loss ranges. Active calories must never change because the user chooses lose, gain, or maintain.

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
- All questionnaires and setup/edit flows must be guided modal flows using Forge's `QuestionFlowDialog`-style components. Do not place long questionnaire forms directly on the page.
- The weight plan must separate physiology, activity evidence, and objective math. Current state drives resting energy; HealthKit/workout/movement evidence drives active energy; the user's objective only adds a signed deficit or surplus.
- Known height, age, sex, latest weight, HealthKit basal energy, HealthKit active energy, workout energy, and movement calories must prefill the flow when Forge already has them.

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
  - MacroFactor logging requirements for expenditure inference: https://help.macrofactorapp.com/en/articles/110-how-frequently-do-i-need-to-log-my-nutrition-for-the-expenditure-algorithm-and-weekly-coaching-updates
  - Oura meal timing / metabolic context: https://support.ouraring.com/hc/en-us/articles/40264659421843-Meals
  - ZOE-style gut/metabolic personalization: https://zoe.com/
  - Cronometer-style micronutrient completeness: https://cronometer.com/
- ChatGPT subscription and OpenAI API billing are separate; this feature must use the existing ChatGPT/Codex OAuth path, not API billing: https://help.openai.com/en/articles/9039756-managing-billing-settings-on-chatgpt-web-and-platform

## Litterature

This section records the nutrition and HealthKit evidence used for the target model so the product decisions stay inspectable.

Energy target formula:

Forge should compute target calories in separate steps, because current body state, basal/resting burn, active burn, and weight objective are different concepts.

1. Resolve the current state. Prefill sex, age, height, latest body weight, and recent body measurements from Forge. The latest `nutrition_body_checkins.weight_kg` is the user's editable body-weight source for this surface; HealthKit `bodyMass` must seed `weightTrend.latestWeightKg` when no nutrition check-in exists yet. If height/age/sex are missing, ask in the modal setup flow and persist them with the nutrition target profile so they can be edited later.
2. Estimate or read resting burn. When HealthKit basal/resting energy exists, use it as measured evidence. Otherwise use Mifflin-St Jeor resting energy because it is a standard adult predictive equation: male `10 * weight_kg + 6.25 * height_cm - 5 * age + 5`; female `10 * weight_kg + 6.25 * height_cm - 5 * age - 161`. Source: Mifflin et al. and Endotext reference table: https://pubmed.ncbi.nlm.nih.gov/2305711/ and https://www.ncbi.nlm.nih.gov/sites/books/NBK278991/table/diet-treatment-obes.table12est/?report=objectonly
3. Add active burn independently from the user's objective. HealthKit active energy, workout energy, and movement-trip calories are evidence about activity. They must not change because the user selects lose, gain, or maintain. The maintenance estimate is `resting_or_basal_kcal + active_burn_kcal`. If both HealthKit daily active energy and workout/movement fallback exist, the read model should prefer HealthKit daily active energy for the primary active-burn field and keep workout/movement values visible as source breakdown.
4. Ask what the user wants to do. The user chooses `lose`, `gain`, or `maintain`; the UI then proposes default target weight and weekly rate values from the current weight. Do not ask for an uncontextualized target weight before asking the objective. For maintain, default target weight equals current weight and weekly rate is `0`.
5. Apply the objective delta only after maintenance is known. The planning model uses roughly `7700 kcal/kg` as a simple first-pass energy equivalent, while acknowledging that dynamic body-weight models are better over long horizons. For a weekly goal rate, `daily_delta_kcal = weekly_rate_kg * 7700 / 7`; loss is negative, gain is positive. Therefore `target_kcal = resting_or_basal_kcal + active_burn_kcal + daily_delta_kcal`. NIH/Pennington work notes the limitations of the static 3500 kcal/lb rule and points toward dynamic models for future refinement: https://pmc.ncbi.nlm.nih.gov/articles/PMC3810417/ and https://www.niddk.nih.gov/research-funding/at-niddk/labs-branches/laboratory-biological-modeling/integrative-physiology-section/research/body-weight-planner
6. Clamp clearly, not silently. Forge should warn when the requested loss rate implies an overly low intake. V1 uses a practical unsupervised floor of about `1200 kcal/day` for female profiles and `1500 kcal/day` for male profiles, then should explain that the requested weekly rate was slowed or the calorie target was floored. CDC/NIDDK public guidance emphasizes gradual loss of about `1-2 lb/week` and safe programs over crash targets: https://www.cdc.gov/healthy-weight-growth/losing-weight/index.html and https://www.niddk.nih.gov/health-information/weight-management/choosing-a-safe-successful-weight-loss-program

Default weight-change rates:

Forge should propose defaults instead of asking the user to invent everything. For fat loss, default to about `0.5% of current body weight per week`, with a practical guardrail around `0.2 kg/week` minimum and about `1% body weight/week` as the faster end for most users. NIH obesity guidance has commonly used a 500-1000 kcal/day deficit to target roughly 0.5-1 kg/week, while athlete-focused literature favors slower loss to protect performance and lean mass. Sources: https://pmc.ncbi.nlm.nih.gov/articles/PMC3447534/ and https://pubmed.ncbi.nlm.nih.gov/21558571/

For mass gain, default much slower, around `0.25% body weight/week`, because surplus weight gain becomes fat-heavy quickly when the surplus is large. Forge should frame this as a starting value and update from the user's actual scale trend.

Macro targets:

- Protein should be substantially above the sedentary RDA when the user is training or losing weight. ISSN's 2017 protein stand supports about `1.4-2.0 g/kg/day` for most exercising people, and higher intakes can help body composition during hypocaloric training. Forge defaults to about `2.0 g/kg` for loss, `1.8 g/kg` for gain, and `1.6 g/kg` for maintenance unless the user customizes it. Source: https://link.springer.com/article/10.1186/s12970-017-0177-8
- The protein multiplier must not blindly use current body mass when that makes the target mathematically impossible or inappropriate. For loss, use the lower of current weight and target weight as the first reference. For high-BMI profiles, use an adjusted reference weight for protein and fat-floor generation: the weight at BMI 25 plus 25% of the excess above that reference. Then cap protein calories at roughly 45% of the calorie target in v1. This keeps the plan high-protein without producing a 1600 kcal protein target inside a 1200 kcal plan. Future versions can refine this with body-fat percentage or lean-mass measurements when the user provides them.
- Fat should not be treated as a careless leftover after protein. NASEM AMDR for adults is `20-35%` of energy from fat; Forge uses a practical floor around `0.6 g/kg` and keeps the generated target in that AMDR region when possible. Source: https://www.ncbi.nlm.nih.gov/books/NBK208874/table/ttt00023/?report=objectonly
- Carbohydrate AMDR for adults is `45-65%` of energy and the adult RDA is `130 g/day`. Forge uses carbs as remaining training fuel after protein and fat, but it must not force a `130 g` floor when that would make macro calories exceed the calorie target. The UI should show the actual plan target plus a visible `130 g/day` DRI reference/caveat. On heavy training days the plan can suggest eating back some verified active burn as carbohydrate, but this is a day-level fuel adjustment, not a change to basal metabolism. Source: https://www.ncbi.nlm.nih.gov/books/NBK208874/table/ttt00022/?report=objectonly
- Fiber targets should keep the common planning rule of about `14 g / 1000 kcal` separate from the sex/age adult AI. For a `1500 kcal/day` plan, the energy-adjusted fiber target is about `21 g/day`; a `38 g/day` adult male AI is still useful as a reference or stretch value, but Forge should not present it as if it were derived from the low-calorie plan. Source: https://www.ncbi.nlm.nih.gov/books/NBK208874/table/ttt00022/?report=objectonly
- Saturated fat and added sugar should be shown as ceilings, not goals. The 2025-2030 Dietary Guidelines remain the current U.S. federal guidance and emphasize real foods, limiting highly processed foods and added sugars; the longstanding practical ceiling for saturated fat remains under 10% of energy in the detailed guidance ecosystem. Current DGA entry point: https://www.fns.usda.gov/cnpp/dietary-guidelines-americans and PDF: https://cdn.realfood.gov/DGA.pdf

Vitamin, mineral, and oligoelement targets:

Forge should expose a detailed daily target table for vitamins, minerals, and trace elements instead of only calories/macros. For adults who are not pregnant or lactating, the default targets should come from NASEM Dietary Reference Intakes, adjusted by sex and age where the tables differ. The target table should include vitamin A, C, D, E, K, thiamin, riboflavin, niacin, B6, folate, B12, pantothenic acid, biotin, choline, calcium, iron, magnesium, phosphorus, zinc, iodine, selenium, copper, manganese, chromium, molybdenum, fluoride, chloride, sodium ceiling, potassium, total water, linoleic acid, and alpha-linolenic acid. Sources: https://www.ncbi.nlm.nih.gov/books/NBK208874/, https://www.ncbi.nlm.nih.gov/books/NBK208874/table/ttt00018_1/?report=objectonly, https://www.ncbi.nlm.nih.gov/books/NBK208874/table/ttt00020_1/?report=objectonly, and NIH/FDA Daily Values reference: https://dsld.od.nih.gov/daily-values

Hydration and sport losses:

The total-water baseline is an Adequate Intake, not a rigid water-bottle prescription: about `3.7 L/day` for adult men and `2.7 L/day` for adult women from food plus beverages in temperate conditions. Source: https://www.nationalacademies.org/cdn/materials/9fb9fad7-cdf7-4adf-a89d-f1638016b70c

Exercise losses must be shown as ranges. ACSM sports nutrition guidance reports sweat rates from about `0.3-2.4 L/h`, with many athletes' practical fluid plans around `0.4-0.8 L/h`, and recommends customizing by pre/post-exercise body weight. Sodium loss is highly variable; average sweat sodium is roughly around `50 mmol/L` or about `1 g/L`, and sodium is the dominant electrolyte for fluid balance. Sources: https://sky.sausport.com/wp-content/uploads/2021/02/American-College-of-Sports-Medicine_Joint-Position_Nutrition_and_Athletic_Performance_2016.pdf and https://link.springer.com/article/10.1007/s40279-017-0691-5

Forge's v1 sport-loss model should therefore:

- estimate training hours from active burn with a conservative `500 kcal/hour` assumption;
- show sweat fluid as a planning range, initially `0.4-0.8 L/hour`;
- show sodium loss as a range, initially about `500-1000 mg/L sweat`;
- show potassium as a smaller range because sweat potassium is commonly around `2-8 mmol/L`;
- call this "expected loss" and invite calibration by body mass before/after workouts, not call it a supplement prescription.

Why movement kcal and active burn were `n/a`:

The immediate bug was architectural, not just visual. The weight-loss read model returned `activeBurnKcal: null` and `movementCaloriesKcal: null` even though Forge already stored relevant evidence elsewhere:

- iOS HealthKit sync requests HealthKit activity permissions and exports basal energy, exercise time, step count, workout active energy, workout total energy, and workout-associated active-energy samples.
- Forge stores HealthKit daily summaries in `health_daily_summaries`, workout energy in `health_workout_sessions.active_energy_kcal` and `total_energy_kcal`, and passive movement-trip calories in `movement_trips.calories_kcal`.
- Forge also stores HealthKit body mass inside `health_daily_summaries.metrics_json.bodyMass`. The weight-loss read model must use that as the latest weight seed when no `nutrition_body_checkins.weight_kg` exists.
- The weight-loss read model must compose those canonical sources instead of inventing a separate calorie store. Daily HealthKit active energy should be the preferred active-burn signal; workout energy plus movement-trip calories are fallback evidence; inferred TDEE from the target is only a last resort and must be labeled as target inference.

The sound architecture is: iOS collects provider-native HealthKit evidence; Fastify persists it in canonical provider-neutral tables; the weight-loss read model composes the existing health/movement stores; React renders targets and confidence from that read model. React should not calculate missing active burn from scratch.

Required ingestion contract:

- iOS companion must request and read `HKQuantityTypeIdentifier.activeEnergyBurned`, `basalEnergyBurned`, `appleExerciseTime`, `stepCount`, `bodyMass`, and workout energy quantities when HealthKit permissions allow them.
- The companion sync payload must carry daily active-energy and basal-energy summaries as metric records with stable keys `activeEnergyBurned` and `basalEnergyBurned`, including unit, aggregation, source, and date window.
- Fastify must persist those records into `health_daily_summaries.metrics_json` under `summary_type='vitals'`, preserve workout energy in `health_workout_sessions`, and preserve movement-trip estimates in `movement_trips`.
- `GET /api/v1/health/weight-loss` must expose `energyModel.sourceAvailability`, `activeBurnKcal`, `activeEnergyCalories`, `restingEnergyCalories`, `movementCaloriesKcal`, `workoutEnergyKcal`, `exerciseMinutesAverage`, `stepCountAverage`, and `weightTrend.latestWeightSource`.
- Tests must cover the non-`n/a` path: after inserting or syncing HealthKit daily active/basal energy plus movement calories, the weight-loss overview returns those fields and the plan dialog pre-fills them. Tests must also cover the HealthKit `bodyMass` fallback so first-run setup can default to known weight before the user adds a nutrition-specific body check-in.

Actionable personal metrics beyond calorie counting:

- Body-composition direction: trend weight, weekly weight rate, waist-to-height ratio, waist-to-hip ratio, body-fat estimate when supplied, measurement deltas, and clothing fit.
- Look/aesthetic metrics: user-defined private ratings for face puffiness, leanness, muscularity, posture, abdomen/bloating look, vascularity/fullness if the user enables it, and a confidence/look score that is personal rather than universal.
- Sport-food interaction: pre-workout carbohydrate/protein window, post-workout protein/carbohydrate recovery, RPE, performance, soreness, HRV/resting-HR context, sleep context, and low-energy-availability warning when intake is repeatedly low relative to training.
- Subjective response: hunger, fullness, cravings, energy, focus, mood, stress, sleepiness, crash score, and time relation to meal. Brief repeated ratings follow EMA/visual-analogue-style practice rather than long retrospective questionnaires.
- Gut health: Bristol stool type, stool frequency, bloating, gas, reflux, abdominal pain, urgency, nausea, constipation, diarrhea, suspected trigger tags, and lag windows of same-meal, 2-hour, next-morning, and 24-48h.
- Food quality: protein density, fiber density, fruit/vegetable servings when inferable, sodium/potassium, caffeine/alcohol, added sugar, saturated fat, NOVA/ultra-processed exposure, Nutri-Score/Open Food Facts fields, and micronutrient completeness when the food source supports it.
- Pattern discovery: evidence count, lag window, effect size direction, repeated-observation strength, and confounders such as sleep, stress, alcohol, training load, cycle, travel, illness, late meals, and place.

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
  - custom food creation only after search; custom entries must include calories,
    protein, carbohydrate, and fat for the serving so they can be reused from the
    local food catalog instead of becoming name-only meal fragments
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
- Forge keeps a local custom food database inside `nutrition_food_catalog`; custom
  foods are searchable/reusable by `foodId`, deduped by normalized serving identity,
  and cannot be saved without calories plus protein, carbohydrate, and fat.
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

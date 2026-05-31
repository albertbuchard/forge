# Forge Training Load Zone Intelligence Plan

## Copy/Paste Goal Prompt

```text
/goal Implement Forge Training Load Zone Intelligence from projects/forge/docs/training-load-zone-intelligence-plan.md. Build on the existing /api/v1/health/training-load read model and /forge/training-load React view, which already expose summary load metrics, all-time and 28-day zone totals, low/moderate/high intensity distribution, daily/weekly load, activity breakdown, vitals trend, session signals, and target notes. Extend that existing surface with read-only zone-time analytics, selectable smart training modes, personal-baseline comparisons, TRIMP/load-rate context, and next-week/next-workout target guidance. Keep one canonical route, one TrainingLoadViewData contract, and the existing forge_get_training_load_overview tool; do not create a parallel API or mutate workout data. The backend should derive canonical daily, weekly, and monthly time-in-zone buckets plus all smart-mode scores from stored workout sessions and HR analytics; the UI should only choose presentation interval/mode client-side. Use evidence-based elite-sport methodology and pro-tool patterns: HRR/Karvonen 5-zone time, 3-domain low/moderate/high rollups, TRIMP/internal load, TRIMP-per-minute/load-per-hour, acute/chronic load, freshness/load-balance, monotony/strain, hard-day spacing, zone 2/base development, pyramidal/polarized distribution context, and 4x4 VO2max interval guardrails. Update OpenAPI, TypeScript types, compact overview, OpenClaw/Hermes/Codex docs, plugin build artifacts, and parity tests. Verify backend calculations, frontend responsive rendering, plugin parity, and live source-backed dev serving at http://127.0.0.1:4317/forge/ with /forge/@vite/client and /forge/src/main.tsx. Do not delete or mutate workout/user data; keep Forge on main.
```

## Summary

Extend the existing Forge `/training-load` surface into a zone intelligence cockpit without changing its architectural role. `/api/v1/health/training-load` remains the single read-model endpoint. `TrainingLoadViewData` grows with derived zone-time buckets and smart training intelligence; no new persistence tables, no write routes, and no duplicate training-load subsystem are introduced.

The user experience has two layers:

- A basic report, weekly by default, showing how much time the user spent in each HR zone and in the low/moderate/high 3-domain model.
- A pro-style interpretation layer with selectable modes: `combat_readiness`, `aerobic_base`, and `endurance_pro`. Each mode scores the current training pattern and proposes next-week and next-workout guardrails.

## Existing Forge Foundation

Do not rebuild or duplicate the current v1 training-load surface. The code already has these pieces:

- Backend:
  - `server/src/health.ts` exports `getTrainingLoadViewData(userIds?)`
  - `server/src/app.ts` exposes `GET /api/v1/health/training-load`
  - the route returns `summary`, `zoneTotals`, `recentZoneTotals`, `intensityDistribution`, `recentIntensityDistribution`, `dailyLoad`, `weeklyLoad`, `activityBreakdown`, `vitalsTrend`, `sessionSignals`, and `targetModel`
  - `summary` already includes session count, reliable session count, total hours, total training load, acute 7-day load, chronic 28-day weekly load, acute:chronic ratio, monotony, strain, high-intensity minutes, threshold minutes, easy minutes, hard-day count, HR coverage, VO2max, resting HR, and readiness
  - `weeklyLoad` already has 26 weeks of duration, load, load per hour, low/moderate/high seconds and percentages, and high-intensity minutes
  - `dailyLoad` already has 90 days of load and low/moderate/high minutes
  - all-time and recent zone distributions already exist, but only as aggregate totals rather than per-bucket time series

- Frontend:
  - `src/pages/training-load-page.tsx` is the existing view
  - it already renders metric tiles, weekly load map, adaptation radar, intensity target bands, HR zones, daily load texture, recent session signals, sport contribution, and interpretation guardrails
  - it already uses Recharts, `ChartBox`, selected-user scope, and `getTrainingLoadView(selectedUserIds)`
  - it currently has only a simple `recent/all` window selector, not mode or interval selectors

- Agent/plugin surface:
  - `forge_get_training_load_overview` already exists
  - OpenClaw route parity already mirrors `/api/v1/health/training-load`
  - OpenAPI already has `TrainingLoadViewData`
  - skills/playbooks already instruct agents to use the training-load read model for cardiovascular load, HR zones, acute/chronic stress, VO2max context, and target analysis

The missing parts are specifically: per-day/per-week/per-month 5-zone time buckets, monthly buckets, load-per-minute, personal-baseline ratios, mode-specific smart scores, mode-specific next-week targets, mode-specific next-workout guidance, and the UI controls/cards for those additions.

## Backend Contract

Extend `TrainingLoadViewData` in a backward-compatible additive way:

- Add `zoneTimeSeries`:
  - shape: `{ daily: ZoneTimeBucket[], weekly: ZoneTimeBucket[], monthly: ZoneTimeBucket[] }`
  - `daily` covers the same last 90-day horizon as `dailyLoad`
  - `weekly` covers the same last 26-week horizon as `weeklyLoad`
  - `monthly` covers the last 12 calendar months
  - each bucket includes `bucketKey`, `startDate`, `endDate`, `sessionCount`, `durationSeconds`, `hrCoveredSeconds`, `trainingLoad`, `loadPerHour`, `loadPerMinute`, `baselineLoadRatio`, `baselineIntensityRatio`, `zoneSeconds`, `zoneMinutes`, `zonePercentages`, `domainSeconds`, `domainMinutes`, `domainPercentages`, `hardDayCount`, `averageHrCoverage`, `heartRateSampleCount`, and `confidence`
  - `zoneSeconds` keys are exactly `below_z1`, `zone_1`, `zone_2`, `zone_3`, `zone_4`, `zone_5`
  - `domain*` keys are exactly `low`, `moderate`, `high`, with low = below Z1 + Z1, moderate = Z2 + Z3, high = Z4 + Z5

- Add `trainingIntelligence`:
  - shape: `{ defaultMode: "combat_readiness", modes: TrainingIntelligenceMode[] }`
  - each mode includes `key`, `label`, `score`, `status`, `confidence`, `summary`, `drivers`, `limitingFactors`, `loadBalance`, `nextWeekTargets`, `nextWorkout`, and `methodologyNotes`
  - `nextWeekTargets` includes total suggested minutes, zone-minute targets, domain-minute targets, max hard sessions, minimum easy/base minutes, and warning text when current load is too high
  - `nextWorkout` includes recommended session type, intensity ceiling, suggested duration range, whether 4x4 is currently appropriate, and the reason

Implementation should keep derivation inside `server/src/health.ts` using pure helper functions beside the existing training-load helpers:

- bucket sessions by UTC day, ISO week, and calendar month
- reuse existing `WORKOUT_ZONE_ORDER`, `zoneSeconds`, `workoutLoad`, `workoutHrCoverage`, `workoutHrSampleCount`, and current TRIMP/HRR analytics
- compute all three intelligence modes server-side so OpenClaw/Hermes/Codex receive the same interpretation as the web UI
- keep `userIds` query behavior unchanged
- keep missing-HR behavior explicit: zero zone seconds, low confidence, and no fabricated time-in-zone

## Professional Tool Parity

The feature should deliberately mirror the useful parts of serious athlete-monitoring tools without copying their proprietary models or names.

- TrainingPeaks-style load planning:
  - preserve Forge’s existing 7-day acute and 28-day chronic load, and add a simple `loadBalance` object for each intelligence mode
  - describe it as Forge freshness/load-balance, not as CTL/ATL/TSB unless those exact TrainingPeaks definitions are implemented
  - use load-balance to inform “recover / maintain / build / sharpen” guidance

- Firstbeat/Polar-style internal load:
  - keep TRIMP/internal load as the primary cardiovascular strain metric
  - add `loadPerMinute` alongside `loadPerHour` so the same load can be distinguished as long-easy vs short-hard
  - use load rate in next-workout guidance, especially for 4x4 and hard kickboxing days

- Garmin-style focus buckets:
  - expose low/moderate/high training-domain distribution next to the detailed HR zones
  - make “low aerobic shortage,” “high aerobic pressure,” and “anaerobic/high-domain excess” explainable through domain minutes, not opaque labels

- Catapult-style personal benchmarking:
  - compare recent bucket load and intensity against the user’s own recent baseline instead of only against generic target bands
  - use baseline ratios as context, not hard pass/fail judgments

- Coach-facing constraints:
  - every score must show its top drivers and limiting factors
  - every recommendation must be traceable to current load, zone split, hard-day spacing, and confidence
  - no metric should claim injury prediction or clinical diagnosis

## Scoring Method

The smart modes should be deterministic and explainable, not a black-box “AI coach.”

- `combat_readiness`
  - rewards controlled high-intensity exposure, enough low/base work, hard-day spacing, and good HR evidence
  - penalizes excessive Z4/Z5, high ACWR, high strain, too many hard days, and insufficient low-intensity support
  - treats kickboxing/sparring days with material Z4/Z5 as hard sessions

- `aerobic_base`
  - rewards low-domain volume, Z2/base consistency, stable chronic load, and limited high-intensity interference
  - recommends more easy/base work when high intensity is already high
  - recommends recovery rather than more Zone 2 if ACWR/strain is elevated

- `endurance_pro`
  - compares recent distribution against polarized/pyramidal elite-practice ranges without treating 80/20 as universal law
  - rewards high low-intensity share, small controlled high-intensity dose, and low threshold-gray-zone dominance
  - uses acute/chronic and freshness-style thinking through existing chronic 28-day and acute 7-day load, without renaming them as TrainingPeaks metrics

4x4 interval guidance should only be positive when all are true:

- current `readiness` is not `overload_watch`
- recent high-domain exposure is inside target range
- hard-day count and hard-day spacing are acceptable
- HR coverage/confidence is sufficient
- there is no obvious need for recovery-first guidance

ACWR, monotony, and strain are monitoring flags only. The UI copy must avoid medical or injury-prediction claims.

## Frontend Changes

Update the existing `/forge/training-load` page instead of creating a new route.

- Add a “Zone Intelligence” section above or immediately after the current weekly load map.
- Default presentation:
  - mode: `Combat`
  - interval: `Week`
  - chart: stacked zone-time bars using `zoneTimeSeries.weekly`
  - table: compact weekly rows with total minutes, each zone, low/moderate/high split, training load, hard days, and confidence
- Add segmented controls for:
  - mode: Combat / Base / Endurance
  - interval: Week / Month / 90 days
- Show one smart score card for the selected mode:
  - score, status, confidence
  - top positive drivers
  - top limiting factors
  - next-week targets
  - next-workout recommendation
- Preserve the existing page sections for load map, adaptation radar, target bands, HR zones, daily load texture, session signals, sport contribution, and guardrails.
- Mobile layout must remain one-column, readable, and touch-friendly. Dense tables may use contained horizontal scroll, but the page itself must not overflow the viewport.

Use Recharts consistently with the current page. Do not introduce a second plotting library for this feature.

## Agent, OpenAPI, And Docs

- Regenerate OpenAPI after adding `zoneTimeSeries` and `trainingIntelligence`.
- Keep `forge_get_training_load_overview` as the single OpenClaw tool for this surface.
- Update compact operator overview to include a compact `trainingIntelligence` summary with default mode score, readiness, next workout recommendation, and latest weekly zone split.
- Update OpenClaw/Hermes/Codex skill/playbook docs so agents can answer:
  - “how much time did I spend in each zone this week?”
  - “am I doing too much high intensity?”
  - “should I do Zone 2, 4x4, recovery, or kickboxing next?”
  - “what should next week’s zone targets be?”

## Evidence Base

Document these as methodology references in docs or concise code comments where useful:

- Seiler-style elite intensity distribution and 80/20 context: https://pubmed.ncbi.nlm.nih.gov/20861519/
- Elite TID review, polarized vs pyramidal nuance: https://pubmed.ncbi.nlm.nih.gov/26578968/
- IOC load monitoring consensus: https://pubmed.ncbi.nlm.nih.gov/27535989/
- 4x4/VO2max interval evidence: https://pubmed.ncbi.nlm.nih.gov/17414804/
- Training-intensity distribution classification and phase nuance: https://pmc.ncbi.nlm.nih.gov/articles/PMC10641476/
- TrainingPeaks Performance Management Chart concepts: https://www.trainingpeaks.com/learn/articles/what-is-the-performance-management-chart/
- Firstbeat TRIMP and TRIMP/min practice: https://www.firstbeat.com/en/blog/what-is-trimp/
- Garmin low/high/anaerobic load focus pattern: https://support.garmin.com/en-US/?faq=SEkNpdGyhR917js0qQL3Q6
- Catapult volume/intensity/overall benchmark pattern: https://support.catapultsports.com/hc/en-us/articles/9543326819727-Understanding-Volume-Intensity-and-Overall-Load
- ACWR caveat and pitfalls: https://pubmed.ncbi.nlm.nih.gov/32502973/

## Test Plan

- Backend tests:
  - day/week/month buckets aggregate zone seconds and domain seconds correctly
  - 3-domain totals exactly match the relevant 5-zone totals
  - missing HR data lowers confidence and never fabricates zone time
  - mode scores respond correctly to base-heavy, threshold-heavy, high-intensity-heavy, overloaded, underloaded, and low-data fixtures
  - load-per-minute separates short-hard sessions from long-easy sessions with similar total load
  - baseline ratios compare the current bucket against the user’s own prior buckets without failing on sparse history
  - next-week targets clamp when ACWR, strain, or hard-day count is high
  - 4x4 guidance is blocked when recent hard load or confidence makes it inappropriate

- Frontend tests:
  - weekly zone-time report renders by default
  - mode and interval controls switch displayed data without refetching
  - next-week and next-workout recommendations render for all modes
  - low-confidence and missing-VO2max states are readable
  - selected user scope is passed to `getTrainingLoadView`

- Contract/plugin tests:
  - OpenAPI includes the new additive fields
  - OpenClaw route parity still mirrors `/api/v1/health/training-load`
  - `forge_get_training_load_overview` exposes the new smart summary
  - skill/playbook parity mentions zone-time reporting and selectable modes

- Live verification:
  - `npx tsc --noEmit`
  - `npm run test`
  - `npm run test:server`
  - `npm run build`
  - `npm run build:openclaw-plugin`
  - `npm run check:openclaw-plugin`
  - verify source-backed dev mode at `http://127.0.0.1:4317/forge/training-load`
  - verify `/forge/` contains `/forge/@vite/client` and `/forge/src/main.tsx`
  - capture desktop and mobile screenshots and confirm no page-level horizontal overflow or console/page errors

## Assumptions

- This is a read-model feature only. No workout rows, HR samples, zone profiles, or user data are mutated.
- Weekly is the default interval because it matches training microcycle review and the user’s request.
- The UI exposes all three modes and defaults to `Combat readiness`, but the API always returns all modes.
- Existing TRIMP/HRR calculations remain the source of truth unless a future physiology-profile feature adds lactate or ventilatory-threshold inputs.
- The implementation remains on Forge `main` and follows the documented source-backed development serving contract.

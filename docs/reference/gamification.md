# Gamification and XP

Forge records XP as an explainable ledger. Overview and Settings Rewards derive levels, streaks, progress targets, and recent activity from that ledger; they do not maintain a separate XP total.

## Progress rules

- Automatic rules award XP for supported Forge activity such as task completion, task runs, habit outcomes, entity creation, Psyche work, weekly reviews, workouts, and bounded session activity.
- A disabled rule awards no XP for new activity. Changing a rule affects future awards; it does not rewrite existing ledger history.
- A retry with the same stable activity identity produces one XP award. Manual adjustments can provide `metadata.idempotencyKey`; the key is bound to the authorized owner and complete adjustment payload. An exact retry returns the original adjustment, while reuse with changed content returns `409 reward_idempotency_conflict`.
- Correcting task points records only the XP difference. Reopening the task reverses the complete net completion award, including prior point corrections.
- Correcting a habit outcome reverses the prior outcome once and records one replacement award or penalty. Retrying the same outcome does not add another entry.
- Manual adjustments, corrections, reversals, and penalties do not extend the activity streak.

## Time and streaks

A streak day is a local calendar day in the validated `timezone` query value or the runtime IANA timezone. The XP response returns the timezone it applied. A streak requires positive, automatic XP that has not been reversed. Weekly XP starts on Monday in the same timezone. Activity cached for one timezone does not replace another timezone's daily record.

Session activity accepts the same IANA timezone. Forge uses it for ambient daily caps and reporting, including midnight and daylight-saving transitions. The browser sends its runtime timezone with session activity instead of relying on the server host timezone.

## User scope and provenance

`GET /api/v1/metrics/xp` requires an operator session or a token with `read` scope and accepts repeated `userIds` query parameters. A token can read only users in its scope. One valid ID returns that user's progression. Multiple valid IDs return an aggregate without creating per-user unlocks or celebrations. An explicitly requested ID that does not exist returns an empty aggregate instead of another user's XP.

Recent XP entries expose their source, actor, automatic or manual status, entity reference, and stored owner when available. New rewards persist owner provenance so selected-user reads do not depend on labels or a current operator fallback.

Manual rewards resolve the target entity and its owner on the server. Client-provided `metadata.ownerUserId` cannot change the owner. The `manual`, `qualifiesForStreak`, and `idempotencyFingerprint` metadata keys are server-owned and rejected with `400` when supplied by a caller. Forge writes those flags after accepted client metadata, and every accepted payload value participates in retry conflict detection. User-, project-, and tag-scoped tokens can grant only to targets allowed by every configured scope, and the response metrics use the resolved target owner rather than the caller's default scope.

## Bounded reads

- Gamification GET routes are read-only. Reward reconciliation, daily-activity rebuilding, unlock persistence, and celebration creation run on authenticated command routes.
- Scoped totals are calculated with SQL aggregates rather than loading the complete ledger into JavaScript.
- New ledger rows persist an indexed owner column. Existing rows are backfilled only when their stored owner, entity owner, task owner, or actor resolves to a real Forge user; unresolved legacy rows retain the compatibility path.
- Reconciliation reads at most 500 ordered ledger rows at a time and stores one cursor per user and timezone. Appended rewards are applied incrementally. Backdated inserts, edits, reversals, and deletions invalidate the cursor and cause an atomic paged rebuild.
- XP metrics return the 25 most recent scoped ledger entries.
- Reward ledger reads default to 50 entries and are capped at 200.
- Settings Rewards uses the selected user's bounded XP response for recent adjustments instead of reading the operator-wide ledger.

## API surfaces

- `GET /api/v1/metrics`: scoped overview metrics. Requires read authorization.
- `GET /api/v1/metrics/xp`: scoped XP, level, streak, progress targets, provenance, and recent ledger entries.
- `GET /api/v1/gamification/catalog`: scoped, read-only reward catalog state. Requires read authorization.
- `GET /api/v1/gamification/equipment`: scoped, read-only equipment state. Requires read authorization.
- `POST /api/v1/gamification/reconcile`: authenticated write command for reward, daily-activity, unlock, and celebration reconciliation.
- `GET /api/v1/gamification/assets`: read-authorized, non-mutating release metadata and local validation status for every optional art style.
- `POST /api/v1/gamification/assets/install`: operator-session-only installation of one exact style archive after checksum and complete-manifest validation. Bearer tokens are not accepted for this local file mutation and receive `401 auth_required`.
- `GET /api/v1/rewards/rules`: configured XP rules.
- `PATCH /api/v1/rewards/rules/:id`: update a future-award rule.
- `GET /api/v1/rewards/ledger`: bounded operator reward history.
- `POST /api/v1/rewards/bonus`: explicit, scope-authorized manual XP adjustment. Send a stable `metadata.idempotencyKey` when the caller may retry; do not reuse a key for different content.
- `POST /api/v1/session-events`: bounded ambient session activity with stable session identity and an optional IANA `timezone`.

## Assets and interface behavior

Downloaded art packs are checksum-checked and fully validated in a sibling staging directory. A GitHub token is attached only to exact trusted HTTPS GitHub origins after URL parsing; host-like text in an attacker hostname or URL path never receives credentials. Installs for the same style are serialized. Forge swaps a valid staged directory into place atomically and restores the prior pack if the swap fails or a prior process stopped before commit. The staging rename is the commit point: a later backup-cleanup error cannot report failure while the replacement is active, and the deterministic backup is removed before the next attempt. A retry removes only a bounded number of old staging directories whose names match Forge's exact random-suffix format; fresh directories and unknown sibling names are preserved.

Optional art availability does not control progression visibility. Overview continues to show Smith, streak, unlock, and trophy information when a selected pack is not installed or status cannot be loaded. Asset requests can be retried in place. A failed sprite uses the packaged theme preview, then a stable icon with the same accessible label and occupied space if the preview also fails.

Overview reports loading and refresh failures instead of presenting a failed request as zero progress. Settings Rewards keeps progression and rule errors separate, supports retry, and resets a successful manual grant to the first valid target so consecutive grants remain usable. An invalid watched target disables submission.

Celebrations remain visible until the user dismisses them. The server marks the celebration and its corresponding unlock acknowledgement in one transaction, so either both timestamps persist or neither does. Dismissal happens locally before the acknowledgement request. A failed acknowledgement does not replay the animation or start an automatic request loop; Forge shows one retry control with failure feedback. Reduced-motion mode removes entrance delays and gives the failure alert a zero-duration exit without removing information.

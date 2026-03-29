# Forge Cron Job Templates

This file contains optional recurring automation templates that can be proposed when a user explicitly asks for scheduled Forge support. These are examples, not defaults. Always adapt the schedule, delivery channel, note titles, linked projects, and tone to the current user.

## How To Use These Templates

- Only suggest these when the user asks for a recurring job, automation, check-in, or scheduled synthesis.
- Keep the spirit of the workflow, but replace personal details with the user's real context.
- Do not assume a messaging channel, phone number, preferred project, or note-title convention unless the user already uses one.
- If a recurring note or summary is saved in Forge, keep the naming convention internally consistent across related jobs.
- Do not invent facts in any generated briefing or synthesis.

## Morning Forge Briefing

Suggested schedule: `30 6 * * *` in the user's timezone

Intent:
Generate a psychologically steady, action-oriented morning briefing grounded in the live Forge state.

Suggested workflow:
1. Read the current operating state from Forge, including current work, context, XP or momentum, weekly review data, and any other signals that materially affect today.
2. Inspect today's and yesterday's relevant notes.
3. Review any especially relevant project routine or standing commitment if the user has one that should shape the day.
4. Write one medium-length morning message that clearly separates:
   what Forge shows,
   the interpretation or recommendation,
   the main move for today.
5. Include one brief values-oriented reorientation near the end.
6. If the user has a recurring physical, health, or readiness routine stored in Forge, restate the minimum standard for today and optionally suggest one modest tweak for today only.
7. End with a natural question about updates, progress, next-step help, or whether today's suggested tweak is acceptable.

Style:
- Warm, grounded, collaborative, and concrete.
- Psychologically informed without sounding clinical.
- Specific enough to help the user act, not just reflect.
- Firm without becoming harsh or inflated.

Optional delivery:
- Send through the user's configured outbound channel.
- Optionally save a linked Forge note if the user wants a durable record.

## Mid-Morning Encouragement Check-In

Suggested schedule: `0 10 * * *` in the user's timezone

Intent:
Send a substantial, human check-in that helps the user feel accompanied, reconnected to what matters, and more willing to begin or re-enter the day.

Suggested workflow:
1. Read the current work state, operator context, relevant notes, recent weekly summary, and any active value or friction signals.
2. Write a multi-paragraph message with real warmth and specificity.
3. Root the message in actual Forge state and patterns, but do not flatten it into a dashboard recap.
4. Offer one concrete next step or one small committed action for the day.

Style:
- Personal, alive, and emotionally intelligent.
- Hopeful in a way that feels earned.
- Practical without sounding managerial.
- Supportive without colluding with avoidance or drift.

Optional delivery:
- Best suited for a messaging channel when the user wants an encouraging daily prompt.

## Noon Forge Check-In

Suggested schedule: `0 12 * * *` in the user's timezone

Intent:
Generate a concise midday checkpoint that recenters the day around the real priority and a clean next action.

Suggested workflow:
1. Read current work, context, XP or momentum, and the most relevant notes from today and yesterday.
2. Find the latest completed weekly summary using the user's existing weekly-note convention, if one exists.
3. Write a short check-in that includes:
   what Forge shows,
   the main priority,
   one concrete next move,
   one small health or energy nudge.
4. Optionally save the generated message as a daily check-in note using the user's preferred title format.

Style:
- Brief, direct, grounded, and useful.
- No invented facts.
- Keep it small enough to actually help at midday.

Optional delivery:
- Send through the user's configured channel.
- Optionally save the same text into Forge as a note.

## Evening Forge Shutdown Check-In

Suggested schedule: `0 21 * * *` in the user's timezone

Intent:
Generate an evening briefing that supports shutdown, completion, triage, and a clean handoff into tomorrow.

Suggested workflow:
1. Read current work, context, XP or momentum, weekly review context, and the most relevant notes from today and yesterday.
2. Find the latest completed weekly summary using the user's existing naming convention, falling back to the prior completed period if the current one is not yet synthesized.
3. Write a concise evening briefing focused on:
   what was completed,
   what can wait,
   what should be closed out,
   the cleanest next step for tomorrow.
4. Optionally save the generated message as an evening check-in note using the user's preferred date-based title convention.
5. Do not save the inbound automation prompt itself unless the user explicitly wants that.

Style:
- Calm, steady, concrete, and sleep-protective.
- More about clean closure than about squeezing more from the day.

Optional delivery:
- Send through the user's configured outbound channel.
- Optionally keep a note record in Forge.

## Weekly Forge Synthesis

Suggested schedule: `30 21 * * 0` in the user's timezone

Intent:
Turn a week of daily check-ins into one truthful weekly summary and, if useful, one higher-level insight.

Suggested workflow:
1. Collect the daily Forge check-in notes for the current week using the user's existing daily-note prefix or another consistent filter.
2. If there are no daily check-in notes for the week, do nothing beyond recording that fact if the user wants auditability.
3. Summarize the week's signal into one clear weekly note.
4. Optionally create one Forge Insight capturing a repeated pattern, friction point, or win from the week.
5. Save the weekly summary using the user's chosen weekly title convention, anchored to the intended week-ending date.
6. After the weekly summary and any insight are safely stored, optionally soft-delete only the daily check-in notes that fed that synthesis if the user wants weekly rollups to replace daily check-ins.
7. Never delete unrelated notes.

Style:
- Compact, truthful, and signal-focused.
- Precise about date boundaries and note-selection rules.
- Conservative about deletion.

Optional delivery:
- Usually saved directly inside Forge.
- Messaging delivery is optional and should be user-driven.

# Forge Cron Job Examples

These are rich example cron jobs for Forge. They are examples, not defaults. If the user explicitly asks for recurring Forge automations, scheduled check-ins, or a recurring synthesis flow, you may reuse one of these patterns and adapt it to the user's real context.

Keep the depth, specificity, and tone of the template you choose. Do not flatten a rich example into a vague summary. Remove or replace user-specific details such as names, phone numbers, project titles, or personal routines only when those details do not belong to the current user.

If you reuse a naming convention from one of these examples, keep it internally consistent across related jobs. In particular, if a daily checkup job saves notes with a specific title format and the weekly synthesis job later searches for those notes, the exact format matters.

## Shared Adaptation Rules

- Only use these examples when the user explicitly asks for recurring automations, cron jobs, or scheduled Forge flows.
- Treat the cron expression, timezone, delivery channel, recipient, note titles, project names, and coaching voice as configurable example fields.
- Preserve the operational logic when adapting. If the example depends on exact note-title matching or week-boundary logic, keep that structure unless the user wants a different convention.
- Do not invent facts in any generated message, summary, or synthesis.
- Do not save the inbound automation prompt itself unless the user explicitly wants that behavior.

## Example: Evening Forge Checkup

Example cron:
`0 21 * * *` (`Europe/Zurich`)

Example delivery:
`announce (whatsapp -> configured recipient)`

Example agent:
`main`

Example prompt:

Every evening at 21:00 in the user's timezone, generate the user's evening Forge check-in. Do this in order:

1. Read Forge current work, operator context, XP metrics, and weekly review.
2. Read today's Forge notes and yesterday's Forge notes.
3. Find the last weekly summary note by searching for the exact title `Weekly Note of DD.MM.YYYY`, where `DD.MM.YYYY` is the most recent completed Sunday in the user's timezone. If it is Sunday before the weekly synthesis has run, use the previous Sunday's note.
4. Write a concise evening briefing focused on shutdown, completion, what can wait, and the cleanest next step for tomorrow.
5. Save the full generated reply as a Forge note titled `Daily Forge Checkup Note - Evening - DD.MM.YYYY`.
6. Do not save the inbound messaging prompt itself.

Tone and constraints:

- Keep the tone sleep-protective, steady, and concrete.
- Do not invent facts.
- Favor clean closure over squeezing more work into the night.
- Help the user end the day with less noise, not more.

Notes on adaptation:

- The title `Daily Forge Checkup Note - Evening - DD.MM.YYYY` is an example naming convention. If you adopt it, keep it exact so weekly jobs can find the note family reliably.
- The weekly lookup title `Weekly Note of DD.MM.YYYY` is also an example convention. If you change it, update every related recurring job that depends on it.

## Example: Weekly Forge Synthesis

Example cron:
`30 21 * * 0` (`Europe/Zurich`)

Example delivery:
`none`

Example agent:
`main`

Example prompt:

Every Sunday evening at 21:30 in the user's timezone, run the Forge weekly synthesis. Do this in order:

1. Read the daily Forge checkup notes from the current week, defined as Monday 00:00 through Sunday 23:59 in the user's timezone. Find them by their title prefix `Daily Forge Checkup Note -` and exclude soft-deleted entities with `includeDeleted: false`.
2. Summarize the week's signal in one clear weekly summary note.
3. Create one Forge Insight from the week's repeated patterns, friction, and wins.
4. Save the weekly summary note with the exact title `Weekly Note of DD.MM.YYYY`, using the most recent Sunday's date in `DD.MM.YYYY` format.
5. After the weekly summary note and Insight are saved, soft-delete only the daily Forge checkup notes from that week.
6. Keep every other Forge note that is not a daily Forge checkup note.

Tone and constraints:

- Be precise about the date string. The weekly note title must use the Sunday date only, and the daily checkup crons should look for the last weekly note by that exact title if this example convention is being used.
- If there are no daily checkup notes for the week, do nothing beyond noting that fact.
- Keep the summary compact but truthful.
- Do not delete unrelated notes.

Notes on adaptation:

- This example assumes a weekly archival rhythm in which daily checkup notes are rolled up into one weekly note plus one insight.
- If the user wants to preserve all daily notes, remove the deletion step explicitly rather than silently changing behavior.

## Example: Morning Forge Checkup

Example cron:
`30 6 * * *` (`Europe/Zurich`)

Example delivery:
`announce (whatsapp -> configured recipient)`

Example agent:
`main`

Example prompt:

Every morning at 06:30 in the user's timezone, generate the user's Forge morning briefing.

First, retrieve the live state with:
`forge_get_operator_overview`,
`forge_get_operator_context`,
`forge_get_current_work`,
`forge_get_psyche_overview`,
`forge_get_xp_metrics`,
and `forge_get_weekly_review`.

Also inspect whatever is relevant for today across goals, projects, tasks, task runs, overdue items, blocked items, values, aligned and unaligned behaviors, patterns, beliefs, modes, triggers, and any other signals that materially affect today's direction.

Also inspect the user's current performance or training project when relevant, including its description and especially any section describing the current daily routine or minimum standard. If the user has a project like a Hyrox-prep project, use that. If not, apply the same coaching structure to the user's real physical training project or standing body-maintenance routine.

Then write one medium-long message to the user with this stance: warm, lucid, grounded, collaborative, psychologically precise, and action-oriented.

The tone should feel like an excellent contemporary coach informed by schema therapy, ACT, motivational interviewing, behavioral activation, implementation intentions, self-compassion work, executive coaching, and top-level sport coaching. It should feel like the kind of coach who builds belief, discipline, and forward motion without becoming cheesy, inflated, or harsh. Not generic encouragement. Not therapy-speak. Not productivity cliché.

Strengthen Healthy Adult leadership: compassionate, reality-based, values-led, and capable of decisive action.

The message must do all of the following:

- clearly separate:
  `Forge shows`
  `your interpretation and recommendation`
- reduce the day to the few things that actually matter; name the main priority, the secondary lane if needed, and what should explicitly not drive the day
- reconnect the user to the most relevant larger commitments and long-horizon projects when they matter
- give concrete behavioral guidance:
  the best task lane for today
  the first visible action
  the likely obstacle, avoidance pattern, or mode likely to interfere
  an if-then fallback plan if blocked
  whether a task run should be started, continued, or deliberately not started
- use psychologically skilled interventions only when relevant, including:
  Healthy Adult vs punitive, demanding, avoidant, or impulsive modes
  cognitive defusion from discouraging or self-critical thoughts
  acceptance of friction instead of waiting to feel ready
  values clarification when there is drift or confusion
  behavioral activation when momentum is low
  implementation intentions for initiation
  sturdy self-compassion
  motivational interviewing style when ambivalence is present
- if Forge shows notable triggers, beliefs, patterns, modes, or value drift, mention only the ones that are actionable today and frame them as processes to work with, not identities

Also include one short ACT values micro-intervention near the end of the message.

Rules for the ACT micro-intervention:

- keep it brief: 2 to 5 sentences
- choose one value that is especially relevant today from Forge
- if Forge contains relevant unaligned behavior, briefly name the movement:
  from the behavior the user wants to move away from
  toward the behavior the user wants to move closer to
- use ACT language implicitly: choice, willingness, direction, small committed action, making room for discomfort
- do not sound clinical, preachy, sentimental, or abstract
- do not moralize
- do not turn it into a long reflection exercise
- make it feel like a precise morning reorientation

Preferred template for the ACT micro-intervention:

`Today, the value to stand on is [value]. If the pull is toward [unaligned behavior or pattern], the move is not to win an argument with your mind, but to step toward [aligned behavior or direction]. Let discomfort come along if it comes. The question is: what is one concrete action, today, that would make this value visible in how you live?`

If no meaningful unaligned behavior is present, use this shorter form:

`Today, the value to stand on is [value]. You do not need the perfect internal state before acting on it. What is one concrete action today that would make this value visible in how you live?`

Also include one short daily routine or performance coaching block.

For this block:

- read the current routine exactly as stored in the relevant project description
- restate it briefly and clearly
- strongly but intelligently encourage the user to do at least this minimum routine today
- use best-in-class sport coaching style: calm, demanding, confidence-building, specific, and momentum-oriented
- make the routine feel like a minimum standard, not an overwhelming workout
- frame it as identity-building, consistency-building, and keeping the body in the game
- rate the current routine for today on a simple scale, based on the live context and the goal of the training project:
  how realistic it is
  how useful it is
  how likely it is to help momentum
- propose exactly one small change for today only
- the change must be modest, concrete, and easy to adopt
- the proposed addition should be doable at home in the morning and fast
- examples: one extra rep, one extra round, 30 seconds more mobility, slightly tighter form
- do not propose a major rewrite
- ask the user whether they are okay with that change
- if they say yes later, then update the project description so the routine stays current and grant `+10 XP`
- do not update the routine or XP preemptively; first ask for consent

The performance coaching block should not sound like a slogan machine. It should be clear about the intensity and demand of the user's actual performance goal and judge current effort in consequence. Be smart and creative like an elite sport coach.

Keep the overall message emotionally intelligent: firm without harshness, encouraging without inflation, compassionate without collusion.

End by asking:

- whether anything should be updated in Forge
- whether the user advanced any tasks
- whether they want help choosing the next move
- whether they are okay with today's proposed daily-routine change

Style constraints:

- be specific, practical, and human
- prefer a coherent short briefing over a dashboard dump
- do not invent facts
- do not moralize
- do not overload with too many options
- when momentum is low, help restart cleanly and concretely
- when momentum is high, protect depth and prevent scattering
- when avoidance, bargaining, perfectionism, discouragement, or stimulation-seeking are active, name the process gently and redirect toward one values-consistent action
- for the sport or routine section, favor sharp coaching language over vague wellness language

Use this message structure:

1. brief opening line
2. `Forge shows`
3. `My read`
4. `Today's move`
5. `ACT check-in`
6. `Daily routine`
7. closing question about updates, progress, next-step help, and whether today's routine tweak is okay

Underlying aim:

Help the user begin the day with clarity, psychological steadiness, self-respect, courage, physical momentum, and one concrete path into action.

## Example: 10am Forge Awake Check

Example cron:
`0 10 * * *` (`Europe/Zurich`)

Example delivery:
`announce (whatsapp -> configured recipient)`

Example agent:
`main`

Example prompt:

At 10:00 in the user's timezone every day, send the user a long, warm, deeply personal message grounded in Forge.

Before writing, read:

1. `forge_get_current_work`
2. `forge_get_operator_context`
3. `forge_get_psyche_overview`
4. `forge_get_xp_metrics` if relevant
5. today's Forge notes and yesterday's Forge notes
6. the most recent weekly summary note titled exactly `Weekly Note of DD.MM.YYYY` for the most recent completed Sunday in the user's timezone, with `includeDeleted: false`
7. values, committed actions, and potential friction patterns

Then write one message with these requirements:

The message must feel like it comes from a close, wise, loving friend who genuinely knows the user, sees their strengths, understands their patterns, and wants to help them move forward today. It should feel alive, original, human, and nourishing. Not like coaching boilerplate. Not like a therapist note. Not like generic motivation.

It should feel like warm, intelligent, hopeful, grounded, affectionate, psychologically precise, and quietly energizing human contact.

The message must be long enough to feel substantial and personal.

- Write at least 3 real paragraphs.
- Prefer 4 to 6 paragraphs when there is enough material.
- Do not write a short compact pep talk.
- Do not sound clipped, formulaic, or repetitive.
- Let the message breathe.

Opening:

- Start naturally, like a real friend checking in.
- Use openings in the spirit of: `Hey buddy`, `Just checking in`, `A thought for your morning`, `I wanted to send you this for today`.
- Vary the opening from day to day so it does not sound templated.
- The opening should already carry warmth, familiarity, and life.

Core intent:

- Give the user energy for the day whether they are still in bed or already up.
- Do not ask whether they are in bed.
- Do not assume any specific avoidance pattern is active today unless Forge actually supports that reading.
- Use Psyche records as background understanding, not as a script that must always be mentioned.
- Stay rooted in the actual Forge state, actual notes, actual work, actual projects, and actual signals.
- Do not invent facts or mood states.

What the message should do:

- make the user feel seen, understood, and accompanied
- reconnect them with what matters today
- help them believe the day is still alive and usable
- remind them of their values, larger direction, and capacity for real movement
- offer one concrete next step or one small committed action for today
- bring brightness, hope, and steadiness without sounding fake or overhyped
- help them move toward Healthy Adult energy: warm, reality-based, protective, self-respecting, and action-capable

Psychological style:

- Use schema therapy language only when it genuinely fits and only lightly.
- If relevant, you may name protective or distancing modes gently and without over-pathologizing.
- Use compassion-focused language to validate loneliness, disappointment, exhaustion, or discouragement when those are relevant.
- Do not collude with withdrawal, resignation, drifting, or staying stuck.
- Use ACT implicitly and skillfully:
  willingness to feel discomfort
  values-based movement
  defusion from discouraging thoughts
  one small committed action
- Do not sound clinical, technical, or like psychoeducation.
- Do not dump concepts.
- The psychology should be felt in the writing, not displayed like terminology.

Tone and style:

- warm, bright, generous, steady
- hopeful in a way that feels earned
- intelligent, intimate, and creative
- grounded and practical
- kind but not permissive
- emotionally honest but not heavy
- psychologically informed but not clinical
- no fluff
- no moralizing
- no generic productivity language
- no fake cheerfulness
- no stale motivational clichés

Creative direction:

- Each message should have its own angle, image, rhythm, or emotional center.
- Sometimes use a gentle life insight, a humane observation, a small philosophical truth, or a vivid image from ordinary life.
- The tone should feel like a calm sunrise: light entering the room, not a drill sergeant, not a correction.
- Let the message contain some beauty and perspective, not just task advice.
- It should occasionally remind the user of common humanity, courage, friendship, dignity, or the fact that a life is built in small true movements.
- It should leave them feeling more whole, more hopeful, and more willing to begin.

Structure:

- Paragraph 1: warm human contact, emotional attunement, sense of today being alive
- Paragraph 2: insight, perspective, and grounded encouragement rooted in the user's actual Forge state and patterns where relevant
- Paragraph 3: values-based orientation and one concrete next move for today
- Optionally add a 4th or 5th paragraph if there is rich material from Forge, especially to connect current work with larger arcs, identity, or hope

Important constraints:

- Do not flatten the message into a checklist.
- Do not write a dashboard summary.
- Do not just repeat Forge facts back to the user.
- Weave the Forge facts into something human and meaningful.
- Do not overfocus on the bad.
- Do not make the whole message about pathology or one familiar pattern unless it is actually central today.
- Do not be grim, corrective, cold, or managerial.
- Do not end with a bland question unless it feels natural.
- It is okay if the message ends as a gift rather than a prompt.

Modeling target:

Write the kind of message that makes the user feel:

- `this person really knows me`
- `this is beautiful and true`
- `I can start from here`
- `today is still mine`
- `I do not need to be perfect to move`

Use the actual Forge state and relevant Psyche records faithfully, but transform them into a living, personal message that feels like it was written by someone who knows the user well and wants them to have a real day.

## Example: Noon Forge Checkup

Example cron:
`0 12 * * *` (`Europe/Zurich`)

Example delivery:
`announce (whatsapp -> configured recipient)`

Example agent:
`main`

Example prompt:

At noon in the user's timezone, generate the user's Forge check-in. Do this in order:

1. Read Forge current work, operator context, and XP metrics.
2. Read today's Forge notes and yesterday's Forge notes.
3. Find the last weekly summary note by searching for the exact title `Weekly Note of DD.MM.YYYY`, where `DD.MM.YYYY` is the most recent completed Sunday in the user's timezone. If it is Sunday before the weekly synthesis has run, use the previous Sunday's note.
4. Write a concise, grounded check-in with:
   what Forge shows,
   the main priority,
   one concrete next move,
   and one small health or energy nudge.
5. Save the full generated reply as a Forge note titled `Daily Forge Checkup Note - Noon - DD.MM.YYYY`.
6. Do not save the inbound messaging prompt itself.

Tone and constraints:

- Keep it brief, direct, and useful.
- Do not invent facts.
- It should feel like a real midday reorientation, not a generic reminder.

Notes on adaptation:

- `Daily Forge Checkup Note - Noon - DD.MM.YYYY` is an example naming convention that pairs well with the example evening and weekly flows in this file.
- If the user wants a different cadence or different note family, change the whole note-search and note-save pattern together rather than partially.

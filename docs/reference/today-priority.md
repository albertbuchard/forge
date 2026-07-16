# Today priority

Forge uses one deterministic Today decision to answer what work should happen
next. The web app and agent tools read the same ranking logic.

The decision considers:

- open tasks in the selected user scope
- active task runs and conflicting live work
- task priority and due date in the requested timezone
- saved task timeboxes near the current day
- the selected user's current Life Force capacity
- the task already selected by the current Today snapshot

Life Force affects the ranking when exactly one user is selected. Schedule
evidence covers task timeboxes. Agents should also read the calendar overview
when meetings or other calendar events matter to the user's choice.

## Decision states

| State               | Meaning                                                          |
| ------------------- | ---------------------------------------------------------------- |
| `ready`             | One startable task is the current recommendation.                |
| `continue-active`   | A live task run should continue before another task starts.      |
| `unresolved-active` | Live work conflicts with the stored task state and needs review. |
| `overloaded`        | Current capacity indicates that adding work is unsafe.           |
| `capacity-limited`  | Open tasks exist, but none fits the current AP budget.           |
| `no-work`           | No open task can be started in the selected scope.               |

Each response includes the selected task when one is actionable, up to 3
alternatives, bounded ranked candidates, and evidence for urgency, task-timebox
schedule, capacity, and active work. Evidence reports whether its source is
current, stale, missing, loading, or unavailable.

## API and agent access

Use:

```text
GET /api/v1/today/priority
```

Optional query parameters are repeated `userIds`, an IANA `timeZone`, and
`candidateLimit` from 1 to 100. The default candidate limit is 24.

OpenClaw and Hermes expose the same read as `forge_get_today_priority`. Codex
uses the same Forge tool contract. `forge_get_current_work` remains the compact
active-work summary, and its `recommendedNextTask` now follows this decision.

Agents should follow the returned state. They should not select a blocked task
or substitute the first task in a board lane when the decision says to resolve
active work, recover capacity, or stop.

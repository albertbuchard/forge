# Daily briefing

Forge gives each selected owner one deterministic daily briefing on Today. It
summarizes only facts that the requesting session or token may read. The same
briefing is available through the API, and Overview links directly to it.

The briefing has four ordered sections:

1. **Current work** reports an active work session, an active-session conflict,
   or the highest-ranked open task in the authorized scope.
2. **Schedule** reports up to three current events that overlap the owner's
   local day. Overlapping events remain visible as a conflict.
3. **Health and capacity** reports an existing same-day Life Force snapshot and
   persisted Action Point ledger totals. A briefing read never creates a
   profile, snapshot, template, or ledger event.
4. **Recent activity** reports up to three authorized activity records from the
   previous 36 hours.

Every published statement includes its observation time, freshness state,
source records, and exact evidence references. The web interface keeps this
detail behind the keyboard-accessible **Source and freshness** disclosure. A
section with no usable evidence says why it is empty, stale, future-dated,
conflicted, partial, or omitted. Forge does not fill evidence gaps with a model
guess.

The capacity section repeats stored quantities only. It does not diagnose a
condition, infer a cause, or convert health observations into medical advice.
When no current persisted snapshot exists, the section states that it was
omitted from the briefing.

## API

Use:

```text
GET /api/v1/daily-briefing?userId=<owner-id>&timeZone=<iana-timezone>
```

`userId` is required and must identify exactly one owner the caller may read.
`timeZone` is optional; when supplied, it must be an IANA timezone such as
`Europe/Zurich`. The timezone defines the local calendar day, including 23-hour
and 25-hour daylight-saving transitions.

The response contract is `daily-briefing.v1`, represented by
`contractVersion: 1`. It contains one factual headline and exactly four ordered
sections: `work`, `schedule`, `capacity`, and `recent_activity`. At most eight
statements are returned across all sections and at most three within any one
section. Each statement cites at most four exact evidence records. The complete
JSON response is limited to 64 KiB.

The service applies ownership and assignment checks in each source query before
ordering, counting, or limiting records. It inspects at most:

- 101 open tasks and publishes at most 100
- 21 active task runs and publishes at most 20
- 41 same-day calendar records and publishes at most 40
- 13 recent activity records and publishes at most 12

Reading a project- or tag-restricted token keeps task evidence within that
scope. Forge omits the user-wide schedule, capacity, and activity sections with
an explicit reason because those records cannot be safely narrowed to the same
scope.

Unknown owners and owners outside the caller's authorization both return the
same `404` response. Invalid or incomplete query parameters return `400`.
Missing authentication returns `401`, and a token without a read or write scope
returns `403`.

## Deterministic selection and freshness

A task run with a heartbeat from the previous 24 hours takes precedence over
other work. If more than one current run exists, the briefing reports the
conflict and does not select a winner. Stale, missing, or future-dated
heartbeats are excluded and disclosed instead of being presented as current
work. Without a current run, open tasks are ordered by stored status, priority,
due date, and stable record identifier. Blocked, completed, deleted, and
future-dated work is not selected.

Local calendar records are observed when the route reads them. Synchronized
calendar records use their last successful synchronization time and become
stale after six hours. Capacity uses only a persisted same-day Life Force
snapshot and becomes stale after 30 minutes. Recent activity covers the previous
36 hours. Evidence more than five minutes ahead of the runtime clock is marked
future-dated and excluded from factual statements.

The headline uses only a current-work statement, then a schedule statement if
no work statement exists. Capacity and activity can never become the headline.
This keeps stored health context and past activity from being presented as a
causal explanation or work recommendation.

## Web interface and recovery

Today shows the briefing before the existing Today priority decision. Select
exactly one person to load it. Overview provides a **Daily briefing** link to
the same Today section. Loading, partial, conflict, empty, unavailable, and
offline states remain explicit, and retry is a read-only action.

The feature adds no table or migration. Rolling it back means reverting the
route, read service, and web components; no stored records need to be converted
or removed.

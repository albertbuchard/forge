# Pins And Recent Records

Forge keeps one canonical set of pinned entity references and a separate recently
viewed history for each authenticated actor.

## Product Behavior

- The existing Action Bar shows bounded `Pinned` and `Recent` sections.
- A human operator can pin or unpin a navigable Forge record from the Action Bar.
- Opening a record from the Action Bar, or visiting a supported detail or focused
  route, updates the operator's recent history.
- The iPhone companion shows the leading pinned record and can reopen it in the
  embedded Forge app.
- The watchOS Inbox shows a compact pin count and at most three pin cards. It is a
  glance-only view and does not mutate pins.

Pins can be shared or owned by one Forge user. Recent history is always scoped to the
authenticated actor: the local operator, an agent token, or a mobile pairing. A token
cannot read another actor's recents.

## API

| Method   | Path                                 | Purpose                                        | Authority                              |
| -------- | ------------------------------------ | ---------------------------------------------- | -------------------------------------- |
| `GET`    | `/api/v1/entity-navigation`          | List bounded pins and actor recents            | Operator session or token with `read`  |
| `PUT`    | `/api/v1/entity-navigation/pins`     | Idempotently pin one entity reference          | Human operator session only            |
| `DELETE` | `/api/v1/entity-navigation/pins/:id` | Remove an active pin and append an audit event | Human operator session only            |
| `POST`   | `/api/v1/entity-navigation/touch`    | Record one viewed entity for the current actor | Operator session or token with `write` |

`pinnedLimit` and `recentLimit` default to `6` and cannot exceed `25`. User filters can
narrow operator reads. Agent-token reads and touches are also constrained by the
token's user, project, and tag policy.

The OpenClaw HTTP mirror exposes only the agent-safe routes:

- `GET /forge/v1/entity-navigation`
- `POST /forge/v1/entity-navigation/touch`

OpenClaw, Hermes, and Codex expose those operations through
`forge_call_entity_navigation_route` with route keys `list` and `touch`. Agent tools do
not expose pin or unpin.

## Record Destinations

Every stored CRUD entity type has an explicit web destination. Forge uses an exact
detail route when that surface exists, including goals, projects, tasks, strategies,
artifacts, trigger reports, questionnaires, and workouts. Focused collection routes
open the exact habit, note, Life Event, Psyche record, preference item, calendar
record, mode-guide session, or sleep night.

Some supporting records do not have a standalone detail page. Tags, insights, event
types, and emotion definitions open as exact focused nodes in the Knowledge Graph.
Preference catalogs, catalog items, and contexts open and highlight the matching
record in their Preferences tab. These focused destinations also participate in
Recent history.

The destination contract is exhaustive over the shared CRUD entity catalog. Web
tests also cover every detail or focused route that records a visit, including the
sleep and workout routes, so route changes fail validation instead of silently
redirecting to Overview.

## Storage And Deletion

`entity_pins` stores active pin references. `entity_pin_events` preserves append-only
pin and unpin audit history. `entity_recent_views` stores one row per actor and entity,
including first view, last view, and a capped view count.

The migration is additive and does not rewrite existing Forge records. A soft-deleted
pinned target remains visible as unavailable and points to the settings bin. A missing
or deleted recent target is hidden. Recents that are currently pinned are also hidden
from the Recent section so the same record is not shown twice.

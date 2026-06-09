# Preferences System

Forge now treats Preferences as a first-class product area.

That means Preferences has:

- its own route and shell icon at `/preferences`
- its own backend model and API surface
- its own contextual learning loop
- its own inspection, editing, and history surfaces
- explicit multi-user ownership through the selected Forge user

## Product Model

Preferences is organized around four main ideas:

1. A `preference_profile` belongs to one Forge user and one domain.
2. A profile contains one or more `preference_contexts`.
3. Contexts operate over `preference_items`.
4. Seeded and custom `preference_catalogs` provide concept lists for automatic comparison rounds.
5. Judgments and signals update inferred `preference_item_scores`.

The initial built-in domains are:

- `projects`
- `tasks`
- `strategies`
- `habits`
- `calendar`
- `sleep`
- `sports`
- `activities`
- `food`
- `places`
- `countries`
- `fashion`
- `people`
- `media`
- `tools`
- `custom`

The current interpretable dimensions are:

- novelty
- simplicity
- rigor
- aesthetics
- depth
- structure
- familiarity
- surprise

## Interaction Model

Forge uses pairwise comparison as the default learning loop, but the landing
screen is now summary-first rather than compare-first.

The top of `/preferences` shows what Forge currently knows about the selected
user and domain. If evidence is thin, the page says so plainly and surfaces one
prominent `Start the game` button.

Starting the game opens a modal:

- first choose a domain or concept area
- then let Forge populate candidates automatically
- Forge domains such as `projects`, `tasks`, `strategies`, and `habits` draw
  directly from existing Forge entities
- concept domains such as `food`, `activities`, `places`, `countries`,
  `fashion`, `people`, `media`, and `tools` draw from editable concept lists

The game view uses two large cards and supports:

- prefer left
- prefer right
- strong left
- strong right
- tie
- skip

Alongside pairwise choices, Forge also supports direct absolute signals:

- favorite
- must-have
- bookmark
- compare later
- neutral
- veto

The inference path is fully algorithmic. Forge currently combines:

- pairwise evidence aggregation
- time decay
- direct signal weights
- conflict tracking
- confidence and uncertainty heuristics
- deterministic next-pair selection

There is no LLM dependency in the preference inference pipeline.

## UI Surface

The `/preferences` workspace is split into:

- Overview
- Map
- Table
- History
- Contexts
- Concepts

The current implementation includes:

- a per-user domain selector
- a summary-first landing page that opens with "what Forge knows"
- a modal-based `Start the game` flow instead of a permanently exposed compare page
- automatic seeding from concept libraries and automatic Forge-entity queueing for Forge-native domains
- a searchable "Add from Forge" handoff panel that includes owner identity
- summary dimension bars
- a clickable 2D preference map
- an explanation panel
- an evidence table with row selection
- an item editor for labels, tags, feature weights, and manual overrides
- context creation, update, activation, and merge flows
- concept-library creation, editing, deletion, and per-list game launch

Goal, project, task, and strategy detail pages also include a direct "Send to
Preferences" action that queues the entity for comparison and opens the
Preferences workspace focused on it.

## API

Forge exposes the Preferences domain through these routes:

- `GET /api/v1/preferences/workspace`
- `POST /api/v1/preferences/game/start`
- `POST /api/v1/preferences/catalogs`
- `PATCH /api/v1/preferences/catalogs/:id`
- `DELETE /api/v1/preferences/catalogs/:id`
- `POST /api/v1/preferences/catalog-items`
- `PATCH /api/v1/preferences/catalog-items/:id`
- `DELETE /api/v1/preferences/catalog-items/:id`
- `POST /api/v1/preferences/contexts`
- `PATCH /api/v1/preferences/contexts/:id`
- `POST /api/v1/preferences/contexts/merge`
- `POST /api/v1/preferences/items`
- `PATCH /api/v1/preferences/items/:id`
- `POST /api/v1/preferences/items/from-entity`
- `POST /api/v1/preferences/judgments`
- `POST /api/v1/preferences/signals`
- `PATCH /api/v1/preferences/items/:id/score`

The workspace payload returns:

- profile
- selected context
- context list
- concept catalogs and their items
- dimension summaries
- scored items
- map points
- judgment and signal history
- snapshots
- next comparison pair
- summary counters
- concept-library counters

## Multi-user Behavior

Preferences follows the same explicit ownership model as the rest of Forge:

- every profile belongs to one Forge user
- the selected user may be `human` or `bot`
- items can still link across ownership boundaries
- search surfaces show owner identity clearly so cross-user intent stays visible

That means a human user can model preferences over bot-owned strategies or
tasks, and a bot user can maintain its own preference profile independently.

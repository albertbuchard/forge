# Preferences System

Forge now treats Preferences as a first-class product area.

That means Preferences has:

- its own route and shell icon at `/preferences`
- its own backend model and API surface
- its own contextual learning loop
- its own inspection, editing, and history surfaces
- explicit multi-user ownership through the selected Forge user

## Product Model

Preferences is organized around five main ideas:

1. A `preference_profile` belongs to one Forge user and one domain.
2. A profile contains one or more `preference_contexts`.
3. Contexts operate over `preference_items`.
4. Seeded and custom `preference_catalogs` define bounded decision domains and provide concept lists for automatic comparison rounds.
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

A direct signal is scoped to one owner, domain, item, and context. The latest
signal for that item and context is the effective direct mark. Recording another
signal replaces the current effect while preserving every earlier row in the
history and activity log. `neutral` is the explicit removal operation: it leaves
an audit tombstone but contributes no direct weight, evidence count, or
confidence. The score and status then come from the remaining judgments,
signals from applicable contexts, and manual controls.

The signal response contains both the recorded signal and the recomputed item
score. `score.effectiveSignal` identifies the exact current direct mark even when
the bounded workspace history no longer contains that signal. Clients should
show the returned score, status, confidence, source, and actor instead of
predicting the model result locally.

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
- a guided direct-mark flow on every selected scored item, with context scope,
  current provenance, replacement behavior, and conflicts shown before save
- an evidence table with row selection
- an item editor for labels, tags, feature weights, and manual overrides
- paged scored-item presentation with explicit range and next/previous controls
- visible judgment coverage when the model uses a bounded evidence window
- context creation, update, activation, and merge flows
- guided concept-library creation and editing with a purpose, explicit in/out
  boundaries, optional links to any Forge entity, and a final provenance review
- bounded catalog and concept rendering with incremental expansion controls
- reversible catalog archival and per-list game launch

Goal, project, task, and strategy detail pages also include a direct "Send to
Preferences" action that queues the entity for comparison and opens the
Preferences workspace focused on it.

## API

Forge exposes the Preferences domain through these routes:

- `GET /api/v1/preferences/workspace`
- `POST /api/v1/preferences/workspace/refresh`
- `POST /api/v1/preferences/game/start`
- `GET /api/v1/preferences/catalogs`
- `POST /api/v1/preferences/catalogs`
- `GET /api/v1/preferences/catalogs/:id`
- `PATCH /api/v1/preferences/catalogs/:id`
- `DELETE /api/v1/preferences/catalogs/:id`
- `GET /api/v1/preferences/catalog-items`
- `POST /api/v1/preferences/catalog-items`
- `GET /api/v1/preferences/catalog-items/:id`
- `PATCH /api/v1/preferences/catalog-items/:id`
- `DELETE /api/v1/preferences/catalog-items/:id`
- `GET /api/v1/preferences/contexts`
- `POST /api/v1/preferences/contexts`
- `GET /api/v1/preferences/contexts/:id`
- `PATCH /api/v1/preferences/contexts/:id`
- `DELETE /api/v1/preferences/contexts/:id`
- `POST /api/v1/preferences/contexts/merge`
- `GET /api/v1/preferences/items`
- `POST /api/v1/preferences/items`
- `GET /api/v1/preferences/items/:id`
- `PATCH /api/v1/preferences/items/:id`
- `DELETE /api/v1/preferences/items/:id`
- `POST /api/v1/preferences/items/from-entity`
- `POST /api/v1/preferences/judgments`
- `POST /api/v1/preferences/signals`
- `PATCH /api/v1/preferences/items/:id/score`

Preference catalogs and catalog items are normal stored Forge entities. Agents
should use shared batch CRUD by default:

- create: `POST /api/v1/entities/create` using either
  `entityType: "preference_catalog"` or
  `entityType: "preference_catalog_item"`
- read/search: `POST /api/v1/entities/search`; use `ids` for exact reads
- update: `POST /api/v1/entities/update`
- archive: `POST /api/v1/entities/delete` with the default soft mode
- restore: `POST /api/v1/entities/restore`
- permanent deletion: `POST /api/v1/entities/delete` with `mode: "hard"`
  only after explicit confirmation

The direct catalog routes remain available to the web application and other
clients that need the dedicated representation. They require authentication
and enforce the authenticated token's permitted Forge-user scope. List calls
support bounded `limit`, `offset`, and `query` parameters and return `hasMore`,
`nextOffset`, and `previousOffset`. Catalog listing also accepts `domain`.
Catalog search covers catalog metadata and concept labels, descriptions, and
tags, including concepts outside the embedded first page. Create calls accept
an `Idempotency-Key` header for retry-safe creation; malformed keys return
`400`.

`GET /api/v1/preferences/workspace` is a pure stored-state read. It does not
create profiles, seed catalogs, recompute projections, or write snapshots. A
workspace that does not exist returns `404`. Authorized clients initialize or
refresh it through `POST /api/v1/preferences/workspace/refresh`, which requires
write access and records authenticated source and actor provenance.

Workspace reads accept `itemLimit`, `itemOffset`, and `historyLimit`. The
response reports the item range in `presentation` and the total, considered,
and truncated judgment counts per context in `evidenceCoverage`. A refresh uses
at most the 1,000 latest pairwise judgments from each context; older judgments
remain stored. Pairwise judgment clients may send `Idempotency-Key`. An
identical retry returns the original judgment, while reuse with a different
payload returns `409`. The judgment, activity event, projection update, and
retry receipt commit in one transaction. Evidence writes refresh the source
context and every active context whose blended or shared model depends on it.

`POST /api/v1/preferences/items/from-entity` checks that the authenticated
caller can read the exact source before linking it. Personal Wiki pages follow
their Wiki ACL; inaccessible and missing sources both return the same `404`.
Readable shared records may still be linked across owners.

Catalog create and update validate every generic entity link through the same
read-access boundary on both direct and batch routes. Missing and inaccessible
targets return the same not-found response. Note links follow Wiki ACL, Person
links require the People read scope for scoped tokens, and ordinary records
respect the token's allowed Forge users.

## Preference Catalog Contract

A preference catalog records:

- the owning Forge user and preference domain
- a stable title and slug
- the decision purpose in `description`
- what belongs in the domain in `scopeIn`
- what does not belong in the domain in `scopeOut`
- whether the catalog was seeded or created by the user
- server-stamped creation source and actor provenance
- generic Forge entity links
- ordered reusable concepts
- archive state and timestamps

The owner and creation provenance are assigned by Forge. Clients do not claim
their own provenance. An active catalog title must be unique after trimming and
case normalization within one owner and domain; duplicate creates return `409`
with the existing catalog ID. A repeated create with the same idempotency key
and identical payload returns the original catalog. Reusing the key with a
different payload returns a conflict.

Catalog links use Forge's general entity-link model. The catalog does not have
a separate preference-specific link table. Direct and batch writes validate
that the caller can read every link target before changing the catalog.
Archiving a catalog preserves its
links and archives only the concepts that were active at that moment. Restoring
the catalog restores those concepts without reviving concepts that had already
been archived independently. Permanent deletion removes the catalog's generic
links and ownership metadata with the catalog.

An active reusable concept label is unique after trimming and case
normalization within one catalog. Deleting a reusable concept moves it to the
Settings Bin. Repeating the delete returns the same archived record. The
catalog-item row, ownership, general entity links, preference items, and
evidence remain intact and return when the concept is restored. Permanent
deletion is available only as an explicit Bin action.

The workspace payload returns:

- profile
- selected context
- context list
- a bounded first page of concept catalogs and concepts
- dimension summaries
- scored items
- map points
- judgment and signal history
- snapshots
- page coverage and next-page metadata
- per-context model evidence coverage and truncation state
- next comparison pair
- summary counters
- authoritative concept-library counters across all active records

The workspace embeds at most 24 catalogs and 24 concepts per catalog and returns
at most 100 scored items and 100 history records per request. Clients use the
workspace item offset and the direct catalog and catalog-item list routes for
later pages. The web interface replaces the visible page instead of retaining
every previously loaded row, keeping mounted UI and browser memory bounded.

## Multi-user Behavior

Preferences follows the same explicit ownership model as the rest of Forge:

- every profile belongs to one Forge user
- every catalog inherits that profile owner and records the same owner in the
  shared entity-ownership model
- the selected user may be `human` or `bot`
- items can still link across ownership boundaries
- search surfaces show owner identity clearly so cross-user intent stays visible

That means a human user can model preferences over bot-owned strategies or
tasks, and a bot user can maintain its own preference profile independently.

## Companion And Watch

The iPhone companion exposes Preferences through the embedded responsive Forge
web application. Catalog creation therefore uses the same guided flow,
authentication, ownership checks, and API contract as desktop Forge; there is
no separate native catalog store or sync queue.

Forge does not expose catalog authoring or direct preference signals on watchOS.
The watch is a bounded glance and action surface, so these owner-, context-, and
provenance-sensitive changes remain in the authenticated web experience.

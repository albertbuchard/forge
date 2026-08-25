# Work And Opportunities

Forge's Work area keeps a person's real work, experience over time, career
direction, job searches, and application evidence connected without turning any
of them into ordinary tasks.

Work is always present. A person does not need to be looking for another role to
use it. The same person can hold several overlapping jobs, appointments,
contracts, freelance engagements, shifts, or advisory roles. Job search is a
closely related capability inside Work, represented by one or more independent
Opportunity Campaigns.

## Product Language

- **Work Engagement** is the stored record for one real work arrangement. The
  interface normally calls it a job, role, appointment, contract, or engagement
  according to its type.
- **Opportunity Campaign** is one bounded search intention with its own goals,
  dates, constraints, targets, policies, and history. It is not an episode and
  it is not a Task.
- **Job Opportunity** is one sourced role or paid-work possibility. The same
  opportunity can be evaluated against several campaigns.
- **Job Application** is the evidence-backed workspace and lifecycle for one
  application to one opportunity. It has one primary campaign.
- **Work Check-in** is a user-confirmed observation about one engagement at one
  time. It does not overwrite earlier observations.

Normal Forge Tasks remain the action and reminder layer. Work records link to
Tasks, Goals, Strategies, Projects, People, Artifacts, and other supported Forge
entities through the general relationship model.

## The Work Interface

The global Work destination has seven stable sections:

1. **Overview** combines current roles, meaningful recent changes, active
   searches, blockers, deadlines, and next actions.
2. **Current work** lists simultaneous current, planned, transitioning, ended,
   and archived Work Engagements.
3. **Check-ins** records quick observations and shows trends over a selected
   period without implying false precision.
4. **Goals and plans** exposes linked objectives, strategies, people, projects,
   triggers, and next actions.
5. **Job searches** switches among concurrent Opportunity Campaigns and their
   discovery inboxes, target organizations, saved queries, automation policies,
   and search-run evidence.
6. **Applications** provides list and board views, stable stage counts, filters,
   deadlines, blockers, and exact application workspaces.
7. **Documents** organizes positioning profiles, document sets, reusable
   responses, approval state, versions, and submitted-use history.

The visible **Looking for opportunities** control changes the current Work
foreground. Turning it off does not delete, archive, or rewrite any campaign,
opportunity, application, document, or outcome. Paused and historical searches
remain available.

Every section has bounded loading, empty, error, unavailable, permission, and
conflict states. The primary flows use the same keyboard-accessible and
touch-usable controls on desktop and mobile.

## Work Engagements

A Work Engagement stores the facts that describe one arrangement:

- title, role or function, linked Organization, status, priority, description,
  owner, visibility, provenance, revision, and timestamps
- planned, current, on-leave, transitioning, ended, and archived lifecycle
- start, expected end, actual end, probation, renewal, contract, notice, and
  earliest-departure dates
- engagement type, full-time equivalent, contracted and actual hours, schedule,
  shifts, timezone, location, work model, office days, travel, commute, on-call,
  and flexibility
- gross base and total compensation, hourly or daily rates, currency, period,
  bonus, commission, equity, pension, benefits, paid leave, and learning budget
- manager, team, reports, colleagues, mentors, clients, and collaborators through
  typed Person or Contact relationships
- responsibilities, authority, ownership, seniority, role family, domains,
  technologies, skills used and developed, exposure, rights, deliverables, and
  success criteria
- contracts, offers, job descriptions, reviews, objectives, work samples, and
  other appropriately permissioned Artifacts
- reason for taking the role, intended outcomes, risks, constraints, transition
  intentions, long-term relationships, and evidence-backed exit outcome

Archiving is reversible for ordinary records. It preserves the prior lifecycle
value and immutable history. A record created by a rolled-back private import is
not independently restorable because its receipt-created child records were
removed as one unit; re-import the reviewed source instead.

## Check-ins And Trends

Forge stores experience observations, not one mutable job-satisfaction score.
Each observation identifies its engagement, time and timezone, metric definition
and version, value, scale, optional confidence, note, tags, context, source,
actor, and provenance.

Built-in definitions cover:

- overall job satisfaction
- creativity and room to create
- financial satisfaction and adequacy
- growth and advancement
- learning and skill development
- autonomy and decision authority
- meaning, purpose, and impact
- workload sustainability
- stress and burnout risk, described without medical diagnosis
- work-life balance
- flexibility and control over time
- job security and organizational stability
- manager and team relationships
- recognition and fairness
- values and mission alignment
- technical or professional environment
- ownership and ability to build
- energy before, during, and after work
- excitement about the role's future

Users may enable or disable definitions, change their display labels, and add
structured custom metrics without changing a built-in metric's canonical
meaning. Targets, acceptable ranges, warning thresholds, cadence, and missing
state remain explicit.

Trend responses retain their points and evidence. Moving summaries and
meaningful-change labels help direct attention, but they do not replace the raw
observations. An agent-imported or agent-suggested value cannot be stored as
`user_entered` without confirmation.

## Opportunity Campaigns And Criteria

Use separate campaigns when intentions have materially different constraints.
For example, a full-time research search and a small weekend shift search should
not share one flattened policy. One campaign may still contain related role
targets and organization targets.

Campaign criteria are structured and versioned. A criterion records:

- section, field, value kind, operator, and explicit unknown state
- hard constraint or soft preference
- weight, flexibility, rationale, evidence requirement, and freshness
- an optional disqualification rule

The criteria document also stores ranking weights, deal-breakers, acceptable
trade-offs, uncertainty tolerance, minimum excitement, include and exclude
keywords, required sources, and minimum evidence confidence. Rich fields cover
role shape, responsibilities, schedule, workload, location and authorization,
availability, compensation, benefits, organization, growth, trade-offs,
keywords, and evidence.

Changing the criteria creates a new version. An earlier evaluation always keeps
the criteria version that governed it.

## Opportunities And Evaluation History

An opportunity upsert records the canonical URL, source identity, snapshot
Artifact when available, publication and freshness dates, role facts,
compensation and benefits when known, application route, provenance, explicit
unknowns, red flags, and evidence confidence.

Deduplication uses canonical URL first, then source identity, and then normalized
employer, title, and substantially similar description evidence. An exact
idempotency-key replay returns the earlier result. Insert-only private imports
may reference an existing opportunity without changing it.

Opportunity availability and the user's campaign disposition are distinct from
application status. A role can be live, stale, closed, filled, or unknown while
its campaign disposition is discovered, reviewing, shortlisted, qualified,
rejected, disqualified, applied, stale, closed, or archived.

Every campaign evaluation creates a retained version with:

- campaign, opportunity, and exact criteria version
- evaluator and model or agent provenance
- evidence sources and evaluation time
- overall score, confidence, and hard-gate result
- criterion-level scores, matched evidence, gaps, failures, and trade-offs
- recommendation and next action
- human override and its reason

Re-evaluation adds history; it does not silently replace the prior judgment.

## Applications, Documents, Interviews, And Offers

An application begins from an exact opportunity and primary campaign. Duplicate
guards prevent a second active application for the same candidate, opportunity,
route, and account reference unless the stored contract permits it.

The guarded lifecycle is:

`planned` → `preparing` → `blocked_on_user_input` or `ready_for_review` →
`ready_to_submit` → `submitted` → acknowledgement, screening, interviewing,
assessment, references, offer, and one truthful terminal outcome.

Every transition appends an immutable event with prior and new state, time,
actor, source, factual description, outcome, next action, due date, confidence,
and provenance. A prepared package is not a submission. An acknowledgement,
interview, rejection, offer, acceptance, withdrawal, or closure also requires
direct evidence or a clearly identified human correction.

Application Artifacts retain exact file identity, MIME type, language, version,
checksum, source template, parent version, derivative relationship, target
profile, approval and review state, confidentiality, and submitted-use history.
Credentials, passwords, tokens, and protected demographic answers are never
ordinary Artifacts.

Reusable responses keep the exact question, category, limits, language, claims,
evidence, sensitivity, approval state, adaptations, uses, and revisions. Forge
does not blindly reuse company-specific motivation.

Interviews preserve schedule, timezone, format, participants, focus areas,
preparation, notes, outcome, follow-up, and next action. Offers preserve the
complete compensation and terms needed for comparison against the exact campaign
criteria version. Accepting a recorded offer can idempotently create one planned
Work Engagement while retaining every application and offer record.

## Search Automation And Agent Authority

Campaign search sources and saved queries record geography, filters, cadence,
freshness, enabled state, rate or cost constraints, reliability, and canonical
query text. Every Search Run records its start and end, agent or automation,
criteria version, sources and queries, counts for found, new, changed, duplicate,
stale, and closed roles, failures, known cost, and durable evidence.

Automation policies separate research, preparation, upload, and external-send
authority. They may limit employers, role classes, compensation or legal-answer
gates, default document profiles, automatic eligibility, and maximum
applications. No policy bypasses Forge's central authorization and audit model.

## HTTP API

The specialized HTTP family begins at `/api/v1/work`. Its main groups are:

- `/work/context`, `/work/settings`, and `/work/settings/opportunity-search`
- `/work/organizations` and `/work/engagements`
- `/work/metrics/definitions`, `/work/check-ins`, and `/work/metrics/trends`
- `/work/campaigns`, criteria versions, opportunities, and evaluations
- `/work/applications`, transitions, and events
- `/work/supporting/:kind` for targets, profiles, documents, responses,
  questions, artifact use, interviews, offers, sources, queries, policies, and
  outreach
- `/work/search-runs`
- `/work/relationships/:entityType/:id`
- `/work/:entityType/:id/archive` and `/restore`
- `/work/transmissions/*`
- operator-only `/work/imports/*`

List routes use stable filters, sort, offset, limit, and bounded responses.
Revisioned updates use `expectedRevision`; stale writes return a structured
conflict. Mutations with an idempotency key retain exact request fingerprints,
so an exact retry replays and changed key reuse conflicts.

The generated OpenAPI document is available from the normal Forge API endpoint
and in the published OpenClaw documentation package.

## MCP And Agent Use

OpenClaw, Codex, and Hermes expose one collision-free compound tool:
`forge_call_work_route`.

Read the complete context before making a decision that depends on several
engagements, notice periods, recent trends, campaigns, or blockers:

```json
{
  "routeKey": "context",
  "query": {
    "userIds": ["user_id"],
    "trendWindowDays": 90
  }
}
```

Record a check-in only after the user confirms it:

```json
{
  "routeKey": "recordCheckIn",
  "body": {
    "engagementId": "engagement_id",
    "timezone": "Europe/Zurich",
    "sourceKind": "user_entered",
    "confirmationState": "confirmed",
    "observations": [
      {
        "metricDefinitionId": "metric_definition_id",
        "numericValue": 4,
        "missingState": "observed"
      }
    ],
    "provenance": { "sourceKind": "user" },
    "idempotencyKey": "stable-exact-retry-key"
  }
}
```

The agent surface deliberately excludes private import. Import is a local
operator action because it can create a connected body of personal records and
must be reviewed as one source-bound transaction.

Required scopes are:

- `work.read` for reads
- `work.write` for normal mutations
- `work.compensation.read` for private compensation reads and writes
- `work.transmit` for external application transmission and offer acceptance

A paired `trusted_personal_assistant` browser receives ordinary `work.read` and
`work.write` alongside its generic browser read/write grant. Existing paired
browsers inherit those two ordinary scopes without changing the stored
credential. They do not inherit compensation or transmission authority.

## External Transmission Safety

Forge never treats “send this application” as permission to improvise content or
record success early. The sequence is fixed:

1. Create an exact preview of destination, route, fields, answers, and Artifact
   versions.
2. Verify application state, criteria-bound policy, approvals, checksums, and
   unresolved gates.
3. Request central approval for that exact digest and principal.
4. Perform the external action through an authorized client.
5. Record a verified submission only with direct receipt, tracking identity, or
   approved evidence from the same authorized principal.

Any changed application, document, answer, destination, policy, or guard context
invalidates the earlier preview. Recording success consumes the authorization
once and appends an immutable application event and exact submitted-use records.

## Privacy And Private Import

Compensation and private application fields are projected according to the
caller's scopes. An unauthorized agent cannot filter by compensation or recover
private values from nested records. Passwords, credentials, tokens, exact home
addresses, protected demographic answers, and private contact data are rejected
from ordinary Work import fields.

Private import uses four explicit stages:

1. Build a source- and manifest-digest-bound payload from authoritative private
   evidence.
2. Preview counts, references, deduplication, exact Artifact checksums, and the
   rollback inventory without writing.
3. Apply the unchanged preview atomically and insert-only.
4. Preview and apply rollback only when every receipt-created row is unchanged
   and has no later dependency.

Subjective metric observations are not accepted by the import manifest. The user
must enter or confirm them through the normal check-in path. Public fixtures,
source code, examples, documentation, packages, and generated contracts contain
no personal Work data.

## Data And Migration

Migration `138_work_and_opportunity_management.sql` is additive. It creates the
relational Work ontology, indexes, revision guards, immutable event tables,
idempotency receipts, transmission records, and import receipts without changing
the meaning of earlier Forge entities. General `entity_links` and ownership
records connect Work to the existing ontology instead of creating shadow copies
of people, organizations, goals, tasks, projects, knowledge, or Artifacts.

Installable OpenClaw, Codex, and Hermes runtime packages carry the identical
migration. A package update runs the normal Forge migration path against the
preserved data directory.

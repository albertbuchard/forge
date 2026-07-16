# People and Peer Sharing

Forge stores a person in the user's life as a `person` entity. A Person is an
owner-scoped memory record. It is separate from a local Forge `User`, an agent
identity, a peer relationship, a device, and a sharing grant.

## Person Records

`person` uses the shared batch entity tools:

- `forge_search_entities` before create and for normal lookup
- `forge_create_entities` for create
- `forge_update_entities` for field or link replacement
- `forge_delete_entities` for soft delete
- `forge_restore_entities` for restore

Read live onboarding before writing. The minimum create fields are the owning
`userId` and the accepted `displayName`. Ask only for missing information that
serves the user's stated purpose. Do not request contacts, birthday data, private
notes, or sensitive facts by default.

Person relationships use the general entity-link contract:

```json
{
  "links": [
    {
      "entityType": "goal",
      "entityId": "goal_123",
      "relationship": "supports",
      "anchorKey": "optional-stable-anchor"
    }
  ]
}
```

Do not create a Person-specific link table or encode pairing, devices, credentials,
or consent as Person fields.

## Use the People view

Open `/forge/people` to browse, search, add, and edit people. Forge uses guided
modal forms for these changes. The form starts with the person's name and the reason
you want to remember them, then asks only for details that help with that purpose.

A Person can hold a preferred name, relationship, short description, notes, aliases,
contact methods, birthday precision, and other owner-scoped facts. Sensitive and
contact fields have separate read permissions. A basic People reader does not receive
them.

The Person detail view shows local context, general Forge links, the associated Wiki
page, connection state, shared information, devices, grants, and question history.
Deleting a Person uses Forge soft deletion. Restore remains available from Settings
Bin unless preserved peer records make a hard delete unsafe.

## How sharing works

Two Forge installations share through an explicit peer relationship. Pairing and
permission are separate steps:

1. One person creates a short-lived, one-use invitation.
2. The other person scans it and both people confirm the peer identity.
3. Each person chooses what their own Forge may send.
4. Forge shows the exact records, fields, filters, precision, and expiry before that
   direction is accepted.
5. The receiving Forge stores only the approved projection and its source, freshness,
   completeness, and redaction metadata.

Sharing is directional. Allowing Jon to see your calendar does not allow you to see
Jon's calendar. Each direction has its own signed grant and can be narrowed, allowed
to expire, or revoked.

Forge shares registered projections rather than general database or HTTP access. The
initial question flows cover calendar availability, selected goal horizons, and
cycling aggregates. A peer cannot request arbitrary tables, routes, fields, or time
ranges.

## Configure peer transport

Forge-to-Forge transport is opt-in. Run:

```bash
npx forge-memory configure --enable-peer --enable-peer-iroh
npx forge-memory doctor
```

Iroh is the default for a newly enabled peer runtime. It supports encrypted
connections between Forge installations on different networks and does not require
both users to join one Tailscale network. A direct IP endpoint is optional:

```bash
npx forge-memory configure --enable-peer --peer-endpoint 192.0.2.10:4318
```

`npx forge-memory status` lists the configured transport modes. Forge only advertises
Tor or an HTTPS mailbox when that provider has passed its local capability checks.
Selecting a privacy mode never permits a silent fallback to a mode that exposes more
network metadata.

| Connection method | When to use it                                                                                                 | Delivery and metadata                                                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Iroh              | Default connection across different home, mobile, or office networks                                           | Uses encrypted direct QUIC when possible and an encrypted Iroh relay path when needed. Iroh infrastructure can observe connection metadata, not Forge payload plaintext.        |
| Direct IP         | Both hosts have an explicitly reachable address and port                                                       | Avoids a Forge mailbox, but exposes the selected network endpoints to each other and the network path.                                                                          |
| Tor               | The local capability check reports managed Tor support and hiding endpoint addresses matters more than latency | Routes encrypted peer traffic through Tor. Forge does not silently replace this mode with a more revealing transport.                                                           |
| HTTPS mailbox     | The 2 Forge installations may not be online at the same time                                                   | Stores bounded end-to-end ciphertext until the receiving peer acknowledges it. The service sees timing, sizes, and opaque channel identifiers. It cannot decrypt Forge records. |

Transport setup does not create a Person, peer relationship, or sharing grant. A
human must scan and confirm a one-use invitation. Each direction of sharing has its
own reviewed grant.

Without an HTTPS mailbox, both Forge installations must overlap online long enough to
exchange data. Direct, Iroh, and Tor transport do not provide offline storage. A
provider outage remains visible as unavailable or stale state; Forge does not present
old data as live.

## Privacy and security

Forge keeps root and device private keys in the platform secret store. They are not
stored in the Forge SQLite database, invitation QR code, browser storage, logs, or a
mailbox. The invitation contains bounded public pairing material and expires after one
use.

Every remote result is checked against the current relationship, approved device,
signed grant version, requested projection, selected records, fields, time window,
precision, size limit, and expiry. Revocation stops new reads. Cached results remain
marked with their actual state and cannot be used to answer a different interval or
parameter set.

Browser and iPhone consent actions require recent human approval. Local agents may use
an existing grant only when their own token scopes also allow the operation. They
cannot pair peers, add devices, accept requests, widen grants, or mint human-presence
approval.

## Recovery and device loss

Use the Person's Connection view to remove a lost device or revoke the relationship.
Removal changes the approved device set and stops that device from receiving new
projections. Add a replacement device through a new human-confirmed pairing flow.

Back up Forge data before an upgrade, but treat identity recovery separately from the
SQLite backup. Restoring an older database does not roll identity keys or grant epochs
back. If restored database state and the secret store no longer agree, Forge stops
sending until the peers authenticate and resynchronize.

`npx forge-memory doctor` reports peer runtime, signed source, transport, and local
identity readiness. `npx forge-memory doctor --repair` may rebuild or restart the
verified local runtime. It does not delete Forge records, recreate trust, or bypass a
revoked relationship.

## Self-host an offline mailbox

`packages/forge-connectivity-service` is the reference HTTPS mailbox. It runs
independently from Forge and can be hosted by either user or another operator. Its
SQLite database contains ciphertext and bounded routing metadata. It has no Forge
database connection, decryption keys, grant evaluator, user account directory, or
administrative content-read route.

See the [service overview](../../packages/forge-connectivity-service/README.md),
[self-hosting guide](../../packages/forge-connectivity-service/docs/self-hosting.md),
and [threat model](../../packages/forge-connectivity-service/docs/threat-model.md).
The mailbox provides delivery when peers do not overlap online. It does not provide
anonymity; select Tor when the supported host capability and threat model require it.

## Current limits

- Windows does not run the `people-sharing-v1` peer runtime.
- Iroh normally uses its configured discovery and relay infrastructure. A future
  hosted Forge service can implement the same provider boundary without changing
  Person records or directional grants.
- Calendar answers describe approved Forge calendar evidence. They are not a live
  location or presence tracker.
- Goal answers include only the approved goal projection and horizon.
- Cycling answers use privacy-bounded aggregates. Forge rejects repeated overlapping
  queries that could reveal finer health or movement data.
- Transport reachability does not imply permission. A healthy connection with no
  active grant shares nothing.

## Agent Tools

OpenClaw and Hermes publish `forge_call_people_route` and
`forge_call_peer_route`. Codex and Claude Code receive the same curated tools
through `npx forge-memory mcp`.

Use `forge_get_agent_onboarding` before the first Forge operation in a session. Its
live source is `GET /api/v1/agents/onboarding`. The current HTTP contract is
`GET /api/v1/openapi.json`. Live onboarding and OpenAPI take precedence over
bundled release copies.

These two tools require a configured local agent token. An operator browser session
does not substitute for that token. The token must contain every scope listed for the
selected operation. Server routes may also admit operator or companion principals;
the agent adapters still require the agent token.

### People operations

| Operation ID                    | Request                                                                                                                                                | Required scopes                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| `listPeopleReadModel`           | `GET /api/v1/people` with bounded filters and cursor                                                                                                   | `people:read:basic`               |
| `getPersonContext`              | `GET /api/v1/people/:personId/context` with bounded include and limit fields                                                                           | `people:read:basic`               |
| `scanPeopleWikiCandidates`      | `POST /api/v1/people/wiki-candidates/scan`; body: `peopleRootPageId`, optional `userId`, `query`, `cursor`, `limit`                                    | `people:read:basic`, `wiki:read`  |
| `previewPeopleWikiAssociations` | `POST /api/v1/people/wiki-associations/preview`; body: `peopleRootPageId`, optional `userId`, reviewed `decisions`                                     | `people:write`, `wiki:read`       |
| `applyPeopleWikiAssociations`   | `POST /api/v1/people/wiki-associations/apply`; body: reviewed decisions plus `previewId`, `previewHash`, and `idempotencyKey`                          | `people:write`, `wiki:read`       |
| `interpretPersonQuestion`       | `POST /api/v1/people/:personId/questions/interpret`; body: `question`, `timeZone`, optional `referenceTime`                                            | `people:read:basic`, `peer:query` |
| `executePersonQuestion`         | `POST /api/v1/people/:personId/questions/execute`; body: returned `interpretationId`, `interpretationHash`, typed `query`, optional `sourcePreference` | `people:read:basic`, `peer:query` |
| `listPersonQuestionHistory`     | `GET /api/v1/people/:personId/questions` with cursor and limit                                                                                         | `people:read:basic`, `peer:query` |

All People operations allow `operator_session` and `agent_token` principals at
the API contract. Private, contact, sensitive, and restricted fields remain
scope-filtered even when the basic Person read is allowed.

### Peer status and query operations

| Operation ID            | Request                                                                             | Required scopes | API principals                                         |
| ----------------------- | ----------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------ |
| `listPeerRequests`      | `GET /api/v1/peers/requests`                                                        | `peer:status`   | `operator_session`, `agent_token`, `companion_session` |
| `listPeerRelationships` | `GET /api/v1/peers/relationships`                                                   | `peer:status`   | `operator_session`, `agent_token`, `companion_session` |
| `getPeerRelationship`   | `GET /api/v1/peers/relationships/:relationshipId`                                   | `peer:status`   | `operator_session`, `agent_token`, `companion_session` |
| `listPeerDevices`       | `GET /api/v1/peers/relationships/:relationshipId/devices`                           | `peer:status`   | `operator_session`, `agent_token`, `companion_session` |
| `listPeerGrants`        | `GET /api/v1/peers/relationships/:relationshipId/grants`                            | `peer:status`   | `operator_session`, `agent_token`, `companion_session` |
| `getPeerSyncStatus`     | `GET /api/v1/peers/relationships/:relationshipId/sync`                              | `peer:status`   | `operator_session`, `agent_token`, `companion_session` |
| `getPeerDiagnostics`    | `GET /api/v1/peers/relationships/:relationshipId/diagnostics` with cursor and limit | `peer:status`   | `operator_session`, `agent_token`, `companion_session` |

Resync is a human-only recovery action. It is available to an authenticated
operator or enrolled companion after action-bound approval and is not published by
the agent tools.

## Typed Questions

A typed question uses an existing Person-to-peer association and an active
directional grant:

1. Find the local Person record.
2. Call `interpretPersonQuestion` with the user's natural question and IANA time
   zone.
3. Show or check the returned interpretation when its interval, projection, fields,
   or precision could be ambiguous.
4. Pass the returned `interpretationId`, `interpretationHash`, and complete typed
   `query` unchanged to `executePersonQuestion`.
5. Report freshness, source, and grant-limited precision with the answer.

Examples include:

- "What is Jon doing next Monday?" for calendar availability
- "What are Jon's big goals for the next few months?" for a goal horizon
- "How much has Jon been cycling this month?" for a cycling aggregate

The agent must not broaden the returned interval, projection, entity IDs, fields,
precision, or result limit. The peer's active grant remains authoritative.

Execution returns `result.state` and `result.metadata`. Preserve and report the
metadata that changes how the answer should be understood:

- `source`: the responding principal, device, and relationship
- `asOf`, `receivedAt`, and `validUntil`: source time and freshness bounds
- `state`: `live`, `cached`, `stale`, `revoked`, or `unavailable`
- `completeness` and `precision`: the approved answer quality
- `redactedFields`: fields withheld by the grant or projection validator

Say when an answer is cached or stale. Name material redactions and do not infer or
reconstruct withheld fields.

## Human-Only Controls

Agents can inspect existing status and use existing grants. They cannot:

- create, scan, confirm, accept, reject, or cancel pairing and invitation actions
- accept or reject pending requests
- preview, propose, accept, counter, widen, or revoke sharing grants
- revoke peer relationships
- approve or remove peer devices
- create, verify, revoke, or use human-presence approval credentials

These operations are absent from the agent tool schemas. Do not emulate them with
batch CRUD, generic links, or a nearby route.

The authoritative allowlist is
`apps/api/src/peer-route-contract.ts`: an operation is available to an agent only
when `mcpExposed` is `true`. Request schemas come from
`apps/api/src/peer-api-schemas.ts`.

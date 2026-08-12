# User lifecycle and ownership transfer

Forge keeps human and bot identities usable without losing responsibility when a collaborator or agent stops working in the system. An operator can preview every affected owner, assignment, default owner, live runtime session, and active agent token before making an identity inactive.

## Active and inactive users

An active user can own records, receive assignments, appear in normal user lists, and act as a default owner for new work.

An inactive user remains in Forge for history and audit purposes. Forge does not delete the user or rewrite the actor recorded on older activity. Inactive users do not appear in ordinary active-user selection, cannot receive new ownership, and cannot resume a linked primary agent runtime.

The operator-only user directory returns active and inactive identities separately. It also reports each identity's configured kind, linked agent identities, providers, observed actor labels, session history, current live-session count, and trust state.

Forge uses these trust states:

- `operator` identifies the primary human operator.
- `verified_runtime` means a linked bot has a fresh connected or reconnecting runtime session.
- `configured` means the identity exists but has no current verified runtime session.
- `inactive` means the identity cannot receive new work or resume its primary runtime.

## Preview before deactivation

`GET /api/v1/users/{id}/deactivation-preview` is operator-only and requires an active replacement user. It returns:

- ownership counts grouped by entity type;
- assignment counts grouped by entity type;
- ownership defaults that currently point at the source user;
- fresh connected or reconnecting primary-agent sessions;
- active tokens for the linked primary agent identity;
- blockers that prevent the operation.

Forge blocks deactivation of the primary operator, an already inactive identity, the last active human, or a user whose proposed replacement is the same, missing, or inactive.

## Atomic transfer and deactivation

`POST /api/v1/users/{id}/deactivate` performs one database transaction. It:

1. validates the current preview again under the write lock;
2. transfers every generic owner row to the replacement user;
3. transfers generic assignments while removing duplicates;
4. redirects ownership defaults that pointed at the source user;
5. optionally disconnects fresh primary-agent runtime sessions;
6. revokes active tokens for the linked primary agent identity;
7. marks the user inactive;
8. records actor-attributed activity and an exact durable receipt.

If a live primary-agent session exists, the request must explicitly approve its disconnection. Any failure rolls back the complete operation.

Every lifecycle mutation requires an idempotency key. The key is scoped to the authenticated operator authority. An exact retry returns the stored response without repeating any transfer, revocation, or activity. Reusing the same key for a different request returns `409 Conflict`.

## Ownership defaults

`PUT /api/v1/users/{id}/ownership-default` chooses the active user who should own new work when the subject identity is the acting label and a route does not supply a more specific owner. The setting is operator-only, idempotent, and audited.

Deactivation changes the inactive user's default to the chosen replacement and redirects other defaults that pointed at the inactive user. This prevents new work from silently returning to an identity that can no longer act.

## Reactivation

`POST /api/v1/users/{id}/reactivate` restores the identity to active user selection and records a new lifecycle receipt. Reactivation does not restore revoked agent tokens or silently reconnect old sessions. An operator must issue new credentials and allow the runtime to register deliberately.

## Operator workflow

Open **Settings → Users** to review active humans, active bots, and inactive identities. Each user card shows lifecycle state, trust state, live-session count, ownership, experience points, and the current default owner.

Choose **Transfer / deactivate** to open the guided preview and confirmation flow. Choose **Reactivate** on an inactive identity to record why the user is returning. Forge preserves the same idempotency key across a failed retry of an unchanged form and rotates it after a successful operation or changed submission.

## Security boundary

Directory details, user creation and editing, access-grant changes, lifecycle preview, ownership-default changes, deactivation, and reactivation require a paired operator session. Token-scoped agents cannot administer identities through these routes.

The runtime repository also enforces lifecycle state directly. Registration, heartbeat, event append, and operator-requested reconnect all reject a primary agent identity whose Forge user is inactive. This prevents a lower-level runtime path from undoing the lifecycle boundary.

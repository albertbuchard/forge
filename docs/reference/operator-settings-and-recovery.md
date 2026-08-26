# Operator Settings And Recovery

Forge keeps operator controls under one settings index. Every settings page can
return directly to Runtime, Data, Users, Calendar, Mobile, Models, Agents,
Rewards, KarpaWiki, Logs, or Bin without returning to the main application
navigation first.

## Settings Index

Open `/settings` for the full descriptive index. On desktop, every destination
and its purpose are visible together. On a phone, the current section opens the
same index as a scrollable settings sheet. The index remains available while a
section is loading or when that section has a retryable error.

| Section   | Route                | Operator control                                                           |
| --------- | -------------------- | -------------------------------------------------------------------------- |
| Runtime   | `/settings`          | Operator session, execution policy, appearance, locale, and Doctor checks. |
| Data      | `/settings/data`     | Active data root, backups, exports, and recovery candidates.               |
| Users     | `/settings/users`    | Human and bot identities, ownership, and directional access.               |
| Calendar  | `/settings/calendar` | Provider connections, calendar selection, and sync defaults.               |
| Mobile    | `/settings/mobile`   | iPhone and watch pairing, permissions, sync, and recovery.                 |
| Models    | `/settings/models`   | Model providers, credentials, defaults, and health checks.                 |
| Agents    | `/settings/agents`   | Agent identities, sessions, scopes, tokens, and approvals.                 |
| Rewards   | `/settings/rewards`  | Progression rules, assets, and reward controls.                            |
| KarpaWiki | `/settings/wiki`     | Wiki spaces, index health, ingest behavior, and reindexing.                |
| Logs      | `/settings/logs`     | Bounded runtime diagnostics and recovery evidence.                         |
| Bin       | `/settings/bin`      | Soft-deleted records available for deliberate recovery.                    |

## Data Root And Backups

The Data page identifies the folder and SQLite database used by the running
Forge process. Treat that displayed path as the active source of truth. A data
root found elsewhere on disk is only a recovery candidate until Forge scans it,
opens its database read-only, and reports that the SQLite integrity check passed.
The web flow will not adopt a candidate that was not scanned or that failed this
check.

Data-root changes and backup restores require a new safety backup before the
operation starts. If the safety backup fails, the requested switch or restore is
not submitted. Backup history shows the archive and manifest paths so operators
can retain the recovery evidence until the runtime is verified.

Every Forge backup is highly sensitive. The archive contains the SQLite
database and can also contain `.forge-secrets.key`; when the key and encrypted
credential records are present together, the backup is credential-bearing and
can permit recovery of stored provider credentials. Never publish a backup,
commit it to source control, attach it to a support request, or move it through
an unencrypted channel. The archive includes `BACKUP-SENSITIVITY.txt`, and its
manifest repeats the credential-bearing warning.

Forge creates the backup directory with owner-only `0700` permissions and the
archive and manifest with owner-only `0600` permissions. Creation happens in a
private temporary directory under the configured backup directory. Forge
atomically renames the completed archive into place, then publishes the manifest
last as the catalog marker. A failed archive or manifest step removes staged and
partially finalized files. The two final renames are ordered but are not one
cross-file transaction; operators should treat a manifest as the completion
record and should not treat an archive without its matching manifest as a
completed backup.

The current backup settings contract does not expose an archive checksum, and
the current restore implementation is not an atomic file replacement. Keep the
required pre-restore backup until the restored runtime passes Doctor and normal
read checks. Do not use the web restore flow as a substitute for an independently
verified off-machine backup.

Exports are read-only operations. A failed export or backup is reported as a
failure; Forge does not label an interrupted archive as complete.

## Human, Bot, And Agent Identity

Users are durable owners. A user is either a human or a bot and has a unique,
case-insensitive handle. Directional user relationships control what one user
can discover, read, search, link, coordinate, plan, create, or change for
another user. Changing one arrow does not silently change the reverse arrow.

Agent identity is separate from user ownership. OpenClaw, Hermes, Codex, and
Claude Code sessions reconnect under stable agent identities, while linked human
or bot users remain the owners of Forge records. Agent tokens show their linked
identity, trust and approval posture, bootstrap budget, default owner/project/tag
scope, last use, and complete scope list.

Token creation and rotation require the live onboarding contract. Forge pauses
those actions if onboarding is unavailable so it cannot issue a credential from
a stale scope catalog. Raw tokens are shown once. Rotation invalidates the old
token immediately; revocation is permanent for that credential.

### Optional Master Password For Remote Browser Pairing

Forge does not create or assign a master password by default. An authenticated
operator using a browser directly on the Forge host can opt in under
**Settings → Agents**. Forge enforces only a basic password policy: at least 15
and no more than 128 Unicode characters, with matching confirmation. It does
not require symbols, uppercase letters, numbers, or a particular character
mix. The settings card provides a non-blocking strength estimate so the owner
can make an informed choice without fighting an opaque password checker.
Replacing an existing master password requires the current one.

The password is not a reusable Forge session or an operator credential. It is
an alternative way to approve one already-pending remote-browser pairing
request. The remote browser must still use the configured HTTPS origin, present
the exact short-lived request and user code, and prove possession of its own
one-use P-256 key. Master-password approval is limited to the `viewer` or
`trusted_personal_assistant` browser profiles and ordinary `read`, `write`,
`work.read`, and `work.write` scopes; it cannot approve an operator profile, an
API client, machine authority, compensation access, or external transmission.
Existing trusted-personal-assistant browser grants with the earlier generic
`read` and `write` scopes inherit only the corresponding ordinary Work scopes,
so an update does not force another pairing. Each accepted browser receives its
own sender-bound, revocable credential.
Forge then offers one device-passkey check so compatible browsers using the
same credential provider and HTTPS origin can restore that exact scoped
identity. The approved browser session remains available while this optional
check runs, and Forge stops a stalled enrollment attempt after 15 seconds.

Forge normalizes the password with Unicode NFC and derives its verifier with
Argon2id using 19 MiB of memory, two operations, and parallelism one after an
installation-keyed secret digest. The database stores only the salt and
verifier. Remote attempts are limited to five per owner and network partition
in five minutes. The remote page does not save the submitted password.

### Trusted-Device Browser Restoration

When an ordinary remote-browser session disappears, Forge first tries the
HttpOnly refresh cookie. That recovery does not depend on the non-secret
renewal timestamp in browser storage, so clearing ordinary local storage during
an app update does not discard a still-valid renewable session.

If renewal is unavailable, Forge automatically asks the device credential
provider for a discoverable passkey before it creates another pairing request.
Successful user verification restores the same paired-browser client, profile,
and scopes through the normal browser-session and refresh mechanisms. It cannot
restore a local-owner or operator session, widen scopes, or create a new client
grant.

After the owner approves one ordinary browser pairing, the requesting browser
immediately asks for Face ID, Touch ID, Windows Hello, or the device passcode to
create the device passkey. This is the default completion path and does not add
a second owner approval. The user can decline or use **Use this browser session
only**; the approved session remains usable, and **Finish trusting this device**
can retry while that session remains active.

Choosing **Use this browser session only** invalidates that exact device-trust
attempt before Forge opens the application. If the server's registration-begin
response arrives later, the browser does not start or complete a passkey
ceremony. Leaving the pairing view applies the same cancellation boundary.

A discoverable passkey can restore access in compatible browsers that use the
same device credential provider and the exact same Forge HTTPS host. Browser
cookies and local storage are not shared across browsers; the passkey is the
device-level recovery mechanism. Each restoration still requires user
verification. If WebAuthn is unavailable, declined, expired, or revoked,
ordinary browser pairing remains the fallback.

**Settings → Agents** lists active and revoked trusted-device credentials with
their paired client, profile, scopes, creation time, last verification time,
and whether the authenticator reports a synced passkey. Revoking trust removes
only that restoration credential. Revoking or changing the paired client,
recovering the owner, or replacing the Forge installation also invalidates its
trust automatically. A synced passkey can be available on more than one device,
so the label describes the credential rather than proving one physical device
identity. Updating or reinstalling Forge does not revoke trust by itself when
the canonical data root, installation identity, paired client authority, exact
HTTPS relying party, and device passkey are preserved.

Browser sessions are intentionally separate from durable device trust. Forge
retains an active browser session until its idle or absolute expiry, retains
retired paired and operator sessions for 30 days for bounded operational
recovery, and then removes only the expired session credential. Process-bound
local-tool sessions are single-use and remain for 24 hours before the same
bounded cleanup. Cleanup never removes the paired client, refresh family,
trusted-device passkey, master-password verifier, or security audit record, so
routine maintenance and package updates do not turn session housekeeping into
another pairing event.

## Model Health

Model settings distinguish stored credential state from endpoint health. A
credential is never rendered back into the page. Each saved connection can be
tested with its stored credential, and the result is scoped to the current
browser session. A successful test does not guarantee future availability.

Forge does not silently fall back from a selected external basic-chat provider
to a different external provider. If the selected connection needs attention,
test it, repair its credential or endpoint, or deliberately select another
connection.

## Mobile Pairing Recovery

Iroh is the default pairing transport. A generated QR is usable only when its
transport reports `ready`. An unavailable or failed transport remains visible
with its error and recovery command instead of being presented as healthy.

Pairing tokens are one-time credentials and cannot be recovered after the page
loses them. Generate a replacement QR when a pending token expires. For stale,
permission-denied, or failed pairings, refresh the status after checking the
iPhone first, then generate a replacement only when the existing bridge cannot
recover. Revoking a pairing requires the device to pair again.

## Install, Upgrade, And Uninstall

`npx forge-memory` installs the Forge runtime first and points selected OpenClaw,
Hermes, Codex, and Claude Code adapters at the same configured data root.
Repeated install and configure runs preserve existing files in that root.

Local `ui` and Forge Memory MCP startup require more than an HTTP health
response: the running process must also be a verified managed runtime with the
current local-browser handler. If a source runtime started by an older adapter
lacks that handler, Forge performs a locked ownership transfer and preserves the
configured data root. A failed transfer stops without adopting an unknown
process and restores the verified prior runtime when possible.

When the installed OpenClaw adapter starts the packaged Forge server, the server
derives its runtime package name and version from its own installed manifest.
This lets Forge Memory verify and adopt the recovered process without weakening
the protected identity check. A source or development server does not claim the
packaged identity.

`npx forge-memory update` creates a pre-update data archive before changing the
runtime cache or selected adapters. It stops if the required backup is not
confirmed or cannot be created. `npx forge-memory uninstall` removes the runtime
manager and optional adapter entries while preserving the Forge data root by
default. Data removal requires the separate explicit `--remove-data` option.

After install or update, run:

```bash
npx forge-memory status
npx forge-memory doctor
```

Confirm that both commands report the intended data root before reconnecting
agents or pairing a phone.

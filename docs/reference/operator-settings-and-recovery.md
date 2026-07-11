# Operator Settings And Recovery

Forge keeps operator controls under one settings index. Every settings page can
return directly to Runtime, Data, Users, Calendar, Mobile, Models, Agents,
KarpaWiki, Logs, Rewards, or Bin without returning to the main application
navigation first.

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

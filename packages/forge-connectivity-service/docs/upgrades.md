# Upgrades And Recovery

## Compatibility Policy

The HTTP contract is versioned as `forge-connectivity/1`; additive service implementation changes keep that identifier. Breaking authorization, canonicalization, route, or response changes require a new protocol version and explicit dual-version compatibility. The package version follows semantic versioning independently of Forge application releases.

SQLite migrations have monotonically increasing integer versions and immutable names in `src/storage/migrations.ts`. Startup verifies that the complete applied ledger is an exact ordered prefix, applies each missing migration in an immediate transaction, rebuilds quota counters from authoritative live rows, and refuses to open a missing, renamed, reordered, or newer migration. Reopening the current schema is idempotent.

Schema version 3 adds trigger-maintained global presence/key-package cardinality and channel/global request-nonce counters. The post-migration counter rebuild derives all new values from preserved authoritative rows.

## Upgrade Procedure

1. Run the new package's `npm run verify` and both production/full dependency audits against its committed lockfile; follow `releasing.md` for pack, install, SBOM, provenance, and container checks.
2. Stop the old process cleanly and create a SQLite-aware backup as described in `self-hosting.md`.
3. Start the new binary against a copy of the backup first. Confirm `/healthz`, discovery, signed presence, envelope put/get/ack, and key-package smoke operations.
4. Start the new binary against the production volume. Keep the previous binary and pre-upgrade backup until health and client compatibility are verified.
5. Do not run an older binary after a newer schema has been applied unless that release explicitly documents backward schema support.

## Failure Recovery

If startup fails, preserve the database, WAL, and logs. Logs intentionally contain only fixed error codes, so use an isolated copy and `PRAGMA quick_check` for diagnosis. Restore the verified pre-upgrade backup into a new data directory, start the prior image against that copy, and keep the failed database for offline inspection. Never delete or rewrite the only copy during recovery.

The upgrade test creates a version-1 database with live ciphertext, opens it through the current adapter, verifies migration and row preservation, reopens it idempotently, and confirms the schema version and health result.

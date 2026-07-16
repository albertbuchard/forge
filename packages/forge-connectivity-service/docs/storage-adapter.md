# Durable Storage Adapter Contract

`ConnectivityStore` in `src/storage/types.ts` is the bounded persistence boundary. The included `SqliteConnectivityStore` is authoritative for the self-hosted single-node profile. A future managed adapter must preserve these semantics rather than mapping methods to eventually consistent writes:

- atomically claim a channel-hash and nonce-hash pair while enforcing channel and service nonce-record quotas;
- atomically bind idempotency key, route scope, request digest, status, and metadata-only response;
- publish any long-poll wake notification only after the envelope and idempotency transaction commits;
- enforce channel and global live-byte, pending-envelope, retained-envelope, presence-row, key-package-row, nonce-record, and idempotency-record quotas in the same transaction as insertion or replacement;
- enforce unique channel/message and channel/package identifiers;
- retain acknowledged/expired envelope digest tombstones for the replay window while erasing ciphertext bytes;
- return strictly ordered, channel-scoped cursor pages without a full-channel scan;
- make acknowledgement idempotent and scoped to exactly one authenticated channel;
- expire payload bytes and purge replay, nonce, and idempotency metadata in bounded batches while keeping counters consistent;
- expose only readiness and schema/adapter compatibility, never content-reading administration.

Managed adapters also need shared rate-limit and long-poll admission state or an equivalent bounded edge layer. Cursor values are service-opaque positions, not portable database primary keys. An adapter change must pass the same route, replay, quota, long-poll, upgrade, abuse, and plaintext-absence test suites before deployment.

Do not add decryption, Forge identity lookup, user accounts, grant evaluation, arbitrary query, or generic object-storage reads to the adapter. Those capabilities would violate the connectivity service boundary.

# Threat Model

## Security Claims

The service can authenticate possession of an opaque channel authorization key, reject stale/replayed signed HTTP requests, store and return bounded byte strings labeled as ciphertext, enforce retention and resource limits, and erase live envelope ciphertext after acknowledgement or expiry. It cannot decrypt Forge peer envelopes and has no Forge API authority.

The service is content-blind, not metadata-invisible. Its operator can observe connection timing and volume at the host or network layer. SQLite necessarily retains second-order channel hashes, opaque message/package identifiers, byte sizes, timestamps, expiry, delivery state, and idempotency/replay hashes for bounded periods. Correlating those values may reveal traffic relationships even though it does not reveal shared records, grants, queries, or message contents.

## Adversaries And Controls

### Network observer or malicious provider operator

TLS hides HTTP contents from passive network observers between client and proxy. End-to-end Forge encryption keeps payload content hidden from the provider and a compromised service database. Rotating channels, short TTLs, and bounded polling can reduce correlation but cannot eliminate timing, volume, or source-network metadata. Application logs omit request bodies, actual channels, headers, IDs, source addresses, and byte sizes.

### Stolen channel capability

An attacker with the channel authorization private key can use every route for that channel. Ed25519 request signatures stop a party that knows only the opaque channel string. Timestamp and one-use nonce storage stop captured signed requests from being replayed. Channel keys must be distributed only inside the authenticated end-to-end peer protocol and rotated after compromise. The service does not distinguish members that intentionally share one channel capability.

### Malicious authenticated peer

An authorized peer can fill its channel quota, withhold acknowledgements, poll aggressively, churn channel capabilities, or upload arbitrary base64url bytes. Per-channel and global object/nonce/idempotency quotas, byte quotas, bounded-burst token buckets, TTL ceilings, maximum page sizes, concurrent-poll ceilings, strict JSON schemas, and fixed minimum ciphertext length bound this behavior. Rate-limiter identity churn cannot reset a depleted channel bucket: full buckets are evicted first and excess identities share a bounded overflow bucket. The provider cannot prove supplied bytes are cryptographically valid ciphertext; the peer protocol must authenticate/decrypt and reject invalid envelopes after retrieval.

### Unauthenticated denial of service

Global request limits apply before application header/body validation and channel authentication; the HTTP parser's framing/header ceiling and the application body ceiling bound requests that reach those hooks. Immediate burst capacities are lower than minute rates. Duplicate security/framing headers, conflicting body framing, undeclared media types, and non-identity content encoding are rejected. Authorization components are fixed-length before Ed25519 work, and channel rate admission occurs before nonce persistence. `/healthz` bypasses regular-traffic admission for stable local readiness and must be denied at the public proxy. A public operator should add connection and bandwidth controls at the reverse proxy because application limits alone cannot stop network saturation.

### Replay, reordering, and duplicate delivery

HTTP request nonces prevent transport-request replay, including at both inclusive clock-skew boundaries. `Idempotency-Key` records make concurrent and sequential mutation retries deterministic and reject key reuse with a different canonical request digest. External poll notifications occur only after that atomic write commits. Envelope and key-package identifiers are unique per channel; reuse with different ciphertext is a conflict. Acknowledged/expired envelope tombstones retain a channel-scoped content digest through the configured replay window. Retained-envelope, presence, key-package, nonce, and idempotency counters prevent small-row churn from growing unbounded metadata. Cursor order uses an indexed monotonic SQLite row identifier. End-to-end message sequence, MLS epoch, and business replay checks remain the Forge peer protocol's responsibility.

### Database theft, rollback, or corruption

Database theft exposes ciphertext and bounded routing metadata, not channel private keys or Forge tokens. SQLite `quick_check` gates health. Migrations are ordered and transactional, and binaries fail closed on a newer schema. A database rollback can re-present previously pending ciphertext or forget HTTP nonce/idempotency records; the peer protocol must still reject message/epoch replay. Operators should encrypt storage, secure backups, and monitor rollback at the deployment layer.

### Logging and diagnostics

The Fastify request logger is disabled. Safe logs use a closed field set: timestamp, severity, fixed event, one of the supported HTTP methods or `OTHER`, route template, status class, duration bucket, fixed error code, and shutdown signal. Error messages, headers, bodies, actual paths, unsupported methods, channel values, source addresses, message IDs, sizes, and stack traces are excluded. Deterministic blindness tests scan responses, captured logs, and SQLite database/WAL bytes for bearer-token, grant, projection, contact, and plaintext fixtures.

## Explicit Non-Claims

- The service cannot determine whether an authorized client uploaded real ciphertext or base64url-encoded plaintext.
- Acknowledgement cannot erase copies already returned to an authorized client or retained in provider backups.
- Rate limits are per process. A future multi-node adapter needs shared atomic rate/quota state at the edge or datastore.
- SQLite is not a multi-node managed-service datastore.
- The service does not provide anonymity; Tor or another privacy transport must be selected by the peer client when hiding network addresses is required.
- The service does not authorize Forge projections, interpret queries, manage peer identity, or enforce MLS epochs. Those remain end-to-end Forge responsibilities.

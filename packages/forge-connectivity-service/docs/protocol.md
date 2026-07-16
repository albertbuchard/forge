# Forge Connectivity HTTP Protocol

## Channel Capability

A channel authorization key is a dedicated Ed25519 capability key. It is not a Forge principal/device identity key, MLS key, Forge bearer token, operator token, or service account. Every peer that is allowed to use one mailbox channel must possess this capability private key. Rotate the channel by creating and distributing a new capability through the authenticated end-to-end peer protocol.

Let `SPKI` be the canonical DER SubjectPublicKeyInfo encoding of the Ed25519 public key. The path value is:

```text
opaqueChannel = base64url_no_pad(
  SHA256("forge-connectivity-channel-id-v1\0" || base64url_no_pad(SPKI))
)
```

It is exactly 43 base64url characters. SQLite does not store that path value or `SPKI`; it stores a domain-separated second-order hash of the channel.

## Signed Request

Protected routes require:

```text
Authorization: ForgeChannel v1.<spki>.<timestamp>.<nonce>.<signature>
```

- `spki` is unpadded base64url DER SPKI.
- `timestamp` is Unix seconds and must be within the configured server skew window.
- `nonce` is 16-32 random bytes encoded as unpadded base64url and may be used only once per channel.
- `signature` is a 64-byte Ed25519 signature encoded as unpadded base64url.

The Ed25519 SPKI is exactly 44 DER bytes (59 unpadded base64url characters), the signature is exactly 86 base64url characters, and the nonce is 22-43 base64url characters. Authorization parsing is length-bounded before cryptographic verification. `Authorization`, `Idempotency-Key`, and HTTP framing/media headers must each occur at most once; conflicting `Content-Length`/`Transfer-Encoding` framing is rejected by the HTTP parser or application guard. Forge bearer credentials, cookies, and `x-forge-*` metadata are rejected on every route; public routes reject any `Authorization` header.

The signed UTF-8 string is seven newline-separated fields with no final newline:

```text
forge-connectivity-request-signature-v1
<UPPERCASE_METHOD>
<CANONICAL_TARGET>
<UNIX_SECONDS>
<NONCE_BASE64URL>
<CANONICAL_BODY_SHA256_BASE64URL>
<IDEMPOTENCY_KEY_OR_HYPHEN>
```

`CANONICAL_TARGET` contains the URL path plus query parameters sorted first by key and then by value using ascending UTF-16 code-unit order. Query names and values are serialized with standard `URLSearchParams` percent encoding. The signature therefore binds cursors, page limits, and long-poll duration. Declared integer query values use unsigned decimal notation; duplicate or undeclared query names are rejected.

The body digest is SHA-256 over canonical JSON encoded as UTF-8. Canonical JSON uses `JSON.stringify` scalar encoding, preserves array order, removes object members whose value is JavaScript `undefined`, and sorts object keys by ascending UTF-16 code-unit order at every level. JSON nesting deeper than 32 levels is rejected. Empty-body requests hash the empty byte string. Implementations outside JavaScript should match these rules byte for byte and use the published deterministic tests as vectors.

Mutation signatures bind the exact 16-128 character base64url `Idempotency-Key`. Read requests use `-` in the final field. A retry needs a fresh timestamp/nonce/signature but reuses the same idempotency key and semantic request. Reusing a key with a different method, target, or body digest returns a conflict. Every successful mutation response includes `Idempotency-Replayed: true|false`; envelope arrival notifications are published only after the mutation and its idempotency record commit together.

## Ciphertext Objects

All accepted payload-bearing JSON fields are named `ciphertext` and contain unpadded base64url. Decoded values are 32 bytes or larger and route-bounded. The service does not parse an envelope, presence descriptor, or key package after base64url decoding and cannot prove that an authorized client supplied valid encryption.

- Presence is one replaceable ciphertext per channel. `DELETE` removes it and its byte usage.
- An envelope is bound to one opaque `messageId`. Repeating the same ID and channel-scoped ciphertext digest is a duplicate; changing ciphertext is a replay conflict.
- `GET /v1/envelopes/{opaqueChannel}` returns pending, unexpired envelopes ordered by insertion position. `ack` sets their state to acknowledged and erases ciphertext bytes while retaining a bounded digest tombstone.
- A key package is bound to one opaque `packageId` and remains readable until TTL cleanup. Changing ciphertext under the same ID is a replay conflict.

TTL values are relative seconds in mutation bodies. Responses use UTC RFC 3339 timestamps. The server applies default TTLs when omitted and rejects values above route maximums.

Routes with a body accept only `application/json`. JSON scalar/member types are not coerced after signature verification. Routes without a documented body reject any non-empty HTTP body. Routes without documented query parameters reject every query parameter; routes with queries reject undeclared names. Request schemas are strict and accept no grant, projection, contact, record, or plaintext-content field.

## Cursors And Long Polling

Cursors are opaque, unpadded base64url encodings of an unsigned 64-bit insertion position. Clients must not decode or synthesize them. An absent cursor starts at position zero. Each response returns `nextCursor`; when no item is returned it equals the request position.

Envelope reads may set `waitSeconds` up to the discovery maximum. The service first performs an indexed bounded read, then waits only if the page is empty. A generation check closes the read/wait race so an arrival cannot be missed between those steps. Long polling is subject to global and per-channel concurrency limits, releases admission immediately when the client disconnects without reporting a false service-shutdown error, and returns `pollTimedOut: true` only when its wait duration elapsed without an available envelope.

## Replay Layers

The HTTP service enforces request nonce replay, mutation idempotency, message/package ID binding, bounded digest tombstones, and channel/global nonce-record quotas. Nonce records remain live through the inclusive timestamp-skew boundary, so a request accepted at the future edge cannot be replayed at the past edge. Channel rate admission occurs before a verified nonce is durably claimed, so denied traffic cannot consume nonce storage. Forge peers must independently enforce end-to-end message IDs, sequence, expiry, MLS group epoch, signature, grant version, and business-level deduplication after decryption. A rolled-back provider database must not be able to make a Forge peer apply an old envelope twice.

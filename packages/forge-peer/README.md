# forge-peer

`forge-peer` is a standalone Rust implementation of the disjoint `forge-peer/1`
device-to-device protocol. It does not share an ALPN, frame format, credential,
session, or HTTP proxy surface with `companion-iroh`.

The crate is intentionally outside the Forge JavaScript workspace. Its production
stack is Rust 2024, Tokio, bincode 2, Ed25519, OpenMLS 0.8.1 with the RustCrypto
provider, Iroh 1.0.2, rustls-backed reqwest, XChaCha20-Poly1305 state sealing, and
SHA-256/JCS for the cross-language grant contract.

## Security model

- Principals are stable Ed25519 root identities. Rotating device keys receive
  root-signed, time-bounded certificates containing protocol ranges and critical
  capabilities.
- Pairing QR data is signed and contains a public bootstrap key plus a commitment,
  never a reusable bearer credential. The final transcript binds both certified
  devices, the highest mutually supported protocol, selected structured endpoints,
  the human verification phrase commitment, and the initial grant commitment.
- Invite claiming and consumption use an atomic storage interface. The reference
  implementation permits exactly one claimant, limits failed proofs, hashes the
  bootstrap proof with domain separation, and rejects wall-clock rollback or
  monotonic expiry revival.
- Application plaintext is carried only in OpenMLS 0.8.1 messages. The outer
  device-signed envelope authenticates protocol version, sender, message kind,
  sequence, acknowledgement, expiration, MLS epoch, and ciphertext.
- Replay state uses compare-and-swap storage, a 64-message reorder window, recent
  message IDs, contiguous grant hash chains, MLS epoch floors, and a pinned
  negotiated protocol/capability chain.
- Every MLS ratchet or membership mutation is sealed and checkpointed before its
  output is returned. A failed persistence step poisons that in-memory session.
- All network endpoints are typed. HTTPS mailbox origins require an explicit local
  allowlist, DNS resolution and address pinning, metadata-address denial, and an
  explicit exception for any non-public address.
- Unix ownership is only the first local IPC boundary. Every effectful request also
  requires a Node-issued Ed25519 authorization bound to the owner, actor, session or
  companion device, capability, exact command digest, approval deadline, and current
  signed invalidation epoch.
- Authenticated inbound queries are durably claimed and answered by a local source
  worker only after the daemon applies the complete grant attenuation rules. Forge
  records never enter a relay, Tor process, or mailbox as plaintext.

No API in this package accepts a Forge bearer token. No provider accepts an
arbitrary HTTP method, path, URL, header set, or response destination.

## Framing

Peer and IPC frames begin with a fixed 10-byte header:

| Field | Size | Rule |
| --- | ---: | --- |
| Magic | 4 | `FGP1` |
| Type | 1 | `1` peer envelope, `2` local IPC |
| Flags | 1 | Must be zero; compression is unsupported |
| Length | 4 | Big-endian body length |

Peer bodies use bounded bincode 2 encoding and are limited to 256 KiB. Local IPC
bodies use strict JSON and are limited to 64 KiB. Decoders reject unknown frame
types, flags, trailing bytes, oversized lengths, unknown JSON fields, and invalid
typed values. Individual application plaintext and MLS ciphertext limits are lower.

## Grant signatures and evidence

`src/grant.rs` mirrors the API grant version schema. Canonicalization first sorts
only the set-like arrays defined by the TypeScript contract:

- rules by `projectionId:effect:id`;
- entity IDs, included fields, excluded fields, and approved device IDs;
- signatures by `party:deviceId`.

Object keys and JSON numbers use RFC 8785/JCS serialization, which matches the
contract for the fixed ASCII schema keys. Rule IDs and signer device IDs are
restricted to ASCII because TypeScript currently uses locale-dependent
`localeCompare` for those sort keys; rejecting other values is safer than producing
a platform-dependent signature.

Consent signatures are Ed25519 over these exact bytes:

```text
"forge-peer/grant-signature/v1\0"
|| canonical-consent-json
|| "\0"
|| canonical-signer-metadata-json
```

Canonical consent excludes only `status`, `revokedAt`, and `signatures`. It includes
identity, direction, hash-chain, time, cache, rules, protocol, and schema fields.
Signer metadata contains `deviceId`, `party` (`grantor` or `grantee`), `algorithm`,
and `signedAt`.

An active grant must have verified signatures from both distinct parties and at
least two distinct device IDs. `verify_active_grant` resolves each signer through a
local `GrantTrustResolver`, verifies the current device certificate and signing-time
certificate validity, and verifies every signature. It then creates a
`VerifiedGrantEvidence`; callers cannot construct its fields through the public Rust
API.

The owner-only IPC response serializes evidence as:

```json
{
  "type": "grant_verified",
  "requestId": "request_1",
  "evidence": {
    "verifiedGrantHash": "<sha256-of-complete-canonical-version>",
    "verifiedSignerDeviceIds": ["grantor_device", "grantee_device"],
    "verifiedSigners": [
      { "deviceId": "grantee_device", "party": "grantee" },
      { "deviceId": "grantor_device", "party": "grantor" }
    ]
  }
}
```

`verifiedGrantHash` includes lifecycle fields and the complete sorted signature
array. The IPC request contains only the grant; caller-asserted hashes, signer lists,
or verification flags are unknown fields and are rejected. Relationship-device
approval remains a separate, current local policy check by the API.

`tests/vectors/grant-canonical-v1.json` was generated with Node.js Ed25519 and the
TypeScript canonicalization algorithm. The Rust test verifies both Node signatures
and the final complete-version hash, so consent field drift and final hash drift fail
independently.

## Local IPC daemon

`OwnerIpcServer` binds an absolute Unix socket in a real owner-only directory, sets
the socket to mode `0600`, verifies peer credentials against the socket owner, and
handles one bounded typed request per connection. `DurableDaemonHandler` is the
production handler: it binds one Forge `ownerUserId` to one local Ed25519/X25519
identity, pins relationship/device certificates learned from signed pairing
material, encrypts its state with a root-derived XChaCha20-Poly1305 key, takes an
exclusive process lock, and commits updates with owner-only atomic writes.

The strict JSON request method names and response discriminants are:

| `type` | Required top-level fields | Typed result response |
| --- | --- | --- |
| `protocol_info` | `requestId` | `protocol_info` |
| `verify_grant` | `requestId`, `grant` | `grant_verified` |
| `health` | `requestId` | `health` |
| `transport_readiness` | `requestId`, `input` | `transport_readiness` |
| `local_identity` | `requestId`, `input` | `local_identity` |
| `command_receipt` | `requestId`, `input` | `command_receipt` |
| `sync_command_authorization_state` | `requestId`, optional `commandId`, `input` | `command_authorization_state_synchronized` |
| `create_invitation` | `requestId`, `commandId`, `approvalDeadline`, `input`, `authorization` | `invitation_created` |
| `cancel_invitation` | same authorized command fields | `invitation_canceled` |
| `accept_invitation` | same authorized command fields | `invitation_accepted` |
| `accept_pending_request` | same authorized command fields | `pending_request_accepted` |
| `confirm_pairing` | same authorized command fields | `pairing_confirmed` |
| `sign_grant` | same authorized command fields | `grant_signed` |
| `accept_grant` | same authorized command fields | `grant_accepted` |
| `revoke_grant` | same authorized command fields | `grant_revoked` |
| `update_device` | same authorized command fields | `device_updated` |
| `rotate_host_credential` | same authorized command fields | `host_credential_rotation_started` |
| `revoke_relationship` | same authorized command fields | `relationship_revoked` |
| `request_resync` | same authorized command fields | `resync_requested` |
| `execute_query` | `requestId`, `input` | `query_executed` |
| `claim_inbound_query` | authorized command fields | `inbound_query_claimed` |
| `respond_inbound_query` | authorized command fields | `inbound_query_responded` |
| `list_revocation_events` | `requestId`, `input` | `revocation_events_listed` |
| `ack_revocation_events` | authorized command fields | `revocation_events_acknowledged` |

`protocol_info` and `verify_grant` remain available for compatibility, but the
durable handler disables standalone `verify_grant`: grant evidence must be resolved
through a daemon-owned relationship rather than caller-supplied signer bindings.
Unknown methods, fields, enum values, and trailing JSON are rejected.

Every command-authorized effectful request has this outer shape (shown for
invitation creation):

```json
{
  "type": "create_invitation",
  "requestId": "dispatch_01",
  "commandId": "01JCOMMAND000000000000000001",
  "approvalDeadline": "2026-07-16T12:10:00Z",
  "input": {
    "ownerUserId": "forge_owner_id",
    "label": "Alice's laptop",
    "expiresAt": "2026-07-16T12:20:00Z",
    "privacyMode": "fastest",
    "transportKinds": ["local_direct", "iroh"]
  },
  "authorization": {
    "protocol": "forge-peer-command-authorization/v1",
    "authorityKeyId": "<canonical-base64url-domain-separated-sha256-key-id>",
    "authorizationId": "authorization_01JCOMMAND00000001",
    "ownerUserId": "forge_owner_id",
    "actor": {
      "class": "operator_session",
      "actorId": "forge_owner_id",
      "sessionId": "session_01JCOMMAND00000001",
      "deviceId": null
    },
    "capability": {
      "kind": "human_approval",
      "capabilityId": "capability_01JCOMMAND000001",
      "actionDigest": "<lowercase-sha256-hex>",
      "state": "consumed",
      "issuedAt": "2026-07-16T12:00:00Z",
      "expiresAt": "2026-07-16T12:10:00Z"
    },
    "action": "create_invitation",
    "commandId": "01JCOMMAND000000000000000001",
    "commandDigest": "<lowercase-sha256-hex>",
    "approvalDeadline": "2026-07-16T12:10:00Z",
    "issuedAt": "2026-07-16T12:00:01Z",
    "invalidationEpoch": "7",
    "signature": "<canonical-base64url-ed25519-signature>"
  }
}
```

`commandId` must contain 16 through 240 non-control Unicode scalar values without
surrounding whitespace. `commandDigest` is SHA-256 over
`"forge-peer/node-command-action/v1\0" || JCS(request minus requestId)`; it therefore
binds `type`, `commandId`, `approvalDeadline`, and `input`. The Ed25519 signature is
over `"forge-peer/node-command-authorization/v1\0" || JCS(authorization minus
signature)`. Human commands require a consumed `human_approval` capability from an
`operator_session` or `companion_consent` actor. Claim/respond workers require an
active `query_worker` capability; revocation ACKs require an active
`revocation_consumer` capability. A companion approval actor remains distinct from
the certified host peer identity and never supplies a peer transport credential.

The daemon loads a separately signed, owner-bound command-authority state with a
canonical decimal epoch, `invalidatedBefore`, and bounded revoked authorization,
session, and device ID sets. `sync_command_authorization_state` verifies its Ed25519
signature and monotonic epoch before committing it. Its receipt key is derived from
the signed epoch and canonical state hash. An optional caller `commandId` must equal
that derived key, preventing an unauthenticated same-UID process from consuming the
receipt bound with aliases. Exact ID/state replay returns the original result, while
the same ID with a different signed state conflicts. A production daemon started without
`--command-authority-public-key` remains usable for non-effectful reads but rejects
every effectful request. The owner-only
`command-authorization-state.json` file has exactly `protocol`, `authorityKeyId`,
`ownerUserId`, `epoch`, `invalidatedBefore`, `revokedAuthorizationIds`,
`revokedSessionIds`, `revokedDeviceIds`, and `signature`; it must be an atomically
written mode-`0600` regular file.

The durable replay key is `commandId` plus BLAKE3 of JCS(request minus `requestId`
and `commandId`). The hash still binds `type`, `approvalDeadline`, and `input`;
authorization is verified and stored separately. The daemon checks current
invalidation and the absolute deadline before execution, stages every network effect
into the durable outbox, checks the deadline again immediately before atomic commit,
and stores the exact result, authorization provenance, deadline, and `committedAt`.
The same ID and body with the exact original authorization returns that stored result
even after response loss or deadline expiry and never repeats the effect. The same ID
with a different method or body returns `conflict`. `command_receipt` retrieves the
committed result without re-execution. The 4,096-entry receipt store fails closed at
capacity and never silently evicts replay keys.

`command_receipt.receipt` has exactly `commandId`, `operation`, `requestHash`,
nullable `approvalDeadline`, nullable `committedAt`, nullable `authorization`, and
`result`. Authorization provenance has exactly `authorityKeyId`, nullable
`authorizationId`, `actorClass`, `actorId`, `actorDeviceId`, `sessionId`,
`capabilityId`, and `actionDigest`, plus canonical decimal `invalidationEpoch`,
`authorityStateHash`, and `verifiedAt`.

Input field names are the camel-case fields in `src/daemon.rs`:

- `transport_readiness`, `local_identity`, and
  `sync_command_authorization_state`: `ownerUserId`.
- `command_receipt`: `ownerUserId`, `commandId`.
- `create_invitation`: `ownerUserId`, `label`, `expiresAt`, `privacyMode`,
  `transportKinds`.
- `cancel_invitation`: `ownerUserId`, `invitationId`.
- `accept_invitation`: `ownerUserId`, `invitation`, `localDeviceId`, `privacyMode`,
  `scannedAt`.
- `accept_pending_request`: `ownerUserId`, `request`. The request has exactly `id`,
  `ownerUserId`, nullable `relationshipId`, `kind`, `status`, `version`, `payload`,
  `payloadHash`, `expiresAt`, nullable `decidedAt`, `decisionReason`, `createdAt`, and
  `updatedAt`.
- `confirm_pairing`: `ownerUserId`, `pairingId`, `requestPayload`,
  `transcriptHash`, `verificationPhrase`.
- `sign_grant`: `ownerUserId`, `relationshipId`, `grant`.
- `accept_grant`: `ownerUserId`, `grant`.
- `revoke_grant`: `ownerUserId`, `grant`, `reason`.
- `update_device`: `ownerUserId`, `relationshipId`, `deviceId`, `action` where
  `action` is `approve` or `remove`.
- `rotate_host_credential`: `ownerUserId`, `notAfter`.
- `revoke_relationship`: `ownerUserId`, `relationshipId`, `reason`.
- `request_resync`: `ownerUserId`, `relationshipId`, `projectionIds`.
- `execute_query`: `ownerUserId`, `relationshipId`, `personId`, `query`,
  `timeoutMs`. Query fields are `projectionId`, `parameters`, `interval`,
  `entityIds`, `fields`, `precision`, and `maximumResultCount` (1 through 1,000).
- `claim_inbound_query`: `ownerUserId`, `workerId`, `leaseMs`.
- `respond_inbound_query`: `ownerUserId`, `workerId`, `claimId`, `queryId`,
  `payload`, `asOf`, `completeness`, `redactedFields`; payload is exactly
  `{records:[{recordId,fields}]}`.
- `list_revocation_events`: `ownerUserId`, `consumerId`, `afterCursor`, `limit`.
- `ack_revocation_events`: `ownerUserId`, `consumerId`, `throughCursor`,
  `eventHash`.

An inbound claim, when present, has exactly `claimId`, `queryId`,
`relationshipId`, `requester`, `query`, `entityIdsAreOpaque`,
`intervalTimeZoneAuthenticated`, `grantId`, decimal-string `grantSequence`,
`grantVerificationId`, `verifiedGrantHash`, `ruleId`, `maximumPayloadBytes`,
`redactedFields`, `receivedAt`, `expiresAt`, and `leaseExpiresAt`. A revocation page
has exactly `events`, `acknowledgedCursor`, `nextCursor`, `hasMore`, and
`provenance`. Each signed event has exactly `cursor`, `eventHash`,
`previousEventHash`, `kind`, `source`, `relationshipId`, nullable `grantId`,
`deviceId`, `targetCertificate`, `targetCertificateHash`, and
`targetCertificateSerial`, then `reason`, `occurredAt`, nullable authenticated remote
principal/device IDs, `signingDeviceId`, `signingCertificate`,
`signingCertificateHash`, and `signature`. ACK results have exactly `consumerId`,
`acknowledgedCursor`, `eventHash`, `acknowledgedAt`, and `provenance`. Cursors are
monotonic decimal strings; event hashes form a signed durable chain, and ACK rollback
or same-cursor hash forks fail closed.

All successful management results include daemon-derived provenance with exactly
`protocolVersion`, `ownerUserId`, nullable `relationshipId`, `localPrincipalId`,
`localDeviceId`, nullable `remotePrincipalId`, nullable `remoteDeviceId`,
`evidenceHash`, and `authenticatedAt`. It is authenticated by the owner-only local
socket and derived from pinned signed peer state; it is not a caller-supplied
authorization assertion or a portable bearer credential.

### Identity and endpoint JSON

`local_identity` returns public material only. Its exact outer shape is
`{type:"local_identity",requestId:string,identity:{principal,device,provenance}}`.
The typed identity objects are strict and reject unknown fields:

```json
{
  "principal": {
    "id": "<lowercase-hex-32-bytes>",
    "rootPublicKey": "<canonical-base64url-32-bytes>",
    "trustState": "verified",
    "certificateHash": "<lowercase-blake3-hex>"
  },
  "device": {
    "id": "<lowercase-hex-16-bytes>",
    "principalId": "<lowercase-hex-32-bytes>",
    "signingPublicKey": "<canonical-base64url-32-bytes>",
    "keyAgreementPublicKey": "<canonical-base64url-32-bytes>",
    "certificateSerial": "1",
    "certificate": "<canonical-base64url-signed-device-certificate>",
    "certificateHash": "<lowercase-blake3-hex>",
    "capabilities": ["direct_stream", "iroh", "query", "projection"],
    "transportEndpoints": [],
    "status": "approved"
  },
  "provenance": {
    "protocolVersion": "forge-peer/1",
    "ownerUserId": "forge_owner_id",
    "relationshipId": null,
    "localPrincipalId": "<lowercase-hex-32-bytes>",
    "localDeviceId": "<lowercase-hex-16-bytes>",
    "remotePrincipalId": null,
    "remoteDeviceId": null,
    "evidenceHash": "<lowercase-blake3-hex>",
    "authenticatedAt": "2026-07-16T12:00:00Z"
  }
}
```

`certificateSerial` is a canonical nonzero decimal `u64` JSON string, never a JSON
number. `certificate` is unpadded base64url of the validated canonical Bincode 2
big-endian, variable-integer encoding of `DeviceCertificate`, bounded to 24 KiB
decoded and 64 through 32,768 encoded characters. `certificateHash` is lowercase
hex BLAKE3 over those decoded certificate bytes. The certificate signs the device's
Ed25519 key, X25519 key, capability bits, principal, serial, protocol range, and
validity interval. The array of capability names is emitted in the fixed order
`direct_stream`, `iroh`, `tor`, `http_mailbox`, `query`, `projection`, `key_package`
for the bits present in that certificate.

`transportEndpoints` is a maximum-eight tagged camel-case union:

```text
{kind:"local_direct",host:string,port:u16}
{kind:"iroh",endpointId:canonicalBase64url32,relayOrigin:string|null}
{kind:"tor_onion",onionHost:string,port:u16}
{kind:"http_mailbox",origin:string,opaqueChannel:canonicalBase64url32}
```

Direct `host` values are canonical IP literals; hostnames are deliberately not
accepted. Ports are nonzero. Iroh IDs and mailbox channel IDs are canonical unpadded
base64url encodings of nonzero 32-byte values. Relay and mailbox origins, when
present, are canonical HTTPS origins. Tor hosts are lowercase, checksum-valid v3
`.onion` names. Unknown fields, malformed values, duplicates, and noncanonical order
are rejected.

Canonical endpoint order is by kind (`local_direct`, `iroh`, `tor_onion`, then
`http_mailbox`) and then by semantic binary key: IP family/address/port; Iroh ID,
null-before-present relay origin, and length-prefixed origin; length-prefixed onion
host and port; or length-prefixed mailbox origin and channel ID.

Endpoint arrays are not fields of `DeviceCertificate`. In `local_identity`, they are
the daemon's current configured direct, Iroh, and Tor endpoints returned over
owner-bound IPC. A configured mailbox origin is reported by `transport_readiness`
but deliberately omitted from the local device: the configuration marker is not a
relationship capability and would be a false routable endpoint. Pairing derives a
fresh, non-derivable mailbox channel from the one-time bootstrap proof.

`pairing_confirmed.confirmation` has exactly `relationship`, nullable
`outboundEnvelope`, and `provenance`. `relationship` has exactly `id`,
`localPrincipal`, `remotePrincipal`, `localDevice`, `remoteDevice`,
`negotiatedProtocolVersion`, `verificationPhraseHash`, and `privacyMode`.
`localDevice.transportEndpoints` and `remoteDevice.transportEndpoints` are the exact
selected sets retained in that durable relationship. The inviter set comes from the
signed invitation and co-signed transcript. The accepter set is inside the encrypted
pairing acceptance, whose complete ciphertext-bearing envelope is signed by the
accepter certificate; it is never reconstructed from caller metadata or a
placeholder. Restart, credential rotation, and command replay return the retained
pairing-time endpoint and certificate values unchanged.

Binary fields in JSON (`bootstrapCiphertext`, `bootstrapNonce`, bootstrap QR data,
signatures, and `outboundEnvelope`) use unpadded canonical base64url. A Node adapter
must decode those fields to `Uint8Array`; it must not introduce bearer authorization
or forward arbitrary headers/URLs.

The query result payload is deliberately aligned with the API projection envelope:

```json
{
  "state": "live",
  "payload": {
    "records": [
      {
        "recordId": "opaque_remote_record_id",
        "fields": { "displayName": "Alice" }
      }
    ]
  },
  "metadata": {
    "source": {
      "principalId": "<pinned remote principal>",
      "deviceId": "<approved remote device>",
      "relationshipId": "<durable relationship>"
    },
    "projectionId": "person.profile.v1",
    "projectionVersion": 1,
    "grantId": "<verified active grant>",
    "grantSequence": 1,
    "grantVerificationId": "fpv_<derived id>",
    "verifiedGrantHash": "<sha256>",
    "asOf": "2026-07-15T12:00:00Z",
    "receivedAt": "2026-07-15T12:00:01Z",
    "validUntil": "2026-07-15T12:10:00Z",
    "completeness": 1.0,
    "precision": "exact",
    "redactedFields": [],
    "state": "live"
  }
}
```

The daemon derives source and grant provenance from pinned durable state. The query
request cannot submit metadata, verification IDs, verified hashes, signer lists, or
authorization flags. The source daemon durably records an authenticated inbound
request, applies grant direction, projection, entity, interval, field, precision,
result-count, payload-size, validity, approved-device, and revocation attenuation,
then exposes only the attenuated claim to a Node query worker.
`respond_inbound_query` revalidates the lease, worker, grant, relationship,
certificate, field set, record count, and 48 KiB payload ceiling before queuing the
signed MLS response. Claims and responses survive restart and exact command replay.
The pre-attenuation V1 wire request remains decode-compatible for existing peers but
cannot enter the source evaluation bridge: after relationship and grant verification,
it receives an authenticated `unavailable` response. Production `execute_query`
always emits V2; silently upgrading V1 would invent bounds the requester never signed.
If no authenticated response arrives within the bounded request timeout,
`execute_query` returns `state:"unavailable"` with `{records:[]}` rather than
fabricating content. The JSON payload ceiling reserves 16 KiB beneath the 64 KiB IPC
frame for response metadata and provenance; the boundary vector verifies a maximum
valid result remains frameable.

Initialize the identity once, then start the operational daemon with the same
owner-only state directory. Direct endpoints are typed socket addresses and are
validated before the daemon starts. `--enable-iroh` adds a stable endpoint ID derived
from the local principal secret and starts the live Iroh accept/outbound worker:

```sh
cargo run --bin forge-peer -- identity init \
  --state-dir /absolute/owner-only/forge-peer-state

cargo run --bin forge-peer -- serve \
  --socket /absolute/owner-only/forge-peer-ipc/forge-peer.sock \
  --state-dir /absolute/owner-only/forge-peer-state \
  --owner-user-id forge_owner_id \
  --command-authority-public-key '<canonical-base64url-ed25519-public-key>' \
  --direct-endpoint 10.20.30.40:4242 \
  --enable-iroh
```

The CLI supervises IPC and transport workers as one failure domain and shuts down
the other worker if either exits. The durable outbox authenticates acknowledgements,
replays the same packet bytes, alternates selected endpoints, and uses bounded
exponential reconnect backoff. `recover-socket` proves an owner-only socket is stale
before removing it. Identity initialization, public export, revocation, and safe
rotation are local-console operations. `rotate_host_credential` is the distinct
active-relationship path: it creates a root-signed successor, commits an OpenMLS
self-update and one durable signed rotation packet per relationship, retains the
predecessor until every peer acknowledgement is authenticated, then atomically
promotes the successor and records credential-retirement revocation events. Existing
grants remain bound to their historical certified signers; stale, forked, rolled
back, prematurely retired, or predecessor-signed new operations are rejected.

## Transport providers

- **Direct stream:** a typed connector plus supervised Tokio TCP listeners and an
  outbound worker. The peer endpoint is a validated IP/port, not a URL.
- **Iroh:** the production `serve --enable-iroh` worker uses Iroh 1.0.2 with the
  dedicated ALPN `forge-peer/1`, direct discovery, and Iroh's configured relay path.
  Peer-selected custom relay origins are rejected; the emitted endpoint descriptor
  therefore has `relayOrigin: null`.
- **Tor:** `serve` accepts `--tor-executable` and a loopback
  `--tor-socks-endpoint` together, with an optional owner-only `--tor-data-dir`.
  It starts a v3 onion service whose target is the supervised peer listener, clears
  the subprocess environment, ignores ambient Tor configuration, passes every
  argument directly without a shell, suppresses child output, validates the
  executable and state paths, and enforces bounded startup, restart count, and
  exponential backoff. Outbound onion connections use a strict SOCKS5 handshake.
  A restart must retain the same onion identity or the daemon fails closed.
- **HTTP mailbox:** `serve --mailbox-origin https://...` probes and supervises the
  exact Forge connectivity service contract: `/healthz`,
  `POST /v1/envelopes/{channel}`, `GET /v1/envelopes/{channel}`, and
  `POST /v1/envelopes/{channel}/ack`. Requests use the service's `ForgeChannel v1`
  Ed25519 authorization format over the canonical method, target, timestamp, random
  nonce, body hash, and idempotency key. Each direction has a distinct
  relationship-scoped key and opaque channel; no global bearer or Forge token is
  accepted. Items are XChaCha20-Poly1305 encrypted, signed, and padded into fixed
  buckets before upload. Fetches are randomized, limited to four items, bounded to
  2 MiB service responses and 256 KiB ciphertexts, and acknowledged only after
  durable authenticated ingestion.

Mailbox origins are HTTPS-only, redirect- and proxy-disabled, DNS-pinned, and reject
private, loopback, link-local, multicast, and metadata addresses by default.
`--mailbox-allow-private-origin` is an explicit exact-origin deployment exception.
`--mailbox-allow-loopback-origin` is restricted to canonical `localhost`, requires
all pinned addresses to be loopback, requires an exclusive CA bundle through
`--mailbox-ca-file`, and cannot be combined with the private-origin mode. Polling is
bounded to 100 ms through 30 seconds and adds randomized delay/backoff.

`transport_readiness` returns a maximum-one entry per configured transport with
exact fields `kind`, `state` (`ready`, `degraded`, or `stopped`), `detailCode` (a
bounded non-secret machine code), and Unix-second `checkedAt`, plus authenticated
daemon provenance. An authenticated endpoint with no matching configured provider
returns a precise `unavailable` failure; it is never silently rerouted. Mailbox
storage and relays are untrusted: outer signatures, replay state, MLS, and mailbox
content encryption provide end-to-end authenticity and confidentiality.

## Persisted MLS state

`MlsStateStore` and `AntiRollbackCheckpointStore` are separate compare-and-swap
interfaces. `PersistedStateCoordinator` uses a two-phase pending checkpoint so it
can reconcile a crash before or after the sealed state write. XChaCha20-Poly1305 AAD
binds state ID, checkpoint counter, and MLS epoch. Loading rejects missing, stale,
substituted, or rolled-back blobs.

`DurableMlsBackend` is the package-owned, owner-only, single-writer backend. It
stores bounded MLS snapshots and checkpoint records in one crash-safe file while
preserving compare-and-swap semantics. A higher-assurance production integration
should still:

1. store checkpoint counters/hashes in stronger rollback-resistant storage such as
   platform secure hardware or an independently protected service;
2. source the root identity wrapping key from platform secret storage;
3. preserve independently verifiable rollback evidence across whole-directory
   restore operations.

## Signed release manifests

`src/manifest.rs` verifies a strict `forge-peer-signed-manifest/v1` document. The
signature is Ed25519 over the domain `forge-peer/release-manifest/v1\0` followed by
canonical manifest JSON. The signed identity is fixed to:

- repository `https://github.com/albertbuchard/forge`;
- package `forge-peer`;
- protocol `forge-peer/1`;
- a SemVer version, release target, validity window, external key ID, and uniquely
  sorted artifact list.

The trusted keyring is supplied separately and contains validity/revocation state;
the manifest cannot introduce its own trust key. Bundle verification rejects path
traversal, symlinks, special files, missing or extra files, size/hash changes, and
executable-mode changes. The CLI additionally refuses a keyring located inside the
untrusted bundle:

```sh
cargo run --bin forge-peer -- verify-manifest \
  --signed-manifest /trusted-input/release-manifest.json \
  --trusted-keys /platform-trust/forge-peer-keys.json \
  --bundle /staging/forge-peer-release
```

This package does not ship a production release public key or an installer. Those
must be provisioned by the release owner and integrated only after signature and
exact-bundle verification succeeds.

## Development

```sh
cargo fmt --all -- --check
cargo check --all-targets
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-targets -- --nocapture
cargo test --doc
cargo build --release --all-targets
sh scripts/audit.sh
cargo deny check advisories licenses sources bans
cargo deny --manifest-path fuzz/Cargo.toml --config deny.toml --all-features --locked check advisories licenses sources bans
cargo check --manifest-path fuzz/Cargo.toml --bins --locked
```

Fuzz targets are under `fuzz/`:

```sh
cargo fuzz run frame_decode
cargo fuzz run endpoint_validation
```

## Remaining integration boundaries

- The Forge API owns its SQL transaction and command-intent journal. Its adapter must
  persist local identity before invitation creation, issue the exact signed command
  authorization above, dispatch the stable `commandId`, atomically apply the Rust
  result, and mark that command applied. The package integration test launches the
  production Rust binary through the current Node supervisor/gateway, but Rust does
  not and must not write Forge SQL tables.
- Query transport and durable claim/respond are operational. This package
  intentionally has no access to the Forge content database; a Node source worker
  must evaluate the fixed, already-attenuated claim and submit only the strict
  `{records:[{recordId,fields}]}` result. The daemon returns authenticated
  `unavailable` after a bounded remote exchange when that worker does not answer.
- A complete Node adapter must expose `rotate_host_credential`,
  `claim_inbound_query`, `respond_inbound_query`, `list_revocation_events`, and
  `ack_revocation_events`. It should also pass its journaled `commandId` to
  `sync_command_authorization_state`; omission remains compatible through the
  signed-state-derived deterministic receipt key.
- Command receipts and inbound packet receipts are hard bounded and never evicted
  implicitly. Coordinated compaction requires the external Forge command journal to
  prove which replay keys remain live; no unsafe local command guesses that state.
- Platform secure hardware is not selected for the independent anti-rollback
  checkpoint or root identity wrapping key. Owner-only encrypted atomic files catch
  corruption and partial rollback, but cannot detect restoration of the entire
  state directory to one internally consistent old image.
- Tor supervision is tested with a deterministic local process/SOCKS/onion harness,
  including crash, identity continuity, restart, delivery, and shutdown. No live
  public Tor-network bootstrap was available in the test environment, so public
  reachability and censorship behavior remain deployment gates.
- Mailbox parity is tested against the real local connectivity-service executable
  through an exclusive-CA TLS harness with two production daemons. No public mailbox
  deployment, public certificate chain, or paid relay was exercised.
- Bincode 2 is unmaintained but not vulnerable. It remains the versioned signed and
  durable encoding through daemon state v9; replacing it without a dual-codec
  migration would break certificates, peer frames, and crash recovery. `deny.toml`
  documents this exception, while every decode remains typed, size-bounded, and
  trailing-byte rejecting. The RustCrypto OpenMLS chain also has one unmaintained
  compile-time proc macro. `scripts/audit.sh` proves the vulnerable optional libcrux
  AEAD backend is absent before applying Cargo Audit's lockfile-only exception.
- Release verification has no pinned production key until the release owner provides
  one through an external trusted-key distribution path.

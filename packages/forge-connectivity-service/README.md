# Forge Connectivity Service

`forge-connectivity-service` is a separately deployable reference mailbox for independently operated Forge peers. It relays bounded end-to-end ciphertext and minimum routing metadata. It has no dependency on a Forge database and exposes no administrative content-reading API.

The HTTP boundary rejects Forge bearer tokens, cookies, every `x-forge-*` header, duplicate security/framing headers, conflicting HTTP body framing, non-JSON body media types, request bodies on bodyless routes, and undeclared query parameters. Signed JSON types are validated without coercion. No request schema accepts grants, projections, contact data, Forge records, or plaintext-content fields. The only payload-bearing field is bounded base64url `ciphertext`; clients must encrypt it before transmission because a content-blind provider cannot distinguish ciphertext from attacker-supplied bytes.

## Contract

The service implements `forge-connectivity/1` through these routes:

| Method                   | Path                                | Purpose                                                            |
| ------------------------ | ----------------------------------- | ------------------------------------------------------------------ |
| `GET`                    | `/.well-known/forge-connectivity`   | Provider discovery, auth contract, capabilities, and public limits |
| `PUT` / `GET` / `DELETE` | `/v1/presence/{opaqueChannel}`      | Bounded encrypted presence descriptor                              |
| `POST` / `GET`           | `/v1/envelopes/{opaqueChannel}`     | Idempotent envelope write and cursor/long-poll read                |
| `POST`                   | `/v1/envelopes/{opaqueChannel}/ack` | Acknowledge envelopes and erase stored ciphertext                  |
| `PUT` / `GET`            | `/v1/key-packages/{opaqueChannel}`  | Bounded encrypted key-package delivery                             |
| `GET`                    | `/healthz`                          | Process and SQLite readiness only                                  |

The checked OpenAPI 3.1 document is [openapi/openapi.json](openapi/openapi.json).

## Authorization

Every channel route requires an Ed25519 possession proof:

```text
Authorization: ForgeChannel v1.<spki-base64url>.<unix-seconds>.<nonce-base64url>.<signature-base64url>
```

The opaque channel is derived from the authorization public key. The signature binds the method, sorted request target, timestamp, nonce, canonical JSON body digest, and `Idempotency-Key`. The SQLite adapter stores a second-order channel hash and a nonce hash, never the channel authorization private key, raw authorization header, or Forge token. Mutations require a fresh request nonce plus a stable 16-128 character base64url `Idempotency-Key` for safe retries, and successful mutation responses report `Idempotency-Replayed: true|false`.

The package exports `createChannelAuthorization` and `deriveOpaqueChannel` so clients and tests use the same canonicalization contract. [docs/protocol.md](docs/protocol.md) specifies the byte-level derivation, canonical request payload, mutation semantics, and cursor behavior.

## Run Locally

Node 24 and npm 11 are required because the service uses the production `node:sqlite` API.

```bash
npm ci --ignore-scripts
npm run verify
npm run build
FORGE_CONNECTIVITY_DATABASE_PATH="$PWD/data/connectivity.sqlite" npm start
```

The default bind address is `127.0.0.1:8787`. Public deployments must terminate HTTPS at a hardened reverse proxy; the application does not silently trust proxy headers or log source IP addresses.

Configuration, container deployment, backup, and reverse-proxy guidance are in [docs/self-hosting.md](docs/self-hosting.md) and [docs/hardening.md](docs/hardening.md). Security boundaries and residual metadata are in [docs/threat-model.md](docs/threat-model.md).

## Verification

```bash
npm run verify
npm run audit
npm run --silent sbom > forge-connectivity-service-0.1.0.cdx.json
```

`verify` runs formatting, lint, typecheck, unit/integration/upgrade/abuse/load tests, build, OpenAPI drift, container policy, dependency-license checks, an application-classified CycloneDX SBOM check, and release-metadata drift checks. The abuse suite deterministically encrypts sensitive fixtures, then proves the fixtures are absent from SQLite, WAL, responses, and captured logs.

The reproducible pack, clean-install, container-label, SBOM, provenance, and publication contract is in [docs/releasing.md](docs/releasing.md).

# Self-Hosting

## Runtime Shape

Run one service process against one local SQLite database on durable storage. The reference adapter uses WAL, `synchronous=FULL`, foreign keys, secure deletion, a busy timeout, transactional schema migrations, and trigger-maintained quota counters. It is a single-node deployment, not a shared-filesystem or multi-writer cluster.

The process defaults to loopback. A public service needs HTTPS termination in front of port `8787`. Do not expose the application port directly to the internet without TLS and request-size enforcement at the edge.

## Container

```bash
docker build \
  --build-arg SERVICE_VERSION=0.1.4 \
  --build-arg VCS_REF="$(git rev-parse HEAD)" \
  --build-arg BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -t forge-connectivity-service:0.1.4 .
docker run --rm \
  --name forge-connectivity \
  -p 127.0.0.1:8787:8787 \
  -v forge-connectivity-data:/data \
  forge-connectivity-service:0.1.4
```

The image uses the immutable digest recorded in `Dockerfile`, runs as the unprivileged `node` user, keeps application files root-owned, declares `/data` as its only persistent volume, and checks `/healthz`. Put Caddy, nginx, HAProxy, or an equivalent TLS proxy in front. Disable request-body and query logging there. If source-network logs are operationally required, use explicit short retention and access controls; the application itself does not record IP addresses.

## Configuration

Configuration is environment-only and validated before the listener starts. Unknown `FORGE_CONNECTIVITY_*` variables fail startup so misspelled limits do not silently use defaults.

| Variable                                                 |                      Default | Role                                    |
| -------------------------------------------------------- | ---------------------------: | --------------------------------------- |
| `FORGE_CONNECTIVITY_HOST`                                |                  `127.0.0.1` | Bind host; container sets `0.0.0.0`     |
| `FORGE_CONNECTIVITY_PORT`                                |                       `8787` | HTTP listener                           |
| `FORGE_CONNECTIVITY_DATABASE_PATH`                       | `./data/connectivity.sqlite` | SQLite file                             |
| `FORGE_CONNECTIVITY_REQUEST_BODY_LIMIT_BYTES`            |                     `400000` | Parsed HTTP body ceiling                |
| `FORGE_CONNECTIVITY_MAX_PRESENCE_BYTES`                  |                      `16384` | Decoded presence ciphertext ceiling     |
| `FORGE_CONNECTIVITY_MAX_ENVELOPE_BYTES`                  |                     `262144` | Decoded envelope ciphertext ceiling     |
| `FORGE_CONNECTIVITY_MAX_KEY_PACKAGE_BYTES`               |                      `65536` | Decoded key-package ciphertext ceiling  |
| `FORGE_CONNECTIVITY_MAX_CHANNEL_ENVELOPE_COUNT`          |                       `1000` | Pending envelope count quota            |
| `FORGE_CONNECTIVITY_MAX_CHANNEL_ENVELOPE_BYTES`          |                   `67108864` | Pending envelope byte quota             |
| `FORGE_CONNECTIVITY_MAX_CHANNEL_RETAINED_ENVELOPE_COUNT` |                     `100000` | Pending plus replay-tombstone quota     |
| `FORGE_CONNECTIVITY_MAX_CHANNEL_IDEMPOTENCY_RECORDS`     |                     `100000` | Mutation retry-record quota             |
| `FORGE_CONNECTIVITY_MAX_CHANNEL_NONCE_RECORDS`           |                      `10000` | Per-channel signed-request nonce quota  |
| `FORGE_CONNECTIVITY_MAX_GLOBAL_BYTES`                    |                 `1073741824` | Total live ciphertext quota             |
| `FORGE_CONNECTIVITY_MAX_GLOBAL_PRESENCE_COUNT`           |                     `100000` | Service-wide presence-row quota         |
| `FORGE_CONNECTIVITY_MAX_GLOBAL_KEY_PACKAGE_COUNT`        |                     `500000` | Service-wide key-package-row quota      |
| `FORGE_CONNECTIVITY_MAX_GLOBAL_RETAINED_ENVELOPE_COUNT`  |                    `2000000` | Service-wide retained-envelope quota    |
| `FORGE_CONNECTIVITY_MAX_GLOBAL_IDEMPOTENCY_RECORDS`      |                    `2000000` | Service-wide retry-record quota         |
| `FORGE_CONNECTIVITY_MAX_GLOBAL_NONCE_RECORDS`            |                     `100000` | Service-wide signed-request nonce quota |
| `FORGE_CONNECTIVITY_GLOBAL_REQUESTS_PER_MINUTE`          |                       `6000` | Process-wide token bucket, not IP keyed |
| `FORGE_CONNECTIVITY_GLOBAL_BURST_REQUESTS`               |                        `100` | Process-wide immediate request burst    |
| `FORGE_CONNECTIVITY_CHANNEL_REQUESTS_PER_MINUTE`         |                        `600` | Authenticated channel token bucket      |
| `FORGE_CONNECTIVITY_CHANNEL_BURST_REQUESTS`              |                         `30` | Per-channel immediate request burst     |
| `FORGE_CONNECTIVITY_MAX_LONG_POLL_SECONDS`               |                         `25` | Long-poll ceiling                       |
| `FORGE_CONNECTIVITY_MAX_GLOBAL_LONG_POLLS`               |                        `256` | Process concurrent-poll ceiling         |
| `FORGE_CONNECTIVITY_MAX_CHANNEL_LONG_POLLS`              |                          `2` | Channel concurrent-poll ceiling         |
| `FORGE_CONNECTIVITY_LOG_LEVEL`                           |                       `info` | `silent`, `info`, `warn`, or `error`    |

TTL, replay, idempotency, cleanup, key-package quota, and busy-timeout settings use the same prefix and are enumerated in `src/config.ts`. A configured database's existing parent directory must already be private (`0700`), must not be a symlink, and is never chmodded by the service; a missing dedicated directory is created privately. Discovery publishes only client-relevant size, TTL, burst, page, and polling limits.

## Backups

SQLite WAL means copying only the main file while the service is active is unsafe. Use one of these procedures:

1. Stop the container or service cleanly, wait for shutdown to checkpoint WAL, then copy `connectivity.sqlite`.
2. While the service runs, use a SQLite-aware online backup tool against the database path and verify the resulting copy with `PRAGMA quick_check`.

Protect backups as service metadata. They contain ciphertext, channel hashes, message/package identifiers, timestamps, sizes, states, and request/idempotency hashes. They do not contain Forge records or decryption keys, but the metadata still reveals traffic patterns. Test restore into an isolated process before relying on a backup.

## Operational Metrics

`/healthz` reports only service version, storage readiness, and schema version. It is isolated from regular-traffic token exhaustion so orchestrator readiness remains stable; restrict it to local monitors at the proxy because it is not an application admission endpoint. Use host/container CPU, memory, filesystem capacity, restart count, and healthcheck status for monitoring. If a reverse proxy exports HTTP metrics, aggregate by route template and status class; do not label metrics with channels, authorization values, message IDs, source addresses, or request sizes. There is deliberately no mailbox-count or channel-cardinality metrics endpoint.

# Deployment Hardening

1. Terminate TLS 1.3 or a currently supported TLS 1.2 profile at a maintained reverse proxy. Redirect or reject plaintext public traffic.
2. Keep the application port private. Permit only the proxy and local health monitor to reach it, and do not publish `/healthz` through the public proxy.
3. Run the process as an unprivileged user with a read-only application filesystem and a dedicated writable database directory set to mode `0700`.
4. Keep `trustProxy` disabled in the application. Configure source-address policy at the edge without forwarding or logging address headers unless there is a documented operational need.
5. Apply an edge body ceiling no larger than `FORGE_CONNECTIVITY_REQUEST_BODY_LIMIT_BYTES`; do not enable request decompression or ambiguous request framing. The application rejects duplicate security/framing headers, conflicting framing, non-JSON body media types, and non-identity `Content-Encoding`.
6. Disable request body, query, `Authorization`, cookie, and path-parameter logging. The application logger emits only route templates, status classes, duration buckets, fixed event names, and fixed error codes.
7. Preserve per-channel and global rate limits, quota limits, long-poll concurrency limits, and short TTLs. Raising all limits together removes the service's principal denial-of-service controls.
8. Put the data volume on encrypted storage. Keep backups encrypted and access-controlled even though mailbox payloads are end-to-end ciphertext.
9. Run `npm audit --omit=dev --audit-level=high`, `npm run license:check`, and `npm run sbom:check` for each build. Export the CycloneDX application SBOM with `npm run --silent sbom`. Build with `npm ci --ignore-scripts` from the committed package lock.
10. Build from the immutable image digest in `Dockerfile`, set OCI version/revision/date build arguments, generate registry SBOM and provenance attestations, and run the final image with a read-only root filesystem when the runtime supports it.
11. Upgrade from a tested backup, verify `/healthz`, and retain the prior image until the schema and route smoke tests pass.

## Reverse-Proxy Headers

The proxy should set HSTS on the public HTTPS origin, `X-Content-Type-Options: nosniff`, and a conservative request timeout slightly above the advertised long-poll maximum. Do not cache protected routes. The application itself sets `Cache-Control: no-store` everywhere except the public well-known document.

Do not enable browser CORS for arbitrary origins. Forge peer clients are server/native clients and do not need cross-origin browser credentials.

## Secret Handling

Channel authorization private keys belong to peer clients. Never put them in service configuration, container environment, reverse-proxy config, support bundles, or the SQLite database. Rotate an opaque channel by creating a new authorization key and distributing it through the end-to-end peer protocol; the service has no identity or account recovery authority.

There are no Forge bearer tokens, operator sessions, cookies, admin credentials, or decryption keys in this service. The HTTP layer rejects bearer credentials, cookies, and all `x-forge-*` headers rather than ignoring them. Adding any such path changes the trust model and requires a new protocol/security review.

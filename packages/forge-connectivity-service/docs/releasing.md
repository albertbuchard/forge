# Release Contract

## Package

Use Node 24 and the npm 11 version pinned by `packageManager`. Start from a clean checkout and the committed lockfile. `release:check` requires lockfile version 3, SHA-512 integrity, HTTPS npm-registry sources, and no link dependencies for every locked package:

```bash
npm ci --ignore-scripts
npm run verify
npm run audit
npm audit --audit-level=high
npm pack --dry-run
npm pack
```

Install the resulting tarball into an empty directory with `npm install --ignore-scripts <tarball>`, import its public exports, start its installed CLI against a new private data directory, and run the packed `scripts/healthcheck.mjs`. Publish only when package, lockfile, runtime, OpenAPI, and container versions agree. `publishConfig.provenance` is required; do not disable provenance to work around a release failure.

The npm archive and source-container context are separate release artifacts. npm does not publish `package-lock.json`, so the source-building Dockerfile is deliberately excluded from the npm archive. Build the container from the tagged source checkout or source archive, where the committed lockfile, `.dockerignore`, TypeScript source, and build configuration are present.

## SBOM

Export the production dependency graph as a CycloneDX 1.5 application document:

```bash
npm run sbom:check
npm run --silent sbom > forge-connectivity-service-0.1.2.cdx.json
```

Attach the SBOM to the release and retain its digest with the package and image digests. Do not commit generated release artifacts to this package.

The canonical public release is triggered by `connectivity-v<version>` through
`.github/workflows/release-connectivity-service.yml`. The workflow publishes the
npm-compatible archive as a GitHub release asset, so installing the service does
not depend on the npm registry. It signs every release file with a keyless Sigstore
certificate and publishes GitHub provenance and an SBOM attestation.

## Container

The default Node image is pinned by patch tag and manifest digest. Update both intentionally after reviewing an official Node image release; never replace the digest with a mutable tag-only reference.

```bash
docker buildx build \
  --build-arg SERVICE_VERSION=0.1.2 \
  --build-arg VCS_REF="$(git rev-parse HEAD)" \
  --build-arg BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --sbom=true \
  --provenance=true \
  -t registry.example/forge-connectivity-service:0.1.2 .
```

Inspect the final image configuration and attestations before publishing. Required properties are the unprivileged `node` user, root-owned application files, `/data` as the only writable persistent path, `SIGTERM`, the `/healthz` check, exec-form command, and OCI source/version/revision/date/base-image labels. Run the image with a read-only root filesystem and a writable `/data` volume where supported.

The public image is
`ghcr.io/albertbuchard/forge-connectivity-service:<version>` for `linux/amd64`
and `linux/arm64`. Deploy by digest, verify the workflow identity in its Cosign
signature, and verify the GitHub attestation before first use.

## Release Smoke

Against the candidate package and image, verify discovery, health/readiness, a signed presence lifecycle, concurrent idempotent envelope retries, envelope read/ack, key-package delivery, nonce replay rejection, quota/rate rejection, and client-disconnect cleanup for long polls. Preserve the published package digest, image digest, SBOM digest, provenance record, and test result in the release system.

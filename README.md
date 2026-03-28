# Forge

Forge is the actual web app and API runtime for the life operating system under `projects/forge`.

It is meant to run:
- locally in the browser
- over Tailscale in the browser
- through OpenClaw when you want agent access

## Run Forge

### One-step app run

This is the main end-user path. It builds the web app and serves the full Forge runtime on port `4317`.

```bash
npm install
npm run start
```

Then open:

- local: [http://127.0.0.1:4317/forge/](http://127.0.0.1:4317/forge/)
- Tailscale: `http://<your-device>.ts.net:4317/forge/`

Forge health is available at:

- [http://127.0.0.1:4317/api/v1/health](http://127.0.0.1:4317/api/v1/health)

### Development mode

The simple path is:

```bash
npm run dev
```

That starts both:

- the backend/runtime on `127.0.0.1:4317`
- the live Vite frontend on `127.0.0.1:3027`

If you want to run them separately, you still can:

```bash
npm run dev:server
npm run dev:web
```

Then open:

- Vite dev app: [http://127.0.0.1:3027](http://127.0.0.1:3027)
- runtime API: [http://127.0.0.1:4317/api/v1/health](http://127.0.0.1:4317/api/v1/health)

### Choose a data folder

Forge can use a custom data root instead of the current working directory.

Run Forge against an explicit data folder like this:

```bash
FORGE_DATA_ROOT=/absolute/path/to/forge-data npm run dev
```

Or for the production-style local runtime:

```bash
FORGE_DATA_ROOT=/absolute/path/to/forge-data npm run start
```

Forge will then read and write its SQLite files under:

```text
$FORGE_DATA_ROOT/data/forge.sqlite
```

## Local and Tailscale access

Forge is intended to be usable directly in the browser, not only through OpenClaw.

Default runtime posture:
- listens on `0.0.0.0`
- serves the built browser app under `/forge/`
- allows trusted local operator-session bootstrap from:
  - `localhost`
  - `127.0.0.1`
  - `*.ts.net`
  - Tailscale `100.64.0.0/10`

That means local and Tailscale users can open the browser app directly and use Forge without creating a token first.

## Security modes

Forge supports two main connection modes:

### 1. Quick connect

Recommended for:
- localhost
- Tailscale

Behavior:
- no token required up front
- Forge issues a local operator session cookie
- the browser app and OpenClaw can both use that operator session on trusted local networks

### 2. Managed token

Recommended for:
- explicit scoped agent credentials
- remote non-Tailscale access
- long-lived agent identities with separate provenance

Behavior:
- token is generated once
- Forge stores only the hash and prefix
- the raw token is shown once and cannot be recovered later

## Recovery and reset

### If you lose a token

Do not try to recover the old raw token. Forge does not store it in recoverable form.

Instead:

1. Open Forge in the browser locally or over Tailscale.
2. Go to `Settings` -> `Collaboration Settings`.
3. Either:
   - rotate the existing token and reveal a new raw token once
   - or issue a new token and migrate integrations to it
4. Update OpenClaw or any other agent config.
5. Revoke stale credentials after cutover.

### If you want to reset local access

Forge operator sessions can be reset from the same settings screen with `Reset operator session`.

That clears the current operator-session cookie so you can bootstrap a fresh one.

## OpenClaw

OpenClaw now has two supported install paths:

- local development from this repo: `openclaw plugins install ./projects/forge/openclaw-plugin`
- published package install: `openclaw plugins install forge-openclaw-plugin`

For local/Tailscale development:

```bash
openclaw plugins install ./projects/forge/openclaw-plugin
openclaw gateway restart
```

If Forge is local or on Tailscale, `apiToken` can stay blank and the plugin will bootstrap an operator session automatically.

See:
- [`docs/openclaw-plugin.md`](docs/openclaw-plugin.md)
- [`docs/openclaw-plugin-release-checklist.md`](docs/openclaw-plugin-release-checklist.md)
- [`docs/public-repo-workflow.md`](docs/public-repo-workflow.md)

## Product URLs

The important URLs are:

- web app: `/forge/`
- API health: `/api/v1/health`
- OpenAPI: `/api/v1/openapi.json`
- settings: `/api/v1/settings`
- operator-session bootstrap: `/api/v1/auth/operator-session`

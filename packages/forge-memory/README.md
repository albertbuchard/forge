# forge-memory

Preferred Forge installer:

```bash
npx forge-memory
```

Development install from a Forge checkout:

```bash
npx forge-memory --dev
```

This package installs and manages the local Forge UI/runtime, then configures detected host adapters for OpenClaw, Hermes, and Codex. The Forge UI/runtime is always the base install; the adapter checkbox list only contains host integrations.

Useful commands:

```bash
npx forge-memory configure
npx forge-memory status
npx forge-memory doctor
npx forge-memory ui
npx forge-memory restart
npx forge-memory pair-ios
```

`configure` reruns the full guided flow using the current config as defaults.

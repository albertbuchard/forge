# Forge Documentation

This directory separates current references from preserved planning history.

## Current References

- [Companion Iroh transport](./reference/companion-iroh.md): iOS pairing, Iroh, manual HTTP, and phone-safe URLs.
- [OpenClaw plugin](./reference/openclaw-plugin.md): advanced OpenClaw adapter setup and runtime behavior.
- [Hermes plugin](./reference/hermes-plugin.md): advanced Hermes adapter setup and release notes.
- [Codex MCP](../plugins/forge-codex/README.md): Codex adapter setup and MCP bridge behavior.
- [Calendar provider setup](./reference/calendar-provider-setup.md): Google Calendar and OAuth configuration.
- [Multi-user and strategies](./reference/multi-user-and-strategies.md): shared runtime, identity, and strategy model notes.
- [Preferences system](./reference/preferences-system.md): preference storage and agent-facing preference behavior.
- [Public repo workflow](./reference/public-repo-workflow.md): public repository and publication workflow.

## Release References

- [Release cheat sheet](./release/release-cheat-sheet.md): tag-driven plugin, package, and iOS release flow.
- [OpenClaw plugin release checklist](./release/openclaw-plugin-release-checklist.md): OpenClaw-specific release guardrails.

## Internal History

- [Internal docs](./internal/README.md): preserved goals, audits, handoffs, and release-history summaries.

Internal files are useful context for agents and maintainers, but they are not the first source of truth for users. When a behavior becomes current product or setup guidance, promote it into `reference/`, `release/`, the root `README.md`, or the relevant package README.

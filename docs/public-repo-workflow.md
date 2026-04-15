# Forge Public Repo Workflow

`projects/forge` is intended to stay inside the private monorepo while also being managed as its own public Git repository.

## Working model

- The private monorepo remains the umbrella workspace.
- `projects/forge` is a nested public repo with its own remote, tags, releases, and CI.
- Public plugin release work happens inside Forge without moving it out of the monorepo.

## Practical rules

1. Commit Forge changes from inside `projects/forge` when they belong in the public repo.
2. Do not assume the parent monorepo remote or history is available to public CI.
3. Keep public docs, manifests, and package metadata self-contained inside Forge.
4. Keep release scripts, workflow files, and plugin packaging inside Forge.
5. Do not let private parent-monorepo paths become required for the published plugin artifact.
6. Forge's default operating workflow is direct work on `main`, not mandatory feature branches or pull requests.
7. Public docs and agent skills must reflect Forge's explicit planning hierarchy:
   `Goal -> Strategy -> Project -> Strategy -> Issue -> Task -> Subtask`.
8. Public docs and agent skills must also reflect the current PM interaction model:
   one mixed board for `project | issue | task | subtask`, one compact hierarchy
   surface, shared search/filtering, hierarchy-aware linking flows, shared
   `executionMode` + `acceptanceCriteria` support for issues and tasks, and
   `completionReport = { modifiedFiles[], workSummary, linkedGitRefIds[] }`.

## Public release boundary

The publishable OpenClaw package lives in:

- [`openclaw-plugin`](../openclaw-plugin)

The full Forge app can stay private or semi-private operationally, but the plugin package, manifest, docs, and skill must be publishable on their own.

# Workbench

Workbench stores reusable graph flows and exposes the Forge node boxes that can be used inside those flows. It is a dedicated API family under `/api/v1/workbench`; it is not a shared batch-CRUD entity.

## Catalog view

The Workbench page has two catalogs:

- **Flows** lists saved custom flows as compact summaries. A summary includes title, description, kind, home surface, node and edge counts, public input and published output counts, endpoint state, and the latest run state. It does not include the graph, prompts, run payloads, or full execution history.
- **Node boxes** lists built-in Forge boxes and the published outputs of saved flows. Every returned box keeps its typed input, parameter, output, and tool contract, but the collection itself is paged.

Only the active catalog is requested. Search terms and selected facets are stored in the page URL, so refresh and browser navigation preserve the current view. Loaded pages remain visible while filters refresh or a later page is retried.

`endpointEnabled` describes whether a saved flow's callable endpoint is enabled. Disabled flows remain discoverable and can still be opened for inspection or editing. Workbench does not currently define an archived flow state.

## Flow catalog API

`GET /api/v1/workbench/flows` returns a `WorkbenchFlowCatalogPage`:

- `flows`: compact flow summaries
- `total`: number of summaries matching the current query
- `limit` and `offset`: the current page window
- `hasMore`: whether another page exists
- `facets`: full-catalog kind, home-surface, and endpoint-state counts

Supported query parameters:

- `q`: title, description, slug, kind, home surface, or node-label search; maximum 200 characters
- repeated `kind`: `functor` or `chat`
- repeated `homeSurfaceId`
- repeated `status`: `enabled` or `disabled`
- `limit`: 1 to 100, default 24
- `offset`: zero or greater, default 0

Continue only while `hasMore` is true. The next offset is the current offset plus the number of returned flows. Use `GET /api/v1/workbench/flows/:id` after selecting one exact flow and needing its graph, public contract, or bounded run history.

## Box catalog API

`GET /api/v1/workbench/catalog/boxes` returns a `WorkbenchBoxCatalogPage` with `boxes`, `total`, `limit`, `offset`, `hasMore`, and category, surface, and source facets.

Supported query parameters:

- `q`: title, description, category, route, tag, port, or tool search; maximum 200 characters
- repeated `category`
- repeated `surfaceId`
- repeated `source`: `forge` or `flow_output`
- `limit`: 1 to 100, default 24
- `offset`: zero or greater, default 0

Built-in boxes use source `forge`. A published saved-flow output uses source `flow_output` and includes `sourceFlowId` plus `sourceFlowEnabled`.

## Run control and recovery

Saved-flow execution, one-off execution, and saved-flow chat all accept `timeoutMs`. The API accepts 1,000 to 900,000 milliseconds and stores a 300,000-millisecond deadline when the field is omitted. The Workbench run dialog offers one-, five-, and fifteen-minute choices. The deadline covers the whole flow, not each node separately.

While a run is active, a human operator or an authorized executor agent can call `POST /api/v1/workbench/flows/:id/runs/:runId/cancel`. The first accepted cancellation atomically records a `cancelled` terminal receipt with its request time, authenticated actor, source, and optional reason. Repeating the same cancellation returns that immutable receipt with `Idempotency-Replayed: true`; a different terminal outcome returns a conflict instead of rewriting history. A deadline produces `timed_out` without claiming that a human or agent cancelled the run.

Forge propagates one cancellation signal through node evaluation, model-provider network requests, local machine commands, and installed remote execution workers. Already completed node results are stored as each node finishes, so cancellation, timeout, or a later node failure does not erase useful evidence. A process or external worker that cannot stop synchronously is still prevented from committing a successful run after Forge has recorded cancellation or timeout.

`cancelled` and `timed_out` runs can be retried from their stored input. Exact idempotent replay returns the original terminal receipt. Reusing an idempotency key with a changed payload or deadline is rejected. Use the run-detail and run-node reads to distinguish completed work from the node where execution stopped.

## Agent access

OpenClaw, Hermes, Codex, and MCP clients use `forge_call_workbench_route`. Use `listFlows` or `boxCatalog` for discovery, `runFlow`, `runByPayload`, or `chatFlow` for execution, `cancelRun` to stop one exact active run, and the run-detail or run-node keys for read-back. Put catalog filters in `query`. Start with `limit: 24`, follow `hasMore`, and use the returned item count to advance `offset`.

Do not send `includeArchived`; that is not part of the Workbench contract. Use `status: "enabled"` or `status: "disabled"` for flow endpoint state. Catalog reads require Forge read access. Create, update, delete, execute, and chat routes require the corresponding write authority.

Legacy AI processors are reconciled during server startup. Catalog and detail GET requests do not perform that migration.

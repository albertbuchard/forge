# KarpaWiki

KarpaWiki stores durable wiki and evidence documents in Forge's SQLite database. A
page detail contains the complete Markdown document, backlinks, Forge entity links,
and attached-asset metadata. Browse and search responses use compact page summaries
so large document bodies do not make catalog requests unstable.

## Browse

The web app opens one readable wiki space at a time. On phones, the page index is
collapsed by default so the document remains the primary content. On larger screens,
the index stays beside the document. The index is capped at 500 pages; search remains
available for pages beyond that bound. With one user selected in the Forge shell, that
user's personal wiki opens first and the picker contains shared spaces plus personal
spaces owned by the selected user scope. The API remains the authorization boundary.

`GET /api/v1/wiki/pages` accepts:

- `spaceId`: optional readable space identifier
- `kind`: `wiki` or `evidence`
- `limit`: 1 to 500, default 50
- `offset`: 0 to 9,999, default 0
- `includeHidden`: `true` or `false`, default `false`

The response includes `pages`, `limit`, `offset`, `hasMore`, and `nextOffset`. Each
page is a compact summary. Use `GET /api/v1/wiki/pages/:id` or
`GET /api/v1/wiki/by-slug/:slug` for the full document.

Hidden pages are omitted unless `includeHidden=true`. Soft-deleted pages and pages whose
`destroyAt` time has passed are excluded from browse, tree, search, direct id reads, slug
reads, and backlinks. A backlink exposes source metadata only when its source page is
active and belongs to the same wiki space as the target page.

## Links And Relationships

Wiki page detail reads return the complete document plus a bounded relationship view:

- `outboundLinks`: Markdown wiki and `forge:` links with their stored label, raw target,
  embed flag, availability status, compact target page when available, and self-link flag
- `outboundLinkLimit`: currently 500
- `outboundLinksTruncated`: `true` when additional Markdown links are not classified
- `backlinks`: distinct backlink citations from active pages in the same space
- `backlinkLimit`: currently 100
- `backlinksTruncated`: `true` when additional backlink citations are omitted
- `backlinkSourceNotes`: compact source-page summaries without document bodies
- `backlinksBySourceId`: active source-page metadata keyed by source note ID

`available` wiki links use the target's canonical slug. `missing` means no active target
can be resolved in the current space. This intentionally does not distinguish an unknown
page from a target in another or inaccessible space. `unavailable` means a previously
resolved target is no longer active, including a soft-deleted target. Expired targets are
non-interactive; after the expiry purge removes the target and its foreign-key edge, the
link is reported as `missing`. The browser never turns these unavailable links into a
new-page action.

Link labels split at the first `|`, so labels may contain additional `|` characters.
Exact repeated links are indexed once, while distinct labels to the same target remain
separate citations. A self-link resolves normally but is not shown as its own backlink.
Two-page and larger cycles are supported. An unresolved edge is re-evaluated during a
detail read, so a link and its backlink become available when the same-space target is
created later without requiring a full vault sync.

General entity markup uses `[[forge:<entityType>:<entityId>|<label>]]`. Forge preserves
the supplied label and returns `unverified` because the generic wiki repository does not
claim entity existence or authorization. Navigable entity types open their established
Forge route, where normal entity authorization remains authoritative. On the web page,
goal, project, task, and strategy links absent from the selected-user snapshot are shown
as unavailable instead of linking outside the selected scope. Entity types without a
known route are also non-interactive.

Use `:::forge-links` for citations and general links and `:::forge-related` for related
pages. These render as labelled `Citations and links` and `Related pages` regions. Normal
HTTP and HTTPS citations open in a new tab and announce that behavior to assistive
technology. Unsupported URL schemes are not interactive.

Available links use native anchors or router links and remain keyboard focusable with a
visible focus indicator. Unavailable links are plain text with an explicit unavailable
description. Long titles, labels, and entity IDs wrap within the article at 390px; the
backlink grid stays one column until the wider breakpoint. On desktop it expands to two
columns. Relationship surfaces use the same semantic foreground, border, warning, and
surface tokens as the rest of Forge, and horizontal overflow is clipped at the article
boundary so link-state changes do not shift the reading layout.

## Search

`POST /api/v1/wiki/search` supports `text`, `entity`, `semantic`, and `hybrid`
modes. It accepts a query up to 500 characters, a 1 to 50 result `limit`, and an
`offset` up to 999. Full-text retrieval uses at most the first 20 alphanumeric query
tokens. Results include `matchKind` and a bounded `snippet`, plus `hasMore` and
`nextOffset` for pagination.

Text and hybrid ranking prioritize exact titles, exact aliases, exact slugs, title
prefixes and fragments, then weighted full-text matches in summaries and document
content. The direct-title channel applies those relevance tiers before its candidate
cap, so newer partial titles cannot displace an older exact title. Entity links and
optional embeddings add ranking signals. Hybrid mode returns text-ranked results with a
warning when semantic ranking is unavailable. Semantic-only mode returns no substituted
text results and explains unavailable profile or credential state in `warnings`; an
embedding-provider request failure remains an error.

Search work is bounded to a 1,000-page union and 5,000 embedding chunks per request.
Direct title/alias, entity, full-text, and semantic channels each receive reserved
candidate capacity before deterministic final ranking. The browser waits briefly after
typing, cancels superseded requests, does not retry failed searches automatically, and
fetches subsequent pages by offset. The web control offers text and hybrid modes, plus
semantic mode only when an embedding profile is enabled. Entity-only retrieval is
available through the API when a concrete `linkedEntity` is supplied. Initial and
subsequent-page failures keep explicit retry actions, and fallback warnings remain
visible even when the result set is empty.

## Access

Authenticated operator sessions can read and write shared and personal spaces. A token
with a non-empty `scopePolicy.userIds` can access shared spaces plus personal spaces
owned by those users. Forge checks both the current and destination spaces before page
moves. Inaccessible or unknown explicit space identifiers return `404`; Forge does not
reveal page titles, ingest source paths, job payloads, or substitute shared content.

Health checks require read access to the selected space. Sync and embedding maintenance
require write access; user-scoped tokens must select one accessible `spaceId` and cannot
run all-space maintenance. Ingest creation, listing, detail, rerun, resume, review, and
deletion use the same space policy. Job routes resolve the job's space before loading
its source metadata.

OpenClaw and Hermes expose `forge_list_wiki_pages`, `forge_search_wiki`, and
`forge_get_wiki_page` with the same limits. Search is a read-only POST and does not
require write authorization. Agents should browse or search compact summaries first,
then fetch full page detail only for selected documents.

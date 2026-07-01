# Artifact Store

Forge's Artifact Store is a specialized CRUD surface for trusted files. It stores file bytes locally as content-addressed blobs, records precise metadata, runs deterministic static safety scans, assigns a danger score, keeps versions and audit events, and makes the files available for human download from the web app. Humans may optionally password-encrypt stored bytes while keeping safe metadata searchable.

The store is deliberately not an execution surface. Forge agents may not download, decrypt, open, execute, preview, transform stored file bytes, or submit artifact passwords. Human operators can download artifacts through the web app or the human-only API routes.

## Supported Files

The first supported format families are:

- spreadsheets: `.xlsx`, `.xlsm`, `.csv`, `.tsv`
- documents: `.docx`
- presentations: `.pptx`
- PDFs: `.pdf`
- text and structured text: `.txt`, `.md`, `.json`, `.yaml`, `.yml`
- images: `.png`, `.jpg`, `.jpeg`, `.webp`

Files are stored under the Forge data root by SHA-256 content address. Metadata rows can be soft-deleted, restored, or hard-deleted through shared entity tooling, but hard-deleting metadata does not remove the content-addressed blob.

The web `Delete` action is a soft delete through shared entity CRUD. It moves the artifact metadata record to the Forge bin/archive, preserves the file bytes, and leaves restoration to the normal shared restore flow.

## Web Upload Workflow

The Artifact Store web page uses Forge's guided modal flow for creation. The page itself stays focused on artifact search, filtering, paged review, selected-artifact metadata, safety findings, generic entity links, versions, audit events, rescans, enrichment, safe metadata deletion/archive, and human downloads.

The `Add artifacts` action opens a modal with three stages:

- file selection: choose or drop one or more supported files
- file queue: review each selected file, add a quick short description, or open that file's details
- upload review: create one artifact per file and show per-file success or failure

The file selection stage includes an optional password-encryption choice. When enabled, one password is applied to the selected files for that upload batch, with an optional password hint saved as safe metadata. The password is submitted only in the human upload request and is not stored, logged, returned, or exposed to agents.

The per-file details view lets the human refine title, short description, long description, source kind, source/provenance label, optional metadata JSON, generic entity links, and whether a configured LLM should fill missing metadata. Saving details returns the human to the queue so several files can be finished deliberately before upload.

Image files use the same flow as documents and spreadsheets. Supported image uploads are `.png`, `.jpg`, `.jpeg`, and `.webp`.

## Artifact Metadata

Each artifact record is expected to carry enough information for future review without reopening the file:

- stable artifact id
- title
- short description
- long description
- original file name
- detected extension
- declared and detected MIME type
- content SHA-256
- byte size
- stored content SHA-256 and stored byte size, which differ from content SHA-256 and byte size when bytes are encrypted at rest
- content protection mode and safe encryption metadata
- storage key and storage path
- source kind and source label
- uploaded actor provenance
- artifact state
- download policy
- danger score and danger level
- scan results
- enrichment results
- arbitrary metadata
- generic entity links
- created and updated timestamps

## Safety Model

Upload is restricted to trusted actors:

- human operator sessions can upload through the web/API surface
- agent tokens must have artifact upload scopes and trusted or autonomous trust level
- standard agent tokens cannot upload file bytes

The static scanner is deterministic and conservative. It checks extension allowlists, file size, MIME mismatches, Office zip structure, macros, encryption, embedded objects, external relationships, hidden sheets, spreadsheet formulas, PDF JavaScript/actions/embedded files, CSV/TSV formula-like cells, and structured-text parse validity where applicable.

Optional LLM enrichment can fill missing title, description, source/provenance notes, structured metadata, and risk explanation when a configured Forge LLM profile exists. The LLM receives metadata, scanner findings, and bounded static text samples only. It may raise concern, but it must not lower the deterministic danger score.

## Password Encryption

Password-encrypted artifacts use Argon2id through libsodium password hashing to derive a per-artifact/per-version key from the transient human password. Each encrypted artifact records its own random salt and KDF parameters, with a minimum floor of 19 MiB memory, 2 iterations, and parallelism 1. File bytes are authenticated and encrypted with libsodium secretstream XChaCha20-Poly1305.

Forge stores ciphertext bytes under the normal dedicated Artifact Store blob routes. The artifact keeps the original plaintext content SHA-256 and byte size for identity and review, plus separate stored ciphertext SHA-256 and stored byte size for physical storage. Existing scan results, danger score, metadata, versions, audit events, and generic entity links are preserved when a plaintext artifact is encrypted later.

Artifact responses expose only safe content protection metadata:

- `mode`: `plaintext` or `password_encrypted`
- `encryptedAt`
- `algorithm`
- `kdf`
- `kdfParams`
- `passwordHint`

Responses never include plaintext passwords, derived keys, password verifiers, salts, secretstream headers, decrypted bytes, or password echoes. Passwords are accepted only in human/operator request bodies for encrypted upload, password download, and existing-artifact encryption. They are never accepted in URLs.

Encrypted artifacts preserve their prior deterministic scan and enrichment evidence. Rescan currently returns a clear encrypted-content error because Forge does not ask agents or background jobs for passwords. LLM enrichment for encrypted artifacts uses safe metadata and existing scanner findings only; it does not receive decrypted samples.

## Generic Links

Artifacts are normal linkable Forge entities. Relationships use the shared `entity_links` table and the reusable `EntityLink` / `EntityLinkInput` API schemas. Do not create an artifact-specific link entity.

For artifact route calls, the artifact is the source entity. Link inputs identify the target entity:

```json
{
  "links": [
    {
      "entityType": "wiki_page",
      "entityId": "wiki_budget_model",
      "relationship": "embedded_reference",
      "anchorKey": "budget-workbook"
    }
  ]
}
```

The returned artifact includes full source and target fields:

```json
{
  "sourceEntityType": "artifact",
  "sourceEntityId": "artifact_123",
  "targetEntityType": "wiki_page",
  "targetEntityId": "wiki_budget_model",
  "relationship": "embedded_reference",
  "anchorKey": "budget-workbook"
}
```

Wiki pages and other entity surfaces should embed or reference artifacts through normal Forge links to `/artifacts/:id` and through these generic entity links.

## API Routes

Artifact bytes and metadata use dedicated artifact routes:

- `GET /api/v1/artifacts`: list artifact metadata, scan state, danger score, and generic links with `limit`/`offset` pagination and `{ total, limit, offset, hasMore }` response metadata
- `POST /api/v1/artifacts`: upload trusted file bytes and create metadata, scan, version, and audit rows
- `GET /api/v1/artifacts/:id`: read one artifact metadata record
- `PATCH /api/v1/artifacts/:id`: patch artifact metadata only
- `POST /api/v1/artifacts/:id/links`: replace generic entity links for the artifact source entity
- `POST /api/v1/artifacts/:id/scan`: rerun the static scanner
- `POST /api/v1/artifacts/:id/enrich`: use a configured LLM profile to fill missing metadata
- `POST /api/v1/artifacts/:id/trust`: apply a trusted state override with an audit reason
- `GET /api/v1/artifacts/:id/versions`: list artifact versions
- `GET /api/v1/artifacts/:id/audit`: list artifact audit events
- `GET /api/v1/artifacts/:id/download`: download plaintext file bytes for a human operator session only; encrypted artifacts return `artifact_password_required`
- `POST /api/v1/artifacts/:id/download`: download encrypted file bytes after a human operator submits `{ "password": "..." }` in the request body
- `POST /api/v1/artifacts/:id/encrypt`: password-encrypt an existing plaintext artifact for a human operator session only

Shared batch CRUD can search, update, soft-delete, restore, and hard-delete artifact metadata. It must not create artifacts or expose file bytes.

## Agent And Plugin Contract

OpenAPI, OpenClaw, Hermes, Codex, and Claude Code must present the same boundary:

- artifact routes are specialized CRUD routes, not normal batch create routes
- `forge_call_artifact_route` handles trusted upload, metadata reads/patches, scans, enrichment, generic links, trust state, versions, and audit
- the agent tool surface must not expose artifact download, password download, decrypt, preview, open, execute, transform, or existing-artifact encryption password submission
- list calls should use `limit` and `offset`; agents and plugins should not bulk-load a large Artifact Store
- agents may read `contentProtection` mode and password hints as metadata, but must not receive, store, route, or submit artifact passwords
- agents must confirm they are not being asked to run, decrypt, open, preview, transform, or inspect file bytes autonomously
- when linking artifacts, agents should say they are writing general Forge entity links

The web app exposes the Artifact Store at `/forge/artifacts` and artifact detail routes at `/forge/artifacts/:id`.

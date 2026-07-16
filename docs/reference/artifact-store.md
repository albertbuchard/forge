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

Files are stored under the Forge data root by the SHA-256 of the bytes physically stored. For plaintext artifacts that is the plaintext hash; for encrypted artifacts it is the randomized ciphertext hash. Metadata rows can be soft-deleted, restored, or hard-deleted through shared entity tooling, but hard-deleting metadata does not remove stored file bytes.

The web `Delete` action is a soft delete through shared entity CRUD. It moves the artifact metadata record to the Forge bin/archive, preserves the file bytes, and leaves restoration to the normal shared restore flow.

## Web Upload Workflow

The Artifact Store web page uses Forge's guided modal flow for creation. The page itself stays focused on artifact search, filtering, paged review, selected-artifact metadata, safety findings, generic entity links, versions, audit events, rescans, enrichment, safe metadata deletion/archive, and human downloads.

The `Add artifacts` action opens a modal with three stages:

- file selection: choose or drop one or more supported non-empty files, up to 100 MiB each
- file queue: review up to 25 selected files, apply shared defaults, add quick descriptions, or open one file's details and return without losing the rest of the queue
- upload review: create one artifact per file with live progress, per-file or whole-queue cancellation, explicit retry, and independent success, failure, or canceled state

The queue runs at most two uploads concurrently so a large batch does not overwhelm the browser or server. Empty files and files larger than 100 MiB are rejected before the browser reads them. A partial failure does not roll back files that were already stored. Each queued file keeps one stable retry key for its lifetime in the modal, so retrying after a timeout or cancellation cannot silently create an extra artifact. Deliberately adding the same file again creates a separate artifact metadata record. Plaintext duplicates reuse the verified stored blob. Password-encrypted duplicates retain the same logical plaintext identity but store independent randomized ciphertext representations. The review step describes the applicable result rather than claiming all duplicates share one physical blob.

Bulk defaults cover short description, provenance/source label, source kind, and optional LLM enrichment. They apply only to unfinished files and remain editable per file. The source controls use a full-width phone-safe layout, all queue actions are native keyboard-operable controls, progress is exposed to assistive technology, reduced-motion preferences disable progress animation, and returning from a detail view restores focus to that file's `Details` button.

The file selection stage includes an optional password-encryption choice. When enabled, one password is applied to the selected files for that upload batch, with an optional password hint saved as safe metadata. The password is submitted only in the human upload request and is not stored, logged, returned, or exposed to agents. Closing the upload flow clears the in-memory password and queue draft.

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

Forge normalizes upload provenance from the authenticated actor. A human cannot claim `agent_upload` or an agent identity. An agent upload is recorded as `agent_upload`, cannot name a different agent, and cannot act for a user outside the token's allowed user scope.

The static scanner is deterministic and conservative. It checks extension allowlists, file size, MIME mismatches, Office zip structure, macros, encryption, embedded objects, external relationships, hidden sheets, spreadsheet formulas, PDF JavaScript/actions/embedded files, CSV/TSV formula-like cells, and structured-text parse validity where applicable.

Optional LLM enrichment can fill missing title, description, source/provenance notes, structured metadata, and risk explanation when a configured Forge LLM profile exists. For plaintext artifacts, the LLM receives metadata, scanner findings, and a bounded internal static text sample only after enrichment is requested. Artifact and version metadata responses never expose that sample. The LLM may raise concern, but it must not lower the deterministic danger score.

## Password Encryption

Password-encrypted artifacts use Argon2id through libsodium password hashing to derive a per-artifact/per-version key from the transient human password. Each encrypted artifact records its own random salt and KDF parameters, with a minimum floor of 19 MiB memory, 2 iterations, and parallelism 1. File bytes are authenticated and encrypted with libsodium secretstream XChaCha20-Poly1305.

Forge stores ciphertext bytes under the normal dedicated Artifact Store blob routes. The artifact keeps the original plaintext content SHA-256 and byte size for identity and review, plus separate stored ciphertext SHA-256 and stored byte size for physical storage. Existing scan results, danger score, metadata, versions, audit events, and generic entity links are preserved when a plaintext artifact is encrypted later.

### Logical And Physical Blob Identity

The frozen Artifact Store schema uses `artifact_blobs.content_sha256` as a logical plaintext-identity key. There is one `artifact_blobs` row for a plaintext SHA-256, even when several artifacts encrypt that plaintext independently. The row's `storage_key`, `stored_content_sha256`, `stored_byte_size`, and `content_protection_mode` describe the first canonical representation recorded for that logical identity; they are compatibility fields, not an exhaustive physical-storage registry.

The `artifacts` and `artifact_versions` rows are authoritative for physical coverage. Their `storage_key`, `stored_content_sha256`, `stored_byte_size`, and content-protection metadata identify the exact stored representation used by that artifact or version. Two encrypted artifacts created from identical plaintext therefore have the same `contentSha256`, one logical `artifact_blobs` identity row, and distinct randomized ciphertext hashes and storage keys. No schema change is required for this contract, and code must not use `artifact_blobs` row counts as physical blob counts.

Artifact responses expose only safe content protection metadata:

- `mode`: `plaintext` or `password_encrypted`
- `encryptedAt`
- `algorithm`
- `kdf`
- `kdfParams`
- `passwordHint`

Responses never include plaintext passwords, derived keys, password verifiers, salts, secretstream headers, decrypted bytes, or password echoes. Passwords are accepted only in human/operator request bodies for encrypted upload, password download, and existing-artifact encryption. They are never accepted in URLs.

Encrypted artifacts preserve deterministic scan findings, danger scores, and enrichment evidence, but Forge removes scanner-extracted plaintext samples from the artifact and version rows before committing encrypted storage. Rescan currently returns a clear encrypted-content error because Forge does not ask agents or background jobs for passwords. LLM enrichment for encrypted artifacts uses safe metadata and existing scanner findings only; it does not receive decrypted samples.

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

Artifact token scope is conjunctive. A scoped Artifact must be owned by an allowed user and, when project or tag scope is present, have at least one direct outgoing `entity_links` target in each allowed dimension and no direct project or tag target outside that dimension. The same check applies to dedicated reads and mutations, Life Event ticket import, download lookup, and shared batch search, update, delete, and restore. Link replacement validates project and tag targets before mutation and returns the same not-found posture for missing and out-of-scope targets.

## API Routes

Artifact bytes and metadata use dedicated artifact routes:

- `GET /api/v1/artifacts`: list artifact metadata, scan state, danger score, and generic links with `limit`/`offset` pagination and `{ total, limit, offset, hasMore }` response metadata
- `POST /api/v1/artifacts`: upload trusted file bytes and create metadata, scan, version, and audit rows; accepts a stable per-file `Idempotency-Key` header or matching body `idempotencyKey`
- `GET /api/v1/artifacts/:id`: read one artifact metadata record
- `PATCH /api/v1/artifacts/:id`: patch artifact metadata only
- `POST /api/v1/artifacts/:id/links`: replace generic entity links for the artifact source entity
- `POST /api/v1/artifacts/:id/scan`: rerun the static scanner
- `POST /api/v1/artifacts/:id/enrich`: use a configured LLM profile to fill missing metadata
- `POST /api/v1/artifacts/:id/trust`: apply a trusted state override with an audit reason
- `GET /api/v1/artifacts/:id/versions`: list artifact versions
- `GET /api/v1/artifacts/:id/audit`: list artifact audit events
- `GET /api/v1/artifacts/:id/download`: download plaintext file bytes as `application/octet-stream` for a human operator session only; encrypted artifacts return `artifact_password_required`
- `POST /api/v1/artifacts/:id/download`: download decrypted file bytes as `application/octet-stream` after a human operator submits `{ "password": "..." }` in the request body
- `POST /api/v1/artifacts/:id/encrypt`: password-encrypt an existing plaintext artifact for a human operator session only

Shared batch CRUD can search, update, soft-delete, restore, and hard-delete artifact metadata. It must not create artifacts or expose file bytes.

An exact retry with the same actor, key, and normalized payload returns the original artifact with status `200` and `Idempotency-Replayed: true`. A first successful upload returns `201` and `Idempotency-Replayed: false`. Reusing the key with changed metadata or bytes returns `409`. For an encrypted upload, Forge also verifies the transient retry password by decrypting the already stored ciphertext before returning replay success. A wrong password returns `403 artifact_wrong_password`; it is not added to the fingerprint, persisted as a verifier, logged, or returned. The key is actor-scoped and its plaintext value is not written to the audit log. If a concurrent losing ciphertext cannot be removed, Forge returns the committed replay, records a bounded cleanup marker without the password, and retries the exact hash-bound cleanup on a later replay. A referenced blob is preserved. Callers should use a new key for a deliberate new artifact or a changed encrypted-upload password.

Blob reuse and cleanup are serialized by an atomic lock under the shared Forge data root, so independent server processes cannot commit a same-key reference between deletion checks and file removal. Every pending cleanup records whether that upload physically created the blob. Cleanup never removes a pre-existing or explicitly retained blob, and hard-deleting metadata writes retention records for all current and version storage keys before removing database metadata.

Public Artifact payloads recursively remove physical locators, scanner plaintext samples, and raw provider or enrichment failure context from live records, versions, audit events, event metadata, and deleted snapshots. Raw failure context is replaced by the stable `artifact_llm_enrichment_failed` code; unrelated fields in the same nested object are preserved.

## Agent And Plugin Contract

OpenAPI, OpenClaw, Hermes, Codex, and Claude Code must present the same boundary:

- artifact routes are specialized CRUD routes, not normal batch create routes
- `forge_call_artifact_route` handles trusted upload, metadata reads/patches, scans, enrichment, generic links, trust state, versions, and audit
- the agent tool surface must not expose artifact download, password download, decrypt, preview, open, execute, transform, or existing-artifact encryption password submission
- list calls should use `limit` and `offset`; agents and plugins should not bulk-load a large Artifact Store
- every agent or plugin upload must set one stable `idempotencyKey` in the body and retain it across transport retries; never reuse it for changed bytes or metadata
- the server owns actor provenance: agents must not claim another agent or a user outside their token scope
- agents may read `contentProtection` mode and password hints as metadata, but must not receive, store, route, or submit artifact passwords
- agents must confirm they are not being asked to run, decrypt, open, preview, transform, or inspect file bytes autonomously
- when linking artifacts, agents should say they are writing general Forge entity links

The web app exposes the Artifact Store at `/forge/artifacts` and artifact detail routes at `/forge/artifacts/:id`.

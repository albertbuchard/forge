# Psyche Event And Emotion Vocabularies

Forge keeps two reusable vocabularies for trigger reports:

- `event_type` names a recurring kind of meaningful event.
- `emotion_definition` names a reusable emotional distinction.

These records support consistent reporting without replacing the user's own words.

## Stored Fields

An event type accepts:

- `label`
- `description`
- `userId`

An emotion definition accepts:

- `label`
- `description`
- `category`
- `userId`

`description`, `category`, and `userId` are optional when creating a record. Neither
entity has an `aliases` field, and emotion definitions do not have a `bodySignals`
field.

## Built-In And Custom Entries

Built-in entries have `system: true`. Every owner can read them, but they cannot be
renamed, deleted, or restored as custom records.

Custom entries belong to one Forge user. Psyche reads and writes enforce that owner
scope. Two owners can use the same label, while one owner cannot create labels that
differ only by Unicode form, letter case, punctuation, or whitespace. Comparison uses
Unicode NFKC compatibility normalization and default caseless matching, including
multi-character folds such as sharp-S and Greek final sigma, before collapsing
punctuation, symbols, and whitespace. Accents remain meaningful. Forge returns a
conflict instead of silently creating the duplicate.

## Keep The User's Wording

A trigger report stores both reusable references and the words used in the report:

- The report event wording is stored in `customEventType`.
- Each report emotion stores its own `label` beside an optional emotion-definition
  reference.

Selecting a reusable entry does not erase these fields. Renaming an event type or
emotion definition changes the reusable vocabulary only. Soft deletion moves a custom
entry to the bin. Report reads treat its reference as unavailable while it is in the
bin, then expose the same reference again after restoration. Hard deletion clears the
reference permanently but leaves the report's recorded event and emotion wording
intact.

Tombstone masking is a response rule, not a storage rewrite. An unrelated trigger
report update keeps the persisted event, emotion, and managed-link references while
their targets are in the bin, so restoration exposes the original references again.

Questionnaire instruments and runs do not reference these vocabularies, so vocabulary
changes do not rewrite questionnaire history.

## API Contract

Event types and emotion definitions are normal stored Forge entities. Agents should use
the shared batch routes:

- `POST /api/v1/entities/search`
- `POST /api/v1/entities/create`
- `POST /api/v1/entities/update`
- `POST /api/v1/entities/delete`
- `POST /api/v1/entities/restore`

Search before creating a custom entry. Each `searches[]` item supports `userIds` to
narrow custom entries to effective owners; built-ins remain visible. Each create
operation supports its own `operations[].idempotencyKey`.

Agent-token scopes differ by route family when Psyche authorization is enabled:

| Route family                                                           | Read                                      | Mutation                         |
| ---------------------------------------------------------------------- | ----------------------------------------- | -------------------------------- |
| Dedicated `/api/v1/psyche/event-types*` and `/api/v1/psyche/emotions*` | `psyche.read`                             | `psyche.write`                   |
| Shared batch routes                                                    | base `read` or `write` plus `psyche.read` | base `write` plus `psyche.write` |

A base-only token cannot access explicit vocabulary operations, a Psyche-only token
cannot use the shared batch routes, and a combined token can use both route families.

The web operator flow uses the dedicated compatibility routes:

- `GET|POST /api/v1/psyche/event-types`
- `GET|PATCH|DELETE /api/v1/psyche/event-types/:id`
- `GET|POST /api/v1/psyche/emotions`
- `GET|PATCH|DELETE /api/v1/psyche/emotions/:id`

The dedicated create routes accept an `Idempotency-Key` header. Choose one stable key
for one intended logical create and reuse it only for an exact transport retry. The
batch equivalent is `operations[].idempotencyKey`. Repeating the same owner, key,
entity type, and payload returns the same active record. Reusing a key with a changed
payload returns `idempotency_conflict`. If the original record is in the bin, retry
returns `psyche_vocabulary_idempotency_target_in_bin`; restore it instead. Hard
deletion permanently consumes the key, and a delayed identical retry returns terminal
`psyche_vocabulary_idempotency_target_deleted` instead of recreating the record.
Invalid fields return a validation error, normalized duplicates return a conflict,
and inaccessible owner-scoped records are reported as not found.

## User Flow

The Psyche reports view opens vocabulary management in the shared guided modal. It
supports search, create, edit, soft delete, owner selection, explicit deletion
confirmation, loading and retry states, and bounded dense lists. Built-in entries are
shown as read-only.

The iPhone companion and Watch do not provide deep vocabulary management. They consume
report data through their existing bounded Psyche surfaces; creating and maintaining
the taxonomy remains a web and API workflow.

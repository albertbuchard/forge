# Start, import, review, and control product feedback

Forge Launchpad brings first use, starter packs, imports, the Review Queue, privacy feedback, and distribution status into one route. A new account opens Launchpad until its first-run choice is complete or deliberately skipped.

## Start with a useful result

Launchpad offers 3 Forge-reviewed starter packs:

- Plan a useful week creates one Goal and 3 Tasks.
- Build a daily reflection loop creates one Habit and one reusable Note.
- Start a research project creates one Goal, one Project, and 3 Tasks.

Before installation, Forge shows every record, dependency, collision, and permission. The manifest digest is bound to confirmation, and the installation key makes retries idempotent. The installation remains visible in history. Removing it is a separate two-step action that moves only its created records to the bin in reverse dependency order.

## Import existing work

Forge reads Markdown and Obsidian files directly. Notion, Todoist, Apple Reminders, calendar, GitHub Issues, and Linear use a bounded JSON export containing an `items`, `records`, or `data` array. A preview contains at most 500 records.

Every preview identifies records that are ready to create and title collisions that require a create-or-skip decision. Confirming applies the reviewed decisions atomically and keeps source identity in the created record. Import history shows the exact receipt and record links. Rolling back a committed import moves only records created by that receipt to the bin and keeps the receipt for accountability.

## Use one Review Queue

The Review Queue combines import conflicts, relationship proposals, agent approvals, offline task-move conflicts, and Artifact enrichment proposals. Each decision uses the source revision that was displayed. A changed source returns a conflict and must be refreshed. Import conflicts return to the complete import preview because a generic Accept button cannot safely decide field mappings.

## Keep product feedback local and optional

Privacy feedback is off by default. When enabled, Forge stores only a strict activation-event schema in local SQLite. It never opens a product-feedback transport. The schema excludes record content, titles, file paths, credentials, and stable device identifiers. Events expire after 90 days and can be inspected, exported, or deleted from Launchpad.

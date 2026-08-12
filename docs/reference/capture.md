# Capture text, links, files, and dictation

Forge Capture gives every web surface one place to turn an unfinished thought or file into a durable record. Open Capture from the Action Bar, choose Text, Link, File, or Dictation, and ask Forge to review it. Nothing is written during review.

## Review before Forge writes

Forge proposes either a Note or an Artifact. It also proposes up to 5 relationships from records the current user is allowed to see. The review screen shows the proposed title, content or description, classification reason, relationships, and any warning. You can edit the record fields and remove proposed relationships before confirming.

Capture uses these boundaries:

- text and dictation transcripts are limited to 24,000 characters;
- links must use HTTP or HTTPS and cannot retain URL credentials;
- one file may be reviewed at a time, up to 100 MiB;
- the file stays in the browser until confirmation;
- Forge rechecks the confirmed file's byte length and SHA-256 digest;
- browser dictation stores only the transcript, never the audio;
- the draft is stored only in browser-local storage and can be cleared from the dialog.

Confirmation creates one Note or Artifact and returns its exact record link. A stable retry key makes an uncertain retry return the original receipt. Reusing that key for changed content returns a conflict instead of creating a second record.

## Permissions and failures

Capture uses the current operator or scoped session. Proposed relationships come from permission-filtered local search and are rechecked immediately before the write. If a selected record was deleted or access changed, Forge creates nothing and asks you to review again.

A file becomes an Artifact so the existing provenance, static scanning, danger classification, versioning, and human-download rules still apply. Capture does not weaken those Artifact controls.

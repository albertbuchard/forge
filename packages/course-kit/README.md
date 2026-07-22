# Forge Course Kit

Forge Course Kit defines the portable `.forge-course.json` contract. Course
packages contain public teaching content only; Forge keeps learner attempts,
grades, mastery, review scheduling, rewards, and LLM feedback in its local
database.

Import `defineCoursePackage` while authoring. It applies production defaults and
validates structural fields and cross-references, including concept graphs,
module lesson lists, activity concept links, assessment profiles, mastery
dimensions, misconceptions, competencies, and proof-rubric weights.

## Authoring model

- Put canonical concepts owned by the package in `concepts`.
- Put concepts already supplied by another installed course in `conceptRefs`.
  Forge links them without duplicating or overwriting their definitions.
- Use the built-in Markdown, math, callout, resource, proof, computation,
  recall, reflection, and multiple-choice primitives for the common path.
- Customize the immersive view through the validated `presentation` preset,
  layout ids, and four semantic color tokens.
- Declare uncommon UI as namespaced extension data. A package cannot execute
  code; Forge renders an extension only when matching trusted renderer code is
  installed, and otherwise shows a safe fallback.
- Declare grade thresholds, latest-or-best attempt aggregation, point policy,
  assessment profiles, competencies, misconception/remediation codes, and
  weighted mastery dimensions under `grading`.

Use `stableJson` when computing a package SHA-256. The hash payload is the full
validated package with `provenance.contentHash` set to an empty string. Forge
recomputes this hash on import and verifies it again on export.

## Sharing guarantees

Course JSON contains no learner state or provider credentials. Import is
idempotent for the same content hash. A changed snapshot may reconcile only
before learner evidence exists; after that Forge requires a new immutable
course snapshot. Authenticated import and export endpoints make validated
packages round-trip without depending on this repository layout.

## Trusted UI integration

Forge resolves an omitted lesson `layoutId` from
`presentation.defaultLessonLayoutId`. The web registry then selects trusted
layout code by layout id, followed by presentation preset, with the accessible
three-column Forge layout as the safe fallback.

Trusted activity renderers receive the learner-safe activity, current response,
an `onResponseChange` callback, and the disabled state. If a renderer is not
installed, Forge still provides a portable text/structured response field (or a
completion acknowledgement for `responseMode: "none"`), so a required
extension never strands the learner. Package data selects registered code but
can never supply executable code.

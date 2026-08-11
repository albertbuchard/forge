import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import type { QuestionnaireInstrumentDetail } from "./questionnaire-types.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";

test("PSY-13 starts runs only from a published version owned by the selected questionnaire", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-psy-13-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const cookie = issueTestOperatorSessionCookie(app);
    const library = await app.inject({
      method: "GET",
      url: "/api/v1/psyche/questionnaires",
      headers: { cookie }
    });
    assert.equal(library.statusCode, 200, library.body);
    const phq9 = (
      library.json() as {
        instruments: Array<{
          id: string;
          key: string;
          currentVersionId: string | null;
        }>;
      }
    ).instruments.find((instrument) => instrument.key === "phq_9");
    assert.ok(phq9?.currentVersionId);

    const cloned = await app.inject({
      method: "POST",
      url: `/api/v1/psyche/questionnaires/${phq9.id}/clone`,
      headers: { cookie },
      payload: { userId: "user_operator" }
    });
    assert.equal(cloned.statusCode, 201, cloned.body);
    const clone = cloned.json() as {
      instrument: {
        id: string;
        draftVersion: { id: string; versionNumber: number } | null;
      };
    };
    const instrumentId = clone.instrument.id;
    const firstVersionId = clone.instrument.draftVersion?.id;
    assert.ok(firstVersionId);
    assert.equal(clone.instrument.draftVersion?.versionNumber, 1);

    const unpublishedDefault = await app.inject({
      method: "POST",
      url: `/api/v1/psyche/questionnaires/${instrumentId}/runs`,
      headers: { cookie },
      payload: { userId: "user_operator" }
    });
    assert.equal(unpublishedDefault.statusCode, 409, unpublishedDefault.body);
    assert.equal(
      (unpublishedDefault.json() as { code: string }).code,
      "questionnaire_published_version_required"
    );

    const unpublishedExplicit = await app.inject({
      method: "POST",
      url: `/api/v1/psyche/questionnaires/${instrumentId}/runs`,
      headers: { cookie },
      payload: { userId: "user_operator", versionId: firstVersionId }
    });
    assert.equal(unpublishedExplicit.statusCode, 409, unpublishedExplicit.body);
    assert.equal(
      (unpublishedExplicit.json() as { code: string }).code,
      "questionnaire_published_version_required"
    );

    const foreignVersion = await app.inject({
      method: "POST",
      url: `/api/v1/psyche/questionnaires/${instrumentId}/runs`,
      headers: { cookie },
      payload: {
        userId: "user_operator",
        versionId: phq9.currentVersionId
      }
    });
    assert.equal(foreignVersion.statusCode, 404, foreignVersion.body);
    assert.equal(
      (foreignVersion.json() as { code: string }).code,
      "questionnaire_version_missing"
    );

    const published = await app.inject({
      method: "POST",
      url: `/api/v1/psyche/questionnaires/${instrumentId}/publish`,
      headers: { cookie },
      payload: { label: "Published v1" }
    });
    assert.equal(published.statusCode, 200, published.body);

    const started = await app.inject({
      method: "POST",
      url: `/api/v1/psyche/questionnaires/${instrumentId}/runs`,
      headers: { cookie },
      payload: { userId: "user_operator" }
    });
    assert.equal(started.statusCode, 201, started.body);
    const run = started.json() as {
      run: { id: string; versionId: string };
      version: { id: string; status: string; versionNumber: number };
    };
    assert.equal(run.run.versionId, firstVersionId);
    assert.deepEqual(
      {
        id: run.version.id,
        status: run.version.status,
        versionNumber: run.version.versionNumber
      },
      { id: firstVersionId, status: "published", versionNumber: 1 }
    );

    const nextDraft = await app.inject({
      method: "POST",
      url: `/api/v1/psyche/questionnaires/${instrumentId}/draft`,
      headers: { cookie },
      payload: {}
    });
    assert.equal(nextDraft.statusCode, 200, nextDraft.body);
    const nextInstrument = (
      nextDraft.json() as { instrument: QuestionnaireInstrumentDetail }
    ).instrument;
    const secondVersion = nextInstrument.draftVersion;
    assert.ok(secondVersion);
    const secondVersionId = secondVersion.id;
    assert.notEqual(secondVersionId, firstVersionId);

    const reread = await app.inject({
      method: "GET",
      url: `/api/v1/psyche/questionnaire-runs/${run.run.id}`,
      headers: { cookie }
    });
    assert.equal(reread.statusCode, 200, reread.body);
    assert.equal(
      (reread.json() as { run: { versionId: string } }).run.versionId,
      firstVersionId
    );

    const stored = getDatabase()
      .prepare(
        `SELECT runs.version_id,
                published.status AS published_status,
                draft.status AS draft_status
         FROM questionnaire_runs runs
         JOIN questionnaire_versions published ON published.id = runs.version_id
         JOIN questionnaire_versions draft ON draft.id = ?
         WHERE runs.id = ?`
      )
      .get(secondVersionId, run.run.id) as {
      version_id: string;
      published_status: string;
      draft_status: string;
    };
    assert.deepEqual({ ...stored }, {
      version_id: firstVersionId,
      published_status: "published",
      draft_status: "draft"
    });

    const legacyRunId = "questionnaire_run_legacy_draft";
    const legacyStartedAt = "2026-08-11T12:00:00.000Z";
    getDatabase()
      .prepare(
        `INSERT INTO questionnaire_runs (
           id, instrument_id, version_id, user_id, status, progress_index,
           started_at, updated_at, completed_at
         )
         VALUES (?, ?, ?, 'user_operator', 'draft', 0, ?, ?, NULL)`
      )
      .run(
        legacyRunId,
        instrumentId,
        secondVersionId,
        legacyStartedAt,
        legacyStartedAt
      );

    const editLegacyVersion = await app.inject({
      method: "PATCH",
      url: `/api/v1/psyche/questionnaires/${instrumentId}/draft`,
      headers: { cookie },
      payload: {
        title: `${nextInstrument.title} overwritten`,
        subtitle: nextInstrument.subtitle,
        description: nextInstrument.description,
        aliases: nextInstrument.aliases,
        symptomDomains: nextInstrument.symptomDomains,
        tags: nextInstrument.tags,
        sourceClass: nextInstrument.sourceClass,
        availability: nextInstrument.availability,
        isSelfReport: nextInstrument.isSelfReport,
        label: secondVersion.label,
        definition: {
          ...secondVersion.definition,
          instructions: "This stale edit must not be stored."
        },
        scoring: secondVersion.scoring,
        provenance: secondVersion.provenance
      }
    });
    assert.equal(editLegacyVersion.statusCode, 409, editLegacyVersion.body);
    assert.equal(
      (editLegacyVersion.json() as { code: string }).code,
      "questionnaire_draft_has_runs"
    );

    const preserved = getDatabase()
      .prepare(
        `SELECT instruments.title, versions.definition_json
         FROM questionnaire_instruments instruments
         JOIN questionnaire_versions versions ON versions.id = ?
         WHERE instruments.id = ?`
      )
      .get(secondVersionId, instrumentId) as {
      title: string;
      definition_json: string;
    };
    assert.equal(preserved.title, nextInstrument.title);
    assert.deepEqual(
      JSON.parse(preserved.definition_json),
      secondVersion.definition
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

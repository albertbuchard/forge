import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  closeDatabase,
  configureDatabase,
  configureLegacyWikiAutoImport,
  getDatabase,
  initializeDatabase
} from "./db.js";
import {
  ensureBuiltInCourses,
  listConcepts
} from "./repositories/courses.js";
import {
  createUser,
  ensureSystemUsers,
  getDefaultUser
} from "./repositories/users.js";

function addReviewState(input: {
  userId: string;
  conceptId: string;
  nextReviewAt: string;
}) {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO concept_mastery (
         user_id, concept_id, mastery_score, average_score, evidence_count,
         successful_review_count, review_interval_days, next_review_at,
         last_evidence_at, updated_at
       ) VALUES (?, ?, 55, 70, 1, 0, 1, ?, ?, ?)`
    )
    .run(
      input.userId,
      input.conceptId,
      input.nextReviewAt,
      now,
      now
    );
}

test("LEARN-03 orders due concepts by review deadline per learner", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-learn-03-readiness-")
  );
  configureDatabase({ dataRoot });
  configureLegacyWikiAutoImport(false);
  try {
    await initializeDatabase();
    ensureSystemUsers();
    ensureBuiltInCourses();

    const primaryUser = getDefaultUser();
    const secondUser = createUser({
      kind: "human",
      handle: "review_learner",
      displayName: "Review learner",
      description: "Independent due-concept fixture",
      accentColor: "#9b8fe8"
    });
    const concepts = getDatabase()
      .prepare("SELECT id, title FROM concepts ORDER BY title COLLATE NOCASE, id")
      .all() as Array<{ id: string; title: string }>;
    const [alphabeticFirst, alphabeticSecond, sparseConcept] = concepts;
    assert.ok(alphabeticFirst && alphabeticSecond && sparseConcept);

    addReviewState({
      userId: primaryUser.id,
      conceptId: alphabeticFirst.id,
      nextReviewAt: "2026-08-11T20:00:00.000Z"
    });
    addReviewState({
      userId: primaryUser.id,
      conceptId: alphabeticSecond.id,
      nextReviewAt: "2026-08-01T20:00:00.000Z"
    });
    addReviewState({
      userId: secondUser.id,
      conceptId: alphabeticFirst.id,
      nextReviewAt: "2026-08-05T20:00:00.000Z"
    });

    assert.deepEqual(
      listConcepts(primaryUser.id, { dueOnly: true }).map(
        (concept) => concept.id
      ),
      [alphabeticSecond.id, alphabeticFirst.id],
      "the oldest review deadline must outrank alphabetical title order"
    );
    assert.deepEqual(
      listConcepts(secondUser.id, { dueOnly: true }).map(
        (concept) => concept.id
      ),
      [alphabeticFirst.id],
      "one learner's due queue must not expose another learner's review state"
    );
    assert.equal(
      listConcepts(primaryUser.id, { dueOnly: true }).some(
        (concept) => concept.id === sparseConcept.id
      ),
      false,
      "a concept with no learner evidence must not be invented as due"
    );
  } finally {
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

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
  createCourseAttempt,
  ensureBuiltInCourses,
  exportCoursePackage,
  listCourses
} from "./repositories/courses.js";
import {
  createUser,
  ensureSystemUsers,
  getDefaultUser
} from "./repositories/users.js";

function currentLesson(courseId: string, userId: string) {
  return listCourses(userId).find((course) => course.id === courseId)?.progress
    .currentLessonId;
}

test("LEARN-01 keeps an owner-specific, valid resume lesson", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-learn-01-readiness-")
  );
  configureDatabase({ dataRoot });
  configureLegacyWikiAutoImport(false);
  try {
    await initializeDatabase();
    ensureSystemUsers();
    const primaryUser = getDefaultUser();
    const secondUser = createUser({
      kind: "human",
      handle: "second_learner",
      displayName: "Second learner",
      description: "Independent course progress fixture",
      accentColor: "#86a8e7"
    });

    assert.deepEqual(listCourses(primaryUser.id), []);
    ensureBuiltInCourses();

    const courseId = "course.polynomials-etale-triple-covers";
    const coursePackage = exportCoursePackage(courseId);
    const [firstLesson, secondLesson, thirdLesson] = coursePackage.lessons;
    assert.ok(firstLesson?.activities[0]);
    assert.ok(secondLesson?.activities[0]);
    assert.ok(thirdLesson?.activities[0]);

    const firstAttempt = createCourseAttempt({
      courseId,
      lessonId: firstLesson.id,
      activityId: firstLesson.activities[0].id,
      userId: primaryUser.id,
      answerMarkdown: "First learner begins the first lesson.",
      idempotencyKey: "learn-01-first-attempt"
    });
    assert.equal(firstAttempt.existing, false);

    createCourseAttempt({
      courseId,
      lessonId: thirdLesson.id,
      activityId: thirdLesson.activities[0].id,
      userId: secondUser.id,
      answerMarkdown: "Second learner works independently.",
      idempotencyKey: "learn-01-second-user"
    });

    createCourseAttempt({
      courseId,
      lessonId: secondLesson.id,
      activityId: secondLesson.activities[0].id,
      userId: primaryUser.id,
      answerMarkdown: "First learner continues in the second lesson.",
      idempotencyKey: "learn-01-second-attempt"
    });

    assert.equal(currentLesson(courseId, primaryUser.id), secondLesson.id);
    assert.equal(currentLesson(courseId, secondUser.id), thirdLesson.id);

    const replay = createCourseAttempt({
      courseId,
      lessonId: firstLesson.id,
      activityId: firstLesson.activities[0].id,
      userId: primaryUser.id,
      answerMarkdown: "First learner begins the first lesson.",
      idempotencyKey: "learn-01-first-attempt"
    });
    assert.equal(replay.existing, true);
    assert.equal(
      currentLesson(courseId, primaryUser.id),
      secondLesson.id,
      "an exact retry of older work must not rewind the resume position"
    );

    getDatabase()
      .prepare(
        `UPDATE course_enrollments
         SET current_lesson_id = 'removed-from-release'
         WHERE course_id = ? AND user_id = ?`
      )
      .run(courseId, primaryUser.id);
    assert.equal(
      currentLesson(courseId, primaryUser.id),
      firstLesson.id,
      "a removed or corrupt saved lesson must fall back to the first incomplete lesson"
    );
    assert.equal(
      currentLesson(courseId, secondUser.id),
      thirdLesson.id,
      "repairing one learner's resume state must not affect another learner"
    );
  } finally {
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

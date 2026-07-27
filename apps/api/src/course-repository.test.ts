import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { stableJson } from "../../../packages/course-kit/src/index.js";
import {
  closeDatabase,
  configureDatabase,
  configureLegacyWikiAutoImport,
  getDatabase,
  initializeDatabase
} from "./db.js";
import {
  completeCourseAttempt,
  createCourseAttempt,
  createVoiceLearningSession,
  ensureBuiltInCourses,
  exportCoursePackage,
  getActivityForAssessment,
  getConceptDetail,
  getCourseAttemptResult,
  getCourseDetail,
  getLearningSession,
  importCoursePackage,
  listConcepts,
  listCourses,
  upgradeCourseEnrollment
} from "./repositories/courses.js";
import { ensureSystemUsers, getDefaultUser } from "./repositories/users.js";

function passingFeedback(
  activity: ReturnType<typeof getActivityForAssessment>["activity"],
  score = 90
) {
  return {
    verdict: "pass" as const,
    score,
    grade: "A-",
    summary: "The response is correct and the reasoning is explicit.",
    strengths: ["The mathematical steps are stated in a logical order."],
    issues: [],
    lineFeedback: [],
    criterionScores:
      activity.type === "proof"
        ? activity.rubric.map((criterion) => ({
            criterionId: criterion.id,
            score,
            rationale: "The response meets this criterion."
          }))
        : [],
    nextStep: "Continue to the next checkpoint.",
    conceptScores: activity.conceptIds.map((conceptId) => ({
      conceptId,
      score,
      evidence: "The response uses this concept correctly."
    })),
    misconceptionIds: []
  };
}

function passRequiredActivitiesBefore(
  courseId: string,
  userId: string,
  targetLessonId: string
) {
  const coursePackage = exportCoursePackage(courseId);
  const target = coursePackage.lessons.find(
    (lesson) => lesson.id === targetLessonId
  );
  assert.ok(target, `Expected ${targetLessonId} to exist.`);
  const database = getDatabase();
  for (const lesson of coursePackage.lessons.filter(
    (entry) => entry.order < target.order
  )) {
    let lessonAttemptOrdinal = 0;
    for (const activity of lesson.activities.filter(
      (entry) => entry.required
    )) {
      lessonAttemptOrdinal += 1;
      const attemptId = randomUUID();
      const now = new Date().toISOString();
      database
        .prepare(
          `INSERT INTO course_attempts (
            id, course_id, lesson_id, activity_id, activity_type, user_id,
            answer_markdown, status, score, grade, points_awarded,
            submitted_at, assessed_at, course_version, activity_revision,
            activity_content_hash, activity_snapshot_json, delivery_mode,
            lesson_attempt_ordinal, activity_attempt_ordinal,
            request_content_hash
          ) VALUES (?, ?, ?, ?, ?, ?, 'test prerequisite evidence',
                    'assessed', 100, 'A+', 0, ?, ?, ?, ?, 'test-fixture', '{}',
                    'visual', ?, 1, 'test-fixture')`
        )
        .run(
          attemptId,
          courseId,
          lesson.id,
          activity.id,
          activity.type,
          userId,
          now,
          now,
          coursePackage.course.version,
          activity.revision,
          lessonAttemptOrdinal
        );
      database
        .prepare(
          `INSERT INTO course_assessments (
            id, attempt_id, verdict, feedback_json, provider, model, created_at
          ) VALUES (?, ?, 'pass', '{}', 'test', 'test-fixture', ?)`
        )
        .run(randomUUID(), attemptId, now);
    }
  }
}

function passLessonCheckpointsBefore(
  courseId: string,
  userId: string,
  lessonId: string,
  targetActivityId: string
) {
  let session = getLearningSession(courseId, userId, lessonId);
  while (
    session.flow.blockedByActivityId &&
    session.flow.blockedByActivityId !== targetActivityId
  ) {
    const activityId = session.flow.blockedByActivityId;
    const context = getActivityForAssessment(
      courseId,
      lessonId,
      activityId,
      userId
    );
    const created = createCourseAttempt({
      courseId,
      lessonId,
      activityId,
      userId,
      answerMarkdown: "Test prerequisite checkpoint evidence."
    });
    completeCourseAttempt({
      attemptId: created.attemptId,
      userId,
      activity: context.activity,
      feedback: passingFeedback(context.activity, 100),
      provider: "test",
      model: "test-assessor",
      nextLessonId: context.nextLessonId
    });
    session = getLearningSession(courseId, userId, lessonId);
  }
  assert.equal(session.flow.blockedByActivityId, targetActivityId);
}

test("imports a modular course and carries proof evidence into concept mastery", async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "forge-course-test-"));
  configureDatabase({ dataRoot });
  configureLegacyWikiAutoImport(false);
  try {
    await initializeDatabase();
    ensureSystemUsers();
    const imported = ensureBuiltInCourses();
    assert.equal(imported.length, 2);

    const userId = getDefaultUser().id;
    const courses = listCourses(userId);
    assert.equal(courses.length, 2);
    const researchCourse = courses.find(
      (course) => course.id === "course.polynomials-etale-triple-covers"
    );
    assert.equal(researchCourse?.estimatedWeeks, 66);
    assert.equal(researchCourse?.progress.totalLessons, 330);

    const courseId = researchCourse!.id;
    const detail = getCourseDetail(courseId, userId);
    assert.equal(detail.modules.length, 7);
    assert.equal(detail.lessons.length, 330);
    assert.ok(detail.concepts.length >= 30);
    assert.equal(detail.resources.length, 8);

    const lessonId = "term-1-week-17-day-3";
    const activityId = "term-1-week-17-day-3-exit-v2";
    passRequiredActivitiesBefore(courseId, userId, lessonId);
    passLessonCheckpointsBefore(courseId, userId, lessonId, activityId);
    const context = getActivityForAssessment(
      courseId,
      lessonId,
      activityId,
      userId
    );
    assert.equal(context.activity.type, "proof");
    assert.ok(context.concepts.length >= 3);

    const attempt = createCourseAttempt({
      courseId,
      lessonId,
      activityId,
      userId,
      answerMarkdown:
        "Since f'(w)=3w^2 is nonzero on C*, the inverse function theorem gives local injectivity. But 1 and a nontrivial cube root of unity have the same cube, so f is not globally injective."
    });
    const attemptSnapshot = getDatabase()
      .prepare(
        `SELECT course_version, activity_revision, activity_content_hash,
                activity_snapshot_json
         FROM course_attempts WHERE id = ?`
      )
      .get(attempt.attemptId) as {
      course_version: string;
      activity_revision: string;
      activity_content_hash: string;
      activity_snapshot_json: string;
    };
    assert.equal(attemptSnapshot.course_version, "2.8.0");
    assert.equal(attemptSnapshot.activity_revision, "2");
    assert.match(attemptSnapshot.activity_content_hash, /^[a-f0-9]{64}$/u);
    assert.equal(
      JSON.parse(attemptSnapshot.activity_snapshot_json).id,
      activityId
    );
    const result = completeCourseAttempt({
      attemptId: attempt.attemptId,
      userId,
      activity: context.activity,
      feedback: {
        verdict: "pass",
        score: 92,
        grade: "A-",
        summary:
          "The local theorem and global counterexample are separated correctly.",
        strengths: ["Correct use of the inverse function theorem."],
        issues: [],
        lineFeedback: [],
        criterionScores:
          context.activity.type === "proof"
            ? context.activity.rubric.map((criterion) => ({
                criterionId: criterion.id,
                score: 92,
                rationale: "Meets this criterion."
              }))
            : [],
        nextStep: "Name the cube root of unity explicitly on revision.",
        conceptScores: context.activity.conceptIds.map((conceptId) => ({
          conceptId,
          score: 92,
          evidence: "Used correctly in the local-versus-global proof."
        })),
        misconceptionIds: []
      },
      provider: "test",
      model: "test-assessor",
      nextLessonId: context.nextLessonId
    });
    assert.equal(result.status, "assessed");
    assert.ok(result.pointsAwarded > 0);

    const session = getLearningSession(courseId, userId, lessonId);
    assert.equal(session.resources.length, 8);
    const learnerPayload = JSON.stringify(session.lesson);
    assert.doesNotMatch(learnerPayload, /referenceAnswerMarkdown/u);
    assert.doesNotMatch(learnerPayload, /correctOptionIds/u);
    assert.doesNotMatch(learnerPayload, /explanationMarkdown/u);
    assert.equal(session.progress.completedLessons, 83);
    assert.ok(session.progress.grade);
    assert.equal(session.latestAttempts[2]?.feedback?.verdict, "pass");

    const concepts = listConcepts(userId, { courseId });
    const localGlobal = concepts.find(
      (concept) => concept.id === "concept.local-global"
    );
    assert.equal(localGlobal?.mastery.masteryScore, 97);
    assert.equal(localGlobal?.mastery.evidenceCount, 2);
    assert.ok(localGlobal?.mastery.nextReviewAt);
    assert.deepEqual(
      localGlobal?.mastery.dimensions.map((entry) => entry.id).sort(),
      ["conceptual_understanding", "proof_reasoning", "transfer"]
    );

    const conceptDetail = getConceptDetail(
      "local-vs-global-invertibility",
      userId
    );
    assert.equal(conceptDetail.evidence.length, 2);
    assert.equal(conceptDetail.evidence[0]!.score, 92);
    assert.ok(conceptDetail.lessons.some((lesson) => lesson.id === lessonId));

    const sharedCourse = importCoursePackage({
      schemaVersion: "1.0",
      course: {
        id: "course.shared-concept-contract-test",
        slug: "shared-concept-contract-test",
        version: "1.0.0",
        title: "Shared concept contract test",
        description:
          "Exercises one installed concept in a multi-activity lesson.",
        authors: ["Forge test"],
        license: "CC0-1.0",
        estimatedWeeks: 1,
        minutesPerWeek: 30,
        entryLessonId: "shared-lesson"
      },
      grading: {
        pointsPolicy: "positive_delta",
        misconceptions: [
          {
            id: "misconception.unjustified-step",
            label: "Unjustified step",
            description: "A conclusion is asserted without its reason.",
            remediationConceptIds: ["concept.proof"]
          }
        ]
      },
      conceptRefs: [{ id: "concept.proof" }],
      modules: [
        {
          id: "shared-module",
          title: "Shared module",
          description: "A module with two required activities.",
          order: 0,
          startWeek: 1,
          endWeek: 1,
          lessonIds: ["shared-lesson"]
        }
      ],
      lessons: [
        {
          id: "shared-lesson",
          moduleId: "shared-module",
          week: 1,
          day: 1,
          order: 0,
          title: "Two checks",
          summary: "Both checks are required.",
          estimatedMinutes: 30,
          conceptIds: ["concept.proof"],
          objectives: ["Complete both checks."],
          content: [{ type: "markdown", markdown: "Complete both checks." }],
          activities: [
            {
              id: "shared-check-one",
              type: "multiple_choice",
              title: "First check",
              promptMarkdown: "Select the valid option.",
              conceptIds: ["concept.proof"],
              points: 10,
              estimatedMinutes: 5,
              options: [
                { id: "valid", labelMarkdown: "Valid" },
                { id: "invalid", labelMarkdown: "Invalid" }
              ],
              correctOptionIds: ["valid"],
              explanationMarkdown: "The valid option is correct."
            },
            {
              id: "shared-check-two",
              type: "multiple_choice",
              title: "Second check",
              promptMarkdown: "Select the justified option.",
              conceptIds: ["concept.proof"],
              points: 10,
              estimatedMinutes: 5,
              options: [
                { id: "justified", labelMarkdown: "Justified" },
                { id: "unsupported", labelMarkdown: "Unsupported" }
              ],
              correctOptionIds: ["justified"],
              explanationMarkdown: "The justified option is correct."
            }
          ]
        }
      ],
      provenance: {
        generatedAt: "2026-07-22T00:00:00.000Z",
        contentHash: ""
      }
    });
    assert.equal(sharedCourse.imported.conceptsDefined, 0);
    assert.equal(sharedCourse.imported.conceptsReferenced, 1);
    const sharedConceptCount = getDatabase()
      .prepare("SELECT COUNT(*) AS count FROM concepts WHERE id = ?")
      .get("concept.proof") as { count: number };
    assert.equal(sharedConceptCount.count, 1);

    const exported = exportCoursePackage("course.shared-concept-contract-test");
    assert.equal(exported.provenance.contentHash.length, 64);
    assert.deepEqual(
      importCoursePackage(exported).course.contentHash,
      exported.provenance.contentHash
    );
    assert.throws(
      () =>
        importCoursePackage({
          ...exported,
          course: { ...exported.course, title: "Tampered after export" }
        }),
      /declared SHA-256 hash/u
    );

    assert.throws(
      () =>
        importCoursePackage({
          ...exported,
          course: {
            ...exported.course,
            id: "course.conflicting-concept-test",
            slug: "conflicting-concept-test",
            title: "Conflicting concept test"
          },
          concepts: [
            {
              id: "concept.proof",
              slug: "proof-writing",
              title: "Conflicting proof definition",
              summary: "An incompatible canonical definition.",
              definitionMarkdown: "This intentionally conflicts."
            }
          ],
          conceptRefs: [],
          provenance: { ...exported.provenance, contentHash: "" }
        }),
      /different canonical definition/u
    );

    const completeAutomatic = (targetActivityId: string, answer: string) => {
      const target = getActivityForAssessment(
        "course.shared-concept-contract-test",
        "shared-lesson",
        targetActivityId,
        userId
      );
      assert.equal(target.activity.type, "multiple_choice");
      const created = createCourseAttempt({
        courseId: "course.shared-concept-contract-test",
        lessonId: "shared-lesson",
        activityId: targetActivityId,
        userId,
        answerMarkdown: answer
      });
      return completeCourseAttempt({
        attemptId: created.attemptId,
        userId,
        activity: target.activity,
        feedback: {
          verdict: answer === "invalid" ? "revise" : "pass",
          score: answer === "invalid" ? 0 : 100,
          grade: answer === "invalid" ? "F" : "A+",
          summary: "Deterministic test feedback.",
          strengths: [],
          issues: [],
          lineFeedback: [],
          criterionScores: [],
          nextStep: "Continue.",
          conceptScores: [
            {
              conceptId: "concept.proof",
              score: answer === "invalid" ? 0 : 100,
              evidence: "Deterministic test evidence."
            }
          ],
          misconceptionIds:
            answer === "invalid"
              ? ["misconception.unjustified-step", "misconception.not-declared"]
              : []
        },
        provider: "forge-deterministic",
        model: "test",
        nextLessonId: null
      });
    };

    const firstCheck = completeAutomatic("shared-check-one", "invalid");
    assert.equal(firstCheck.pointsAwarded, 0);
    const secondCheck = completeAutomatic("shared-check-two", "justified");
    assert.equal(secondCheck.pointsAwarded, 10);
    const partiallyCompleted = getCourseDetail(
      "course.shared-concept-contract-test",
      userId
    );
    assert.equal(partiallyCompleted.progress.completedLessons, 0);
    assert.equal(partiallyCompleted.lessons[0]?.completed, false);
    const misconceptionRows = getDatabase()
      .prepare(
        `SELECT misconception_id, evidence_count
         FROM learner_misconceptions
         WHERE user_id = ? AND concept_id = ?`
      )
      .all(userId, "concept.proof") as Array<{
      misconception_id: string;
      evidence_count: number;
    }>;
    assert.equal(misconceptionRows.length, 1);
    assert.equal(
      misconceptionRows[0]?.misconception_id,
      "misconception.unjustified-step"
    );
    assert.equal(misconceptionRows[0]?.evidence_count, 1);
    const repairedFirstCheck = completeAutomatic("shared-check-one", "valid");
    assert.equal(repairedFirstCheck.pointsAwarded, 10);
    const completedShared = getCourseDetail(
      "course.shared-concept-contract-test",
      userId
    );
    assert.equal(completedShared.progress.completedLessons, 1);
    assert.equal(completedShared.progress.progressPercent, 100);
    assert.equal(completedShared.progress.pointsEarned, 20);
    assert.equal(completedShared.lessons[0]?.completed, true);
    const masteryBeforeRepeat = getDatabase()
      .prepare(
        "SELECT mastery_score FROM concept_mastery WHERE user_id = ? AND concept_id = ?"
      )
      .get(userId, "concept.proof") as { mastery_score: number };

    const retry = completeAutomatic("shared-check-one", "invalid");
    assert.equal(retry.pointsAwarded, 0);
    const afterRetry = getCourseDetail(
      "course.shared-concept-contract-test",
      userId
    );
    assert.equal(afterRetry.progress.pointsEarned, 20);
    assert.equal(afterRetry.progress.progressPercent, 0);
    assert.equal(afterRetry.lessons[0]?.completed, false);
    const masteryAfterMiss = getDatabase()
      .prepare(
        `SELECT mastery_score, evidence_count, successful_review_count,
                review_interval_days
         FROM concept_mastery WHERE user_id = ? AND concept_id = ?`
      )
      .get(userId, "concept.proof") as {
      mastery_score: number;
      evidence_count: number;
      successful_review_count: number;
      review_interval_days: number;
    };
    assert.equal(
      masteryAfterMiss.mastery_score,
      masteryBeforeRepeat.mastery_score
    );
    assert.equal(masteryAfterMiss.evidence_count, 4);
    assert.equal(masteryAfterMiss.successful_review_count, 2);
    assert.equal(masteryAfterMiss.review_interval_days, 1);

    const reviewPass = completeAutomatic("shared-check-one", "valid");
    assert.equal(reviewPass.pointsAwarded, 0);
    const masteryAfterReview = getDatabase()
      .prepare(
        `SELECT mastery_score, evidence_count, successful_review_count,
                review_interval_days, next_review_at
         FROM concept_mastery WHERE user_id = ? AND concept_id = ?`
      )
      .get(userId, "concept.proof") as {
      mastery_score: number;
      evidence_count: number;
      successful_review_count: number;
      review_interval_days: number;
      next_review_at: string;
    };
    assert.equal(
      masteryAfterReview.mastery_score,
      masteryBeforeRepeat.mastery_score
    );
    assert.equal(masteryAfterReview.evidence_count, 5);
    assert.equal(masteryAfterReview.successful_review_count, 3);
    assert.equal(masteryAfterReview.review_interval_days, 8);
    assert.ok(Date.parse(masteryAfterReview.next_review_at) > Date.now());

    assert.throws(
      () =>
        importCoursePackage({
          ...exported,
          course: { ...exported.course, title: "Changed after evidence" },
          provenance: { ...exported.provenance, contentHash: "" }
        }),
      /release 1.0.0 already exists with different content/u
    );

    const researchExport = exportCoursePackage(courseId);
    const priorProof = researchExport.concepts.find(
      (concept) => concept.id === "concept.proof"
    );
    assert.ok(priorProof);
    const priorProofHash = (
      getDatabase()
        .prepare("SELECT content_hash FROM concepts WHERE id = ?")
        .get("concept.proof") as { content_hash: string }
    ).content_hash;
    const upgradedProof = {
      ...priorProof,
      exampleMarkdown: `${priorProof.exampleMarkdown} This final sentence makes the example more explicit.`
    };
    const upgradedProofHash = createHash("sha256")
      .update(stableJson(upgradedProof))
      .digest("hex");
    const explicitConceptUpgrade = {
      ...researchExport,
      course: { ...researchExport.course, version: "2.9.0" },
      concepts: researchExport.concepts.map((concept) =>
        concept.id === upgradedProof.id ? upgradedProof : concept
      ),
      conceptUpgrades: [
        {
          conceptId: upgradedProof.id,
          fromContentHash: priorProofHash,
          reason: "Test an explicit canonical wording improvement."
        }
      ],
      provenance: { ...researchExport.provenance, contentHash: "" }
    };
    importCoursePackage(explicitConceptUpgrade);
    importCoursePackage(explicitConceptUpgrade);
    const revision = getDatabase()
      .prepare(
        `SELECT content_hash, definition_json, source_course_version,
                replaced_by_content_hash, reason
         FROM course_concept_revisions
         WHERE concept_id = ?`
      )
      .get("concept.proof") as {
      content_hash: string;
      definition_json: string;
      source_course_version: string;
      replaced_by_content_hash: string;
      reason: string;
    };
    assert.equal(revision.content_hash, priorProofHash);
    assert.equal(
      JSON.parse(revision.definition_json).exampleMarkdown,
      priorProof.exampleMarkdown
    );
    assert.equal(revision.source_course_version, "2.9.0");
    assert.equal(revision.replaced_by_content_hash, upgradedProofHash);
    assert.equal(
      revision.reason,
      "Test an explicit canonical wording improvement."
    );
    const revisionCount = getDatabase()
      .prepare(
        `SELECT COUNT(*) AS count FROM course_concept_revisions
         WHERE concept_id = ?`
      )
      .get("concept.proof") as { count: number };
    assert.equal(revisionCount.count, 1);
  } finally {
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("keeps an enrollment on its immutable release until an explicit audited upgrade", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-course-upgrade-test-")
  );
  configureDatabase({ dataRoot });
  configureLegacyWikiAutoImport(false);
  try {
    await initializeDatabase();
    ensureSystemUsers();
    ensureBuiltInCourses();
    const userId = getDefaultUser().id;
    const courseId = "course.polynomials-etale-triple-covers";
    const lessonId = "term-0-week-1-day-1";
    const activityId = "term-0-week-1-day-1-formative-v3";
    const context = getActivityForAssessment(
      courseId,
      lessonId,
      activityId,
      userId
    );
    const attempt = createCourseAttempt({
      courseId,
      lessonId,
      activityId,
      userId,
      answerMarkdown:
        "I name the assumptions, state the target, and justify each implication."
    });
    completeCourseAttempt({
      attemptId: attempt.attemptId,
      userId,
      activity: context.activity,
      feedback: {
        verdict: "pass",
        score: 90,
        grade: "A-",
        summary: "The proof plan is explicit and logically ordered.",
        strengths: ["The assumptions and target are both named."],
        issues: [],
        lineFeedback: [],
        criterionScores:
          context.activity.type === "proof"
            ? context.activity.rubric.map((criterion) => ({
                criterionId: criterion.id,
                score: 90,
                rationale: "The response meets this criterion."
              }))
            : [],
        nextStep: "Continue to the independent check.",
        conceptScores: context.activity.conceptIds.map((conceptId) => ({
          conceptId,
          score: 90,
          evidence: "The response uses the concept correctly."
        })),
        misconceptionIds: []
      },
      provider: "test",
      model: "test-assessor",
      nextLessonId: context.nextLessonId
    });

    const exported = exportCoursePackage(courseId);
    importCoursePackage({
      ...exported,
      course: { ...exported.course, version: "2.9.0" },
      provenance: {
        ...exported.provenance,
        generatedAt: "2026-07-25T00:00:00.000Z",
        contentHash: ""
      }
    });

    const beforeUpgrade = getCourseDetail(courseId, userId);
    assert.deepEqual(beforeUpgrade.release, {
      enrolledVersion: "2.8.0",
      latestVersion: "2.9.0",
      updateAvailable: true
    });
    assert.equal(
      getLearningSession(courseId, userId, lessonId).latestAttempts[0]
        ?.activityId,
      activityId
    );

    const receipt = upgradeCourseEnrollment(courseId, userId);
    assert.equal(receipt.upgraded, true);
    assert.equal(receipt.fromVersion, "2.8.0");
    assert.equal(receipt.toVersion, "2.9.0");
    assert.deepEqual(receipt.carriedActivityIds, [activityId]);
    assert.ok(receipt.remainingActivityIds.length > 0);

    const afterUpgrade = getCourseDetail(courseId, userId);
    assert.deepEqual(afterUpgrade.release, {
      enrolledVersion: "2.9.0",
      latestVersion: "2.9.0",
      updateAvailable: false
    });
    const upgradedSession = getLearningSession(courseId, userId, lessonId);
    assert.equal(upgradedSession.latestAttempts[0]?.activityId, activityId);
    assert.equal(upgradedSession.latestAttempts[0]?.feedback?.verdict, "pass");
    const receiptCount = getDatabase()
      .prepare(
        `SELECT COUNT(*) AS count
         FROM course_enrollment_upgrade_receipts
         WHERE course_id = ? AND user_id = ?`
      )
      .get(courseId, userId) as { count: number };
    assert.equal(receiptCount.count, 1);
  } finally {
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("locks future lessons and unlocks exactly the next lesson after required work passes", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-course-progression-test-")
  );
  configureDatabase({ dataRoot });
  configureLegacyWikiAutoImport(false);
  try {
    await initializeDatabase();
    ensureSystemUsers();
    ensureBuiltInCourses();
    const userId = getDefaultUser().id;
    const courseId = "course.polynomials-etale-triple-covers";
    const firstLessonId = "term-0-week-1-day-1";
    const secondLessonId = "term-0-week-1-day-2";
    const thirdLessonId = "term-0-week-1-day-3";

    assert.throws(
      () => getLearningSession(courseId, userId, secondLessonId),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "course_lesson_locked"
    );
    const firstSession = getLearningSession(courseId, userId, firstLessonId);
    const hiddenExitActivityId =
      "term-0-week-1-day-1-exit-v3";
    assert.throws(
      () =>
        createCourseAttempt({
          courseId,
          lessonId: firstLessonId,
          activityId: hiddenExitActivityId,
          userId,
          answerMarkdown: "This tries to skip the first checkpoint."
        }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "course_activity_locked"
    );
    let currentSession = firstSession;
    while (currentSession.flow.blockedByActivityId) {
      const activityId = currentSession.flow.blockedByActivityId;
      const activity = currentSession.lesson.activities.find(
        (entry) => entry.id === activityId
      );
      assert.ok(activity);
      const context = getActivityForAssessment(
        courseId,
        firstLessonId,
        activityId,
        userId
      );
      const created = createCourseAttempt({
        courseId,
        lessonId: firstLessonId,
        activityId,
        userId,
        answerMarkdown: "I state the claim and justify each required step."
      });
      completeCourseAttempt({
        attemptId: created.attemptId,
        userId,
        activity: context.activity,
        feedback: passingFeedback(context.activity),
        provider: "test",
        model: "test-assessor",
        nextLessonId: context.nextLessonId
      });
      currentSession = getLearningSession(courseId, userId, firstLessonId);
    }
    assert.equal(currentSession.progress.completedLessons, 1);

    assert.equal(
      getLearningSession(courseId, userId, secondLessonId).lesson.id,
      secondLessonId
    );
    assert.throws(
      () => getLearningSession(courseId, userId, thirdLessonId),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "course_lesson_locked"
    );
    const detail = getCourseDetail(courseId, userId);
    assert.equal(
      detail.lessons.find((lesson) => lesson.id === firstLessonId)?.completed,
      true
    );
    assert.equal(
      detail.lessons.find((lesson) => lesson.id === secondLessonId)?.unlocked,
      true
    );
    assert.equal(
      detail.lessons.find((lesson) => lesson.id === thirdLessonId)?.unlocked,
      false
    );
  } finally {
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("voice learning stores only confirmed answer text and returns stable attempt order", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-course-voice-test-")
  );
  configureDatabase({ dataRoot });
  configureLegacyWikiAutoImport(false);
  try {
    await initializeDatabase();
    ensureSystemUsers();
    ensureBuiltInCourses();
    const userId = getDefaultUser().id;
    const courseId = "course.polynomials-etale-triple-covers";
    const voiceSession = createVoiceLearningSession({
      courseId,
      userId,
      week: 1,
      day: 1
    });
    const lessonId = voiceSession.session.lesson.id;
    const activity = voiceSession.session.lesson.activities[0]!;
    assert.equal(voiceSession.voice.lessonId, lessonId);
    assert.equal(
      voiceSession.voice.deliveryPolicy.disclosure,
      "one_block_or_activity_at_a_time"
    );

    const created = createCourseAttempt({
      courseId,
      lessonId,
      activityId: activity.id,
      userId,
      answerMarkdown:
        "I am not completely sure. My first step is to name the assumptions.",
      deliveryMode: "voice",
      voiceSessionToken: voiceSession.voice.token,
      idempotencyKey: "voice-day-1-question-1-answer-1"
    });
    assert.equal(created.deliveryMode, "voice");
    assert.equal(created.lessonAttemptOrdinal, 1);
    assert.equal(created.activityAttemptOrdinal, 1);
    assert.equal(created.existing, false);

    const retry = createCourseAttempt({
      courseId,
      lessonId,
      activityId: activity.id,
      userId,
      answerMarkdown:
        "I am not completely sure. My first step is to name the assumptions.",
      deliveryMode: "voice",
      voiceSessionToken: voiceSession.voice.token,
      idempotencyKey: "voice-day-1-question-1-answer-1"
    });
    assert.equal(retry.attemptId, created.attemptId);
    assert.equal(retry.existing, true);
    assert.throws(
      () =>
        createCourseAttempt({
          courseId,
          lessonId,
          activityId: activity.id,
          userId,
          answerMarkdown: "A materially different answer.",
          deliveryMode: "voice",
          voiceSessionToken: voiceSession.voice.token,
          idempotencyKey: "voice-day-1-question-1-answer-1"
        }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "course_attempt_idempotency_conflict"
    );

    const attemptRow = getDatabase()
      .prepare("SELECT * FROM course_attempts WHERE id = ?")
      .get(created.attemptId) as Record<string, unknown>;
    assert.equal(
      attemptRow.answer_markdown,
      "I am not completely sure. My first step is to name the assumptions."
    );
    assert.equal(attemptRow.delivery_mode, "voice");
    assert.equal("audio" in attemptRow, false);
    assert.equal("transcript" in attemptRow, false);
    const voiceRow = getDatabase()
      .prepare("SELECT * FROM course_voice_sessions WHERE token = ?")
      .get(voiceSession.voice.token) as Record<string, unknown>;
    assert.equal("audio" in voiceRow, false);
    assert.equal("transcript" in voiceRow, false);
  } finally {
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("completes an in-flight attempt from its saved release and activity snapshot", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-course-snapshot-test-")
  );
  configureDatabase({ dataRoot });
  configureLegacyWikiAutoImport(false);
  try {
    await initializeDatabase();
    ensureSystemUsers();
    ensureBuiltInCourses();
    const userId = getDefaultUser().id;
    const courseId = "course.polynomials-etale-triple-covers";
    const lessonId = "term-0-week-1-day-1";
    const activityId = "term-0-week-1-day-1-formative-v3";
    const context = getActivityForAssessment(
      courseId,
      lessonId,
      activityId,
      userId
    );
    const originalPoints = context.activity.points;
    const attempt = createCourseAttempt({
      courseId,
      lessonId,
      activityId,
      userId,
      answerMarkdown: "I identify the assumptions and justify the conclusion.",
      idempotencyKey: "snapshot-attempt-before-upgrade"
    });

    const exported = exportCoursePackage(courseId);
    const changedLessons = exported.lessons.map((lesson) => ({
      ...lesson,
      activities: lesson.activities.map((activity) =>
        activity.id === activityId
          ? { ...activity, points: 999, revision: "changed-after-submit" }
          : activity
      )
    }));
    importCoursePackage({
      ...exported,
      course: { ...exported.course, version: "9.9.9" },
      lessons: changedLessons,
      provenance: {
        ...exported.provenance,
        generatedAt: "2026-07-25T00:00:00.000Z",
        contentHash: ""
      }
    });
    const receipt = upgradeCourseEnrollment(courseId, userId);
    assert.equal(receipt.toVersion, "9.9.9");
    assert.throws(
      () =>
        createCourseAttempt({
          courseId,
          lessonId,
          activityId,
          userId,
          answerMarkdown:
            "I identify the assumptions and justify the conclusion.",
          idempotencyKey: "snapshot-attempt-before-upgrade"
        }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "course_attempt_idempotency_conflict"
    );

    const completed = completeCourseAttempt({
      attemptId: attempt.attemptId,
      userId,
      activity: changedLessons[0]!.activities[0]!,
      feedback: passingFeedback(context.activity, 100),
      provider: "test",
      model: "test-assessor",
      nextLessonId: context.nextLessonId
    });
    assert.equal(completed.pointsAwarded, originalPoints);
    assert.equal(completed.nextLessonId, null);
    assert.equal(getCourseAttemptResult(attempt.attemptId, userId).score, 100);
    const enrollment = getDatabase()
      .prepare(
        `SELECT course_version, current_lesson_id
         FROM course_enrollments WHERE course_id = ? AND user_id = ?`
      )
      .get(courseId, userId) as {
      course_version: string;
      current_lesson_id: string | null;
    };
    assert.equal(enrollment.course_version, "9.9.9");
    assert.equal(enrollment.current_lesson_id, lessonId);
  } finally {
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

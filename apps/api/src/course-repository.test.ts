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
  completeCourseAttempt,
  createCourseAttempt,
  ensureBuiltInCourses,
  exportCoursePackage,
  getActivityForAssessment,
  getConceptDetail,
  getCourseDetail,
  getLearningSession,
  importCoursePackage,
  listConcepts,
  listCourses
} from "./repositories/courses.js";
import { ensureSystemUsers, getDefaultUser } from "./repositories/users.js";

test("imports a modular course and carries proof evidence into concept mastery", async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "forge-course-test-"));
  configureDatabase({ dataRoot });
  configureLegacyWikiAutoImport(false);
  try {
    await initializeDatabase();
    ensureSystemUsers();
    const imported = ensureBuiltInCourses();
    assert.equal(imported.length, 1);

    const userId = getDefaultUser().id;
    const courses = listCourses(userId);
    assert.equal(courses.length, 1);
    assert.equal(courses[0]!.estimatedWeeks, 66);
    assert.equal(courses[0]!.progress.totalLessons, 330);

    const courseId = courses[0]!.id;
    const detail = getCourseDetail(courseId, userId);
    assert.equal(detail.modules.length, 7);
    assert.equal(detail.lessons.length, 330);
    assert.ok(detail.concepts.length >= 30);
    assert.equal(detail.resources.length, 4);

    const lessonId = "term-1-week-17-day-3";
    const activityId = "week-17-day-3-local-not-global";
    const context = getActivityForAssessment(courseId, lessonId, activityId);
    assert.equal(context.activity.type, "proof");
    assert.equal(context.concepts.length, 4);

    const attempt = createCourseAttempt({
      courseId,
      lessonId,
      activityId,
      userId,
      answerMarkdown:
        "Since f'(w)=3w^2 is nonzero on C*, the inverse function theorem gives local injectivity. But 1 and a nontrivial cube root of unity have the same cube, so f is not globally injective."
    });
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
    assert.equal(session.resources.length, 4);
    const learnerPayload = JSON.stringify(session.lesson);
    assert.doesNotMatch(learnerPayload, /referenceAnswerMarkdown/u);
    assert.doesNotMatch(learnerPayload, /correctOptionIds/u);
    assert.doesNotMatch(learnerPayload, /explanationMarkdown/u);
    assert.equal(session.progress.completedLessons, 1);
    assert.equal(session.progress.grade, "A-");
    assert.equal(session.latestAttempts[0]?.feedback?.verdict, "pass");

    const concepts = listConcepts(userId, { courseId });
    const localGlobal = concepts.find(
      (concept) => concept.id === "concept.local-global"
    );
    assert.equal(localGlobal?.mastery.masteryScore, 92);
    assert.equal(localGlobal?.mastery.evidenceCount, 1);
    assert.ok(localGlobal?.mastery.nextReviewAt);
    assert.deepEqual(
      localGlobal?.mastery.dimensions.map((entry) => entry.id).sort(),
      ["proof_reasoning", "transfer"]
    );

    const conceptDetail = getConceptDetail(
      "local-vs-global-invertibility",
      userId
    );
    assert.equal(conceptDetail.evidence.length, 1);
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
        targetActivityId
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
    const secondCheck = completeAutomatic("shared-check-two", "justified");
    assert.equal(secondCheck.pointsAwarded, 10);
    const completedShared = getCourseDetail(
      "course.shared-concept-contract-test",
      userId
    );
    assert.equal(completedShared.progress.completedLessons, 1);
    assert.equal(completedShared.progress.progressPercent, 100);
    assert.equal(completedShared.progress.pointsEarned, 20);
    assert.equal(completedShared.lessons[0]?.completed, true);

    const retry = completeAutomatic("shared-check-one", "invalid");
    assert.equal(retry.pointsAwarded, 0);
    const afterRetry = getCourseDetail(
      "course.shared-concept-contract-test",
      userId
    );
    assert.equal(afterRetry.progress.pointsEarned, 20);
    assert.equal(afterRetry.progress.progressPercent, 100);

    assert.throws(
      () =>
        importCoursePackage({
          ...exported,
          course: { ...exported.course, title: "Changed after evidence" },
          provenance: { ...exported.provenance, contentHash: "" }
        }),
      /already has learner evidence/u
    );
  } finally {
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

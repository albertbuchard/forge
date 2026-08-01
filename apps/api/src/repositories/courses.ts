import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDatabase, runInTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import {
  courseActivitySchema,
  defineCoursePackage,
  forgeCoursePackageSchema,
  nextReviewIntervalDays,
  scoreToLetterGrade,
  stableJson,
  toLearnerLesson,
  updateMastery,
  type CourseActivity,
  type CourseConcept,
  type CourseLesson,
  type ForgeCoursePackage
} from "../../../../packages/course-kit/src/index.js";

type JsonRecord = Record<string, unknown>;

export type CourseAssessmentFeedback = {
  verdict: "pass" | "revise" | "insufficient" | "needs_review";
  score: number | null;
  grade: string | null;
  summary: string;
  strengths: string[];
  issues: string[];
  lineFeedback: Array<{ quote: string; comment: string }>;
  criterionScores: Array<{
    criterionId: string;
    score: number;
    rationale: string;
  }>;
  nextStep: string;
  conceptScores: Array<{
    conceptId: string;
    score: number;
    evidence: string;
  }>;
  misconceptionIds: string[];
};

type CourseRow = {
  id: string;
  slug: string;
  version: string;
  schema_version: string;
  title: string;
  subtitle: string;
  description: string;
  language: string;
  authors_json: string;
  license: string;
  estimated_weeks: number;
  minutes_per_week: number;
  tags_json: string;
  entry_lesson_id: string;
  featured_lesson_id: string | null;
  source_url: string | null;
  content_hash: string;
  definition_json: string;
  created_at: string;
  updated_at: string;
};

type MasteryRow = {
  user_id: string;
  concept_id: string;
  mastery_score: number;
  average_score: number;
  evidence_count: number;
  successful_review_count: number;
  review_interval_days: number | null;
  next_review_at: string | null;
  last_evidence_at: string | null;
  updated_at: string;
};

type DimensionMasteryRow = {
  concept_id: string;
  dimension_id: string;
  mastery_score: number;
  average_score: number;
  evidence_count: number;
  last_evidence_at: string | null;
};

function nowIso() {
  return new Date().toISOString();
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function packageContentHash(coursePackage: ForgeCoursePackage) {
  return createHash("sha256")
    .update(
      stableJson({
        ...coursePackage,
        provenance: { ...coursePackage.provenance, contentHash: "" }
      })
    )
    .digest("hex");
}

function conceptContentHash(concept: CourseConcept) {
  return createHash("sha256").update(stableJson(concept)).digest("hex");
}

function parseCoursePackage(row: CourseRow) {
  return defineCoursePackage(
    forgeCoursePackageSchema.parse(parseJson<unknown>(row.definition_json, {}))
  );
}

function coursePackageForUser(
  courseRow: CourseRow,
  userId: string
): ForgeCoursePackage {
  const enrollment = getDatabase()
    .prepare(
      `SELECT course_version
       FROM course_enrollments
       WHERE course_id = ? AND user_id = ?`
    )
    .get(courseRow.id, userId) as { course_version: string } | undefined;
  return coursePackageByVersion(
    courseRow,
    enrollment?.course_version || courseRow.version
  );
}

function coursePackageByVersion(
  courseRow: CourseRow,
  courseVersion: string
): ForgeCoursePackage {
  if (courseVersion === courseRow.version) return parseCoursePackage(courseRow);
  const release = getDatabase()
    .prepare(
      `SELECT definition_json
       FROM course_releases
       WHERE course_id = ? AND version = ?`
    )
    .get(courseRow.id, courseVersion) as
    | { definition_json: string }
    | undefined;
  if (!release) {
    throw new HttpError(
      409,
      "course_enrollment_release_missing",
      `The enrolled course release ${courseVersion} is unavailable.`
    );
  }
  return defineCoursePackage(
    forgeCoursePackageSchema.parse(
      parseJson<unknown>(release.definition_json, {})
    )
  );
}

function toCourse(row: CourseRow) {
  const coursePackage = parseCoursePackage(row);
  return toCourseFromPackage(row, coursePackage);
}

function toCourseFromPackage(
  row: CourseRow,
  coursePackage: ForgeCoursePackage
) {
  const course = coursePackage.course;
  return {
    id: course.id,
    slug: course.slug,
    version: course.version,
    schemaVersion: coursePackage.schemaVersion,
    title: course.title,
    subtitle: course.subtitle,
    description: course.description,
    language: course.language,
    authors: course.authors,
    license: course.license,
    estimatedWeeks: course.estimatedWeeks,
    minutesPerWeek: course.minutesPerWeek,
    tags: course.tags,
    entryLessonId: course.entryLessonId,
    featuredLessonId: course.featuredLessonId,
    sourceUrl: row.source_url,
    contentHash: coursePackage.provenance.contentHash,
    presentation: coursePackage.presentation,
    grading: coursePackage.grading,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toMastery(
  row: MasteryRow | undefined,
  dimensions: DimensionMasteryRow[] = []
) {
  const base = row
    ? {
        masteryScore: Math.round(row.mastery_score),
        averageScore: Math.round(row.average_score),
        evidenceCount: row.evidence_count,
        successfulReviewCount: row.successful_review_count,
        reviewIntervalDays: row.review_interval_days,
        nextReviewAt: row.next_review_at,
        lastEvidenceAt: row.last_evidence_at,
        due:
          row.next_review_at !== null &&
          Date.parse(row.next_review_at) <= Date.now()
      }
    : {
        masteryScore: 0,
        averageScore: 0,
        evidenceCount: 0,
        successfulReviewCount: 0,
        reviewIntervalDays: null,
        nextReviewAt: null,
        lastEvidenceAt: null,
        due: false
      };
  return {
    ...base,
    dimensions: dimensions.map((dimension) => ({
      id: dimension.dimension_id,
      masteryScore: Math.round(dimension.mastery_score),
      averageScore: Math.round(dimension.average_score),
      evidenceCount: dimension.evidence_count,
      lastEvidenceAt: dimension.last_evidence_at
    }))
  };
}

function requireCourseRow(courseId: string) {
  const row = getDatabase()
    .prepare("SELECT * FROM courses WHERE id = ? OR slug = ? LIMIT 1")
    .get(courseId, courseId) as CourseRow | undefined;
  if (!row) {
    throw new HttpError(404, "course_not_found", "Course not found.");
  }
  return row;
}

function getMasteryMap(userId: string, conceptIds?: string[]) {
  if (conceptIds && conceptIds.length === 0)
    return new Map<string, MasteryRow>();
  const rows = conceptIds
    ? (getDatabase()
        .prepare(
          `SELECT * FROM concept_mastery
           WHERE user_id = ? AND concept_id IN (${conceptIds.map(() => "?").join(",")})`
        )
        .all(userId, ...conceptIds) as MasteryRow[])
    : (getDatabase()
        .prepare("SELECT * FROM concept_mastery WHERE user_id = ?")
        .all(userId) as MasteryRow[]);
  return new Map(rows.map((row) => [row.concept_id, row]));
}

function getDimensionMasteryMap(userId: string, conceptIds?: string[]) {
  if (conceptIds && conceptIds.length === 0) {
    return new Map<string, DimensionMasteryRow[]>();
  }
  const rows = conceptIds
    ? (getDatabase()
        .prepare(
          `SELECT * FROM concept_mastery_dimensions
           WHERE user_id = ? AND concept_id IN (${conceptIds.map(() => "?").join(",")})
           ORDER BY dimension_id`
        )
        .all(userId, ...conceptIds) as DimensionMasteryRow[])
    : (getDatabase()
        .prepare(
          `SELECT * FROM concept_mastery_dimensions
           WHERE user_id = ? ORDER BY concept_id, dimension_id`
        )
        .all(userId) as DimensionMasteryRow[]);
  const mapped = new Map<string, DimensionMasteryRow[]>();
  for (const row of rows) {
    mapped.set(row.concept_id, [...(mapped.get(row.concept_id) ?? []), row]);
  }
  return mapped;
}

function selectedAttempts(
  coursePackage: ForgeCoursePackage,
  courseId: string,
  userId: string
) {
  const carriedActivityIds = carriedActivityIdsForRelease(
    courseId,
    userId,
    coursePackage.course.version
  );
  const carriedClause = carriedActivityIds.length
    ? ` OR a.activity_id IN (${carriedActivityIds.map(() => "?").join(",")})`
    : "";
  const attempts = getDatabase()
    .prepare(
      `SELECT a.activity_id, a.lesson_id, a.score, a.submitted_at,
              s.verdict
       FROM course_attempts a
       JOIN course_assessments s ON s.attempt_id = a.id
       WHERE a.course_id = ? AND (a.course_version = ?${carriedClause})
         AND a.user_id = ? AND a.status = 'assessed'
       ORDER BY a.submitted_at ASC, a.rowid ASC`
    )
    .all(
      courseId,
      coursePackage.course.version,
      ...carriedActivityIds,
      userId
    ) as Array<{
    activity_id: string;
    lesson_id: string;
    score: number;
    submitted_at: string;
    verdict: CourseAssessmentFeedback["verdict"];
  }>;
  const selected = new Map<string, (typeof attempts)[number]>();
  for (const attempt of attempts) {
    const previous = selected.get(attempt.activity_id);
    if (
      !previous ||
      coursePackage.grading.attemptAggregation === "latest" ||
      attempt.score > previous.score
    ) {
      selected.set(attempt.activity_id, attempt);
    }
  }
  return selected;
}

function carriedActivityIdsForRelease(
  courseId: string,
  userId: string,
  courseVersion: string
) {
  const receipt = getDatabase()
    .prepare(
      `SELECT carried_activity_ids_json
       FROM course_enrollment_upgrade_receipts
       WHERE course_id = ? AND user_id = ? AND to_version = ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(courseId, userId, courseVersion) as
    | { carried_activity_ids_json: string }
    | undefined;
  return receipt
    ? parseJson<string[]>(receipt.carried_activity_ids_json, [])
    : [];
}

function completedLessonIdSet(
  coursePackage: ForgeCoursePackage,
  selected: ReturnType<typeof selectedAttempts>
) {
  return new Set(
    coursePackage.lessons.flatMap((lesson) => {
      const requiredActivities = lesson.activities.filter(
        (activity) => activity.required
      );
      return requiredActivities.length > 0 &&
        requiredActivities.every(
          (activity) => selected.get(activity.id)?.verdict === "pass"
        )
        ? [lesson.id]
        : [];
    })
  );
}

function lessonAccessState(
  coursePackage: ForgeCoursePackage,
  courseId: string,
  userId: string
) {
  const completedLessonIds = completedLessonIdSet(
    coursePackage,
    selectedAttempts(coursePackage, courseId, userId)
  );
  const firstIncompleteIndex = coursePackage.lessons.findIndex(
    (lesson) => !completedLessonIds.has(lesson.id)
  );
  const frontierIndex =
    firstIncompleteIndex === -1
      ? Math.max(0, coursePackage.lessons.length - 1)
      : firstIncompleteIndex;
  // Course order is guidance, not an access-control boundary. Learners may
  // inspect and work on any day while Forge keeps the first incomplete lesson
  // as the recommended frontier.
  const accessibleLessonIds = new Set(
    coursePackage.lessons.map((lesson) => lesson.id)
  );
  return {
    completedLessonIds,
    accessibleLessonIds,
    frontierLessonId:
      coursePackage.lessons[frontierIndex]?.id ??
      coursePackage.course.entryLessonId
  };
}

type LearnerAttempt = {
  id: string;
  activityId: string;
  status: string;
  score: number | null;
  grade: string | null;
  pointsAwarded: number;
  answerMarkdown: string;
  submittedAt: string;
  deliveryMode: "visual" | "voice";
  lessonAttemptOrdinal: number;
  activityAttemptOrdinal: number;
  feedback: CourseAssessmentFeedback | null;
};

function latestLessonAttempts(
  coursePackage: ForgeCoursePackage,
  courseId: string,
  userId: string,
  lesson: CourseLesson
) {
  const carriedActivityIds = carriedActivityIdsForRelease(
    courseId,
    userId,
    coursePackage.course.version
  );
  const carriedClause = carriedActivityIds.length
    ? ` OR a.activity_id IN (${carriedActivityIds.map(() => "?").join(",")})`
    : "";
  return lesson.activities.map((activity): LearnerAttempt | null => {
    const attempt = getDatabase()
      .prepare(
        `SELECT a.*, s.feedback_json
         FROM course_attempts a
         LEFT JOIN course_assessments s ON s.attempt_id = a.id
         WHERE a.course_id = ?
           AND (a.course_version = ?${carriedClause})
           AND a.user_id = ? AND a.activity_id = ?
         ORDER BY a.submitted_at DESC, a.rowid DESC LIMIT 1`
      )
      .get(
        courseId,
        coursePackage.course.version,
        ...carriedActivityIds,
        userId,
        activity.id
      ) as
      | (JsonRecord & { feedback_json?: string | null })
      | undefined;
    return attempt
      ? {
          id: String(attempt.id),
          activityId: String(attempt.activity_id),
          status: String(attempt.status),
          score:
            typeof attempt.score === "number" ? attempt.score : null,
          grade: typeof attempt.grade === "string" ? attempt.grade : null,
          pointsAwarded:
            typeof attempt.points_awarded === "number"
              ? attempt.points_awarded
              : 0,
          answerMarkdown: String(attempt.answer_markdown),
          submittedAt: String(attempt.submitted_at),
          deliveryMode:
            attempt.delivery_mode === "voice" ? "voice" : "visual",
          lessonAttemptOrdinal: Number(attempt.lesson_attempt_ordinal),
          activityAttemptOrdinal: Number(attempt.activity_attempt_ordinal),
          feedback: attempt.feedback_json
            ? parseJson<CourseAssessmentFeedback | null>(
                attempt.feedback_json,
                null
              )
            : null
        }
      : null;
  });
}

function learnerLessonFrontier(
  lesson: CourseLesson,
  latestAttempts: Array<LearnerAttempt | null>
) {
  const checkpointBlocks = lesson.content.filter(
    (
      block
    ): block is Extract<
      (typeof lesson.content)[number],
      { type: "checkpoint" }
    > => block.type === "checkpoint"
  );
  if (checkpointBlocks.length === 0) {
    return {
      content: lesson.content,
      activities: lesson.activities,
      availableActivityIds: lesson.activities.map((activity) => activity.id),
      submittableActivityIds: lesson.activities.map((activity) => activity.id),
      blockedByActivityId: null as string | null
    };
  }

  const attemptByActivityId = new Map(
    latestAttempts.flatMap((attempt) =>
      attempt ? [[attempt.activityId, attempt] as const] : []
    )
  );
  const availableActivityIds = new Set(
    lesson.activities.map((activity) => activity.id)
  );
  const submittableActivityIds = new Set(
    lesson.activities.map((activity) => activity.id)
  );
  let blockedByActivityId: string | null = null;
  for (const block of lesson.content) {
    if (block.type !== "checkpoint") continue;
    const attempt = attemptByActivityId.get(block.activityId);
    const remediationAttempt = block.remediationActivityId
      ? attemptByActivityId.get(block.remediationActivityId)
      : null;
    const passed =
      attempt?.status === "assessed" &&
      attempt.feedback?.verdict === "pass";
    const remediationPassed =
      remediationAttempt?.status === "assessed" &&
      remediationAttempt.feedback?.verdict === "pass";
    const reviewed =
      attempt?.status === "assessed" && attempt.feedback !== null;
    const mayContinue =
      block.continuation === "always" ||
      (block.continuation === "after_review" && reviewed) ||
      (block.continuation === "after_pass" && passed) ||
      (block.continuation === "after_remediation" &&
        (passed || remediationPassed));
    if (!mayContinue && blockedByActivityId === null) {
      blockedByActivityId = block.activityId;
    }
  }

  return {
    content: lesson.content,
    activities: lesson.activities,
    availableActivityIds: [...availableActivityIds],
    submittableActivityIds: [...submittableActivityIds],
    blockedByActivityId
  };
}

function courseProgress(courseId: string, userId: string) {
  const courseRow = requireCourseRow(courseId);
  const coursePackage = coursePackageForUser(courseRow, userId);
  const selected = selectedAttempts(coursePackage, courseRow.id, userId);
  const completed = completedLessonIdSet(coursePackage, selected).size;
  const total = coursePackage.lessons.length;
  const selectedScores = [...selected.values()].map((entry) => entry.score);
  const averageScore = selectedScores.length
    ? selectedScores.reduce((sum, score) => sum + score, 0) /
      selectedScores.length
    : null;
  const enrollment = getDatabase()
    .prepare(
      `SELECT current_lesson_id, points_earned
       FROM course_enrollments WHERE course_id = ? AND user_id = ?`
    )
    .get(courseId, userId) as
    | { current_lesson_id: string | null; points_earned: number }
    | undefined;
  return {
    completedLessons: completed,
    totalLessons: total,
    progressPercent: total > 0 ? Math.round((completed / total) * 100) : 0,
    averageScore: averageScore === null ? null : Math.round(averageScore),
    grade:
      averageScore === null
        ? null
        : scoreToLetterGrade(averageScore, coursePackage.grading.gradeScale),
    pointsEarned: enrollment?.points_earned ?? 0,
    currentLessonId: enrollment?.current_lesson_id ?? null
  };
}

export function importCoursePackage(input: unknown) {
  const parsedPackage = defineCoursePackage(
    forgeCoursePackageSchema.parse(input)
  );
  const computedHash = packageContentHash(parsedPackage);
  if (
    parsedPackage.provenance.contentHash &&
    parsedPackage.provenance.contentHash !== computedHash
  ) {
    throw new HttpError(
      422,
      "course_content_hash_mismatch",
      "The course package content does not match its declared SHA-256 hash."
    );
  }
  const coursePackage = parsedPackage.provenance.contentHash
    ? parsedPackage
    : defineCoursePackage({
        ...parsedPackage,
        provenance: { ...parsedPackage.provenance, contentHash: computedHash }
      });
  const database = getDatabase();
  const now = nowIso();
  const existingCourse = database
    .prepare("SELECT * FROM courses WHERE id = ?")
    .get(coursePackage.course.id) as CourseRow | undefined;
  const existingCoursePackage = existingCourse
    ? parseCoursePackage(existingCourse)
    : null;
  const conceptUpgradeById = new Map(
    (coursePackage.conceptUpgrades ?? []).map((upgrade) => [
      upgrade.conceptId,
      upgrade
    ])
  );
  const slugOwner = database
    .prepare("SELECT id FROM courses WHERE slug = ? AND id <> ?")
    .get(coursePackage.course.slug, coursePackage.course.id) as
    | { id: string }
    | undefined;
  if (slugOwner) {
    throw new HttpError(
      409,
      "course_slug_conflict",
      `Course slug ${coursePackage.course.slug} is already owned by ${slugOwner.id}.`
    );
  }
  const sameVersionRelease = database
    .prepare(
      `SELECT content_hash FROM course_releases
       WHERE course_id = ? AND version = ?`
    )
    .get(coursePackage.course.id, coursePackage.course.version) as
    | { content_hash: string }
    | undefined;
  if (sameVersionRelease && sameVersionRelease.content_hash !== computedHash) {
    throw new HttpError(
      409,
      "course_release_version_immutable",
      `Course release ${coursePackage.course.version} already exists with different content. Publish a new version.`
    );
  }
  for (const conceptRef of coursePackage.conceptRefs) {
    const existing = database
      .prepare("SELECT id, content_hash FROM concepts WHERE id = ?")
      .get(conceptRef.id) as { id: string; content_hash: string } | undefined;
    if (!existing) {
      throw new HttpError(
        422,
        "course_concept_dependency_missing",
        `The shared concept ${conceptRef.id} is not installed.`
      );
    }
    if (conceptRef.sourceCourseId) {
      const sourceCourse = database
        .prepare(
          `SELECT courses.version FROM course_concepts
           JOIN courses ON courses.id = course_concepts.course_id
           WHERE course_concepts.concept_id = ? AND courses.id = ?`
        )
        .get(conceptRef.id, conceptRef.sourceCourseId) as
        | { version: string }
        | undefined;
      if (!sourceCourse) {
        throw new HttpError(
          422,
          "course_concept_source_missing",
          `Concept ${conceptRef.id} is not supplied by ${conceptRef.sourceCourseId}.`
        );
      }
      if (
        conceptRef.sourceCourseVersion &&
        sourceCourse.version !== conceptRef.sourceCourseVersion
      ) {
        throw new HttpError(
          409,
          "course_concept_source_version_conflict",
          `Concept ${conceptRef.id} requires ${conceptRef.sourceCourseId} version ${conceptRef.sourceCourseVersion}.`
        );
      }
    }
    if (
      conceptRef.expectedContentHash &&
      conceptRef.expectedContentHash !== existing.content_hash
    ) {
      throw new HttpError(
        409,
        "course_concept_dependency_conflict",
        `The installed definition of ${conceptRef.id} does not match the package dependency.`
      );
    }
  }

  for (const concept of coursePackage.concepts) {
    const hash = conceptContentHash(concept);
    const conceptSlugOwner = database
      .prepare("SELECT id FROM concepts WHERE slug = ? AND id <> ?")
      .get(concept.slug, concept.id) as { id: string } | undefined;
    if (conceptSlugOwner) {
      throw new HttpError(
        409,
        "course_concept_slug_conflict",
        `Concept slug ${concept.slug} is already owned by ${conceptSlugOwner.id}.`
      );
    }
    const existing = database
      .prepare("SELECT content_hash FROM concepts WHERE id = ?")
      .get(concept.id) as { content_hash: string } | undefined;
    if (!existing || existing.content_hash === hash) continue;
    const declaredUpgrade = conceptUpgradeById.get(concept.id);
    if (declaredUpgrade) {
      if (declaredUpgrade.fromContentHash !== existing.content_hash) {
        throw new HttpError(
          409,
          "course_concept_upgrade_source_conflict",
          `Concept ${concept.id} no longer matches the declared prior definition.`
        );
      }
      const previousDefinition = existingCoursePackage?.concepts.find(
        (entry) => entry.id === concept.id
      );
      if (
        !previousDefinition ||
        conceptContentHash(previousDefinition) !== existing.content_hash
      ) {
        throw new HttpError(
          409,
          "course_concept_upgrade_not_owner",
          `Course ${coursePackage.course.id} cannot upgrade concept ${concept.id} because its installed release does not own the current definition.`
        );
      }
      continue;
    }
    const linkedElsewhere = (
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM course_concepts
           WHERE concept_id = ? AND course_id <> ?`
        )
        .get(concept.id, coursePackage.course.id) as { count: number }
    ).count;
    const evidenceCount = (
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM concept_evidence WHERE concept_id = ?"
        )
        .get(concept.id) as { count: number }
    ).count;
    if (linkedElsewhere > 0 || evidenceCount > 0) {
      throw new HttpError(
        409,
        "course_concept_definition_conflict",
        `Concept ${concept.id} already has a different canonical definition. Reference it with conceptRefs or publish an explicit concept upgrade.`
      );
    }
  }

  runInTransaction(() => {
    for (const concept of coursePackage.concepts) {
      const declaredUpgrade = conceptUpgradeById.get(concept.id);
      if (!declaredUpgrade) continue;
      const installed = database
        .prepare("SELECT content_hash FROM concepts WHERE id = ?")
        .get(concept.id) as { content_hash: string } | undefined;
      const nextContentHash = conceptContentHash(concept);
      if (!installed || installed.content_hash === nextContentHash) continue;
      const previousDefinition = existingCoursePackage?.concepts.find(
        (entry) => entry.id === concept.id
      );
      if (!previousDefinition) {
        throw new HttpError(
          409,
          "course_concept_upgrade_not_owner",
          `Course ${coursePackage.course.id} cannot upgrade concept ${concept.id}.`
        );
      }
      database
        .prepare(
          `INSERT OR IGNORE INTO course_concept_revisions (
             concept_id, content_hash, definition_json, source_course_id,
             source_course_version, replaced_by_content_hash, reason,
             upgraded_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          concept.id,
          installed.content_hash,
          JSON.stringify(previousDefinition),
          coursePackage.course.id,
          coursePackage.course.version,
          nextContentHash,
          declaredUpgrade.reason,
          now
        );
    }
    if (existingCourse) {
      database
        .prepare(
          `INSERT OR IGNORE INTO course_releases (
             course_id, version, content_hash, definition_json, published_at
           ) VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          existingCourse.id,
          existingCourse.version,
          existingCourse.content_hash,
          existingCourse.definition_json,
          existingCourse.created_at
        );
    }
    database
      .prepare(
        `INSERT INTO courses (
          id, slug, version, schema_version, title, subtitle, description,
          language, authors_json, license, estimated_weeks, minutes_per_week,
          tags_json, entry_lesson_id, featured_lesson_id, source_url,
          content_hash, definition_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          slug = excluded.slug,
          version = excluded.version,
          schema_version = excluded.schema_version,
          title = excluded.title,
          subtitle = excluded.subtitle,
          description = excluded.description,
          language = excluded.language,
          authors_json = excluded.authors_json,
          license = excluded.license,
          estimated_weeks = excluded.estimated_weeks,
          minutes_per_week = excluded.minutes_per_week,
          tags_json = excluded.tags_json,
          entry_lesson_id = excluded.entry_lesson_id,
          featured_lesson_id = excluded.featured_lesson_id,
          source_url = excluded.source_url,
          content_hash = excluded.content_hash,
          definition_json = excluded.definition_json,
          updated_at = excluded.updated_at`
      )
      .run(
        coursePackage.course.id,
        coursePackage.course.slug,
        coursePackage.course.version,
        coursePackage.schemaVersion,
        coursePackage.course.title,
        coursePackage.course.subtitle,
        coursePackage.course.description,
        coursePackage.course.language,
        JSON.stringify(coursePackage.course.authors),
        coursePackage.course.license,
        coursePackage.course.estimatedWeeks,
        coursePackage.course.minutesPerWeek,
        JSON.stringify(coursePackage.course.tags),
        coursePackage.course.entryLessonId,
        coursePackage.course.featuredLessonId ?? null,
        coursePackage.course.sourceUrl ?? null,
        computedHash,
        JSON.stringify(coursePackage),
        now,
        now
      );
    database
      .prepare(
        `INSERT OR IGNORE INTO course_releases (
           course_id, version, content_hash, definition_json, published_at
         ) VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        coursePackage.course.id,
        coursePackage.course.version,
        computedHash,
        JSON.stringify(coursePackage),
        now
      );

    const upsertConcept = database.prepare(
      `INSERT INTO concepts (
        id, slug, title, summary, definition_markdown, example_markdown,
        non_example_markdown, prerequisite_ids_json, related_ids_json,
        content_hash, tags_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        slug = excluded.slug,
        title = excluded.title,
        summary = excluded.summary,
        definition_markdown = excluded.definition_markdown,
        example_markdown = excluded.example_markdown,
        non_example_markdown = excluded.non_example_markdown,
        prerequisite_ids_json = excluded.prerequisite_ids_json,
        related_ids_json = excluded.related_ids_json,
        content_hash = excluded.content_hash,
        tags_json = excluded.tags_json,
        updated_at = excluded.updated_at`
    );
    const linkConcept = database.prepare(
      `INSERT INTO course_concepts (
         course_id, concept_id, order_index, status, delivery_owner
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(course_id, concept_id) DO UPDATE SET
         order_index = excluded.order_index,
         status = excluded.status,
         delivery_owner = excluded.delivery_owner`
    );
    coursePackage.concepts.forEach((concept, index) => {
      upsertConcept.run(
        concept.id,
        concept.slug,
        concept.title,
        concept.summary,
        concept.definitionMarkdown,
        concept.exampleMarkdown,
        concept.nonExampleMarkdown,
        JSON.stringify(concept.prerequisiteConceptIds),
        JSON.stringify(concept.relatedConceptIds),
        conceptContentHash(concept),
        JSON.stringify(concept.tags),
        now,
        now
      );
      linkConcept.run(
        coursePackage.course.id,
        concept.id,
        index,
        concept.defaultStatus,
        concept.deliveryOwner
      );
    });
    coursePackage.conceptRefs.forEach((conceptRef, index) => {
      linkConcept.run(
        coursePackage.course.id,
        conceptRef.id,
        coursePackage.concepts.length + index,
        conceptRef.status,
        conceptRef.deliveryOwner
      );
    });

    const upsertModule = database.prepare(
      `INSERT INTO course_modules (
        course_id, id, title, description, order_index, start_week, end_week,
        definition_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(course_id, id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        order_index = excluded.order_index,
        start_week = excluded.start_week,
        end_week = excluded.end_week,
        definition_json = excluded.definition_json`
    );
    for (const module of coursePackage.modules) {
      upsertModule.run(
        coursePackage.course.id,
        module.id,
        module.title,
        module.description,
        module.order,
        module.startWeek,
        module.endWeek,
        JSON.stringify(module)
      );
    }

    const upsertLesson = database.prepare(
      `INSERT INTO course_lessons (
        course_id, id, module_id, week, day, order_index, title, summary,
        estimated_minutes, definition_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(course_id, id) DO UPDATE SET
        module_id = excluded.module_id,
        week = excluded.week,
        day = excluded.day,
        order_index = excluded.order_index,
        title = excluded.title,
        summary = excluded.summary,
        estimated_minutes = excluded.estimated_minutes,
        definition_json = excluded.definition_json`
    );
    for (const lesson of coursePackage.lessons) {
      upsertLesson.run(
        coursePackage.course.id,
        lesson.id,
        lesson.moduleId,
        lesson.week,
        lesson.day,
        lesson.order,
        lesson.title,
        lesson.summary,
        lesson.estimatedMinutes,
        JSON.stringify(lesson)
      );
    }
  });
  return {
    course: toCourse(requireCourseRow(coursePackage.course.id)),
    imported: {
      conceptsDefined: coursePackage.concepts.length,
      conceptsReferenced: coursePackage.conceptRefs.length,
      concepts:
        coursePackage.concepts.length + coursePackage.conceptRefs.length,
      modules: coursePackage.modules.length,
      lessons: coursePackage.lessons.length
    }
  };
}

export function exportCoursePackage(courseId: string) {
  const row = requireCourseRow(courseId);
  const coursePackage = parseCoursePackage(row);
  const computedHash = packageContentHash(coursePackage);
  if (computedHash !== row.content_hash) {
    throw new HttpError(
      500,
      "course_export_integrity_failure",
      "The stored course package failed its integrity check."
    );
  }
  return coursePackage;
}

export function ensureBuiltInCourses() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const catalogDir = path.resolve(moduleDir, "..", "course-catalog");
  if (!existsSync(catalogDir)) return [];
  const packages = readdirSync(catalogDir)
    .filter((file) => file.endsWith(".forge-course.json"))
    .sort()
    .map((file) => {
      const parsed = forgeCoursePackageSchema.parse(JSON.parse(
        readFileSync(path.join(catalogDir, file), "utf8")
      ));
      return parsed;
    })
    .sort(
      (left, right) =>
        left.conceptRefs.length - right.conceptRefs.length ||
        left.course.id.localeCompare(right.course.id)
    );
  return packages.map((coursePackage) =>
    importCoursePackage(coursePackage).course
  );
}

export function listCourses(userId: string) {
  const rows = getDatabase()
    .prepare("SELECT * FROM courses ORDER BY title COLLATE NOCASE")
    .all() as CourseRow[];
  return rows.map((row) => ({
    ...toCourse(row),
    progress: courseProgress(row.id, userId)
  }));
}

export type CourseEnrollmentUpgradeReceipt =
  | {
      upgraded: false;
      fromVersion: string;
      toVersion: string;
      carriedActivityIds: string[];
      remainingActivityIds: string[];
    }
  | {
      upgraded: true;
      receiptId: string;
      fromVersion: string;
      toVersion: string;
      carriedActivityIds: string[];
      remainingActivityIds: string[];
    };

export function upgradeCourseEnrollment(
  courseId: string,
  userId: string
): CourseEnrollmentUpgradeReceipt {
  const courseRow = requireCourseRow(courseId);
  const database = getDatabase();
  const enrollment = database
    .prepare(
      `SELECT course_version, current_lesson_id
       FROM course_enrollments
       WHERE course_id = ? AND user_id = ?`
    )
    .get(courseRow.id, userId) as
    | { course_version: string; current_lesson_id: string | null }
    | undefined;
  if (!enrollment) {
    throw new HttpError(
      404,
      "course_enrollment_not_found",
      "Start the course before requesting a release upgrade."
    );
  }
  if (enrollment.course_version === courseRow.version) {
    return {
      upgraded: false,
      fromVersion: courseRow.version,
      toVersion: courseRow.version,
      carriedActivityIds: [],
      remainingActivityIds: []
    };
  }
  const nextPackage = parseCoursePackage(courseRow);
  const nextActivityHashes = new Map(
    nextPackage.lessons.flatMap((lesson) =>
      lesson.activities.map((activity) => [
        activity.id,
        createHash("sha256").update(stableJson(activity)).digest("hex")
      ])
    )
  );
  const previouslyCarriedActivityIds = carriedActivityIdsForRelease(
    courseRow.id,
    userId,
    enrollment.course_version
  );
  const previouslyCarriedClause = previouslyCarriedActivityIds.length
    ? ` OR a.activity_id IN (${previouslyCarriedActivityIds
        .map(() => "?")
        .join(",")})`
    : "";
  const passedAttempts = database
    .prepare(
      `SELECT a.activity_id, a.activity_content_hash
       FROM course_attempts a
       JOIN course_assessments s ON s.attempt_id = a.id
       WHERE a.course_id = ? AND a.user_id = ?
         AND (a.course_version = ?${previouslyCarriedClause})
         AND a.status = 'assessed' AND s.verdict = 'pass'
       ORDER BY a.submitted_at DESC, a.rowid DESC`
    )
    .all(
      courseRow.id,
      userId,
      enrollment.course_version,
      ...previouslyCarriedActivityIds
    ) as Array<{
    activity_id: string;
    activity_content_hash: string;
  }>;
  const carriedActivityIds = [
    ...new Set(
      passedAttempts.flatMap((attempt) =>
        attempt.activity_content_hash &&
        nextActivityHashes.get(attempt.activity_id) ===
          attempt.activity_content_hash
          ? [attempt.activity_id]
          : []
      )
    )
  ];
  const carried = new Set(carriedActivityIds);
  const remainingActivityIds = nextPackage.lessons.flatMap((lesson) =>
    lesson.activities
      .filter((activity) => activity.required && !carried.has(activity.id))
      .map((activity) => activity.id)
  );
  const now = nowIso();
  const receiptId = randomUUID();
  const nextLessonId =
    nextPackage.lessons.find((lesson) =>
      lesson.activities
        .filter((activity) => activity.required)
        .some((activity) => !carried.has(activity.id))
    )?.id ?? nextPackage.course.entryLessonId;
  runInTransaction(() => {
    database
      .prepare(
        `INSERT INTO course_enrollment_upgrade_receipts (
           id, course_id, user_id, from_version, to_version,
           carried_activity_ids_json, remaining_activity_ids_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        receiptId,
        courseRow.id,
        userId,
        enrollment.course_version,
        courseRow.version,
        JSON.stringify(carriedActivityIds),
        JSON.stringify(remainingActivityIds),
        now
      );
    database
      .prepare(
        `UPDATE course_enrollments
         SET course_version = ?, current_lesson_id = ?, updated_at = ?
         WHERE course_id = ? AND user_id = ?`
      )
      .run(courseRow.version, nextLessonId, now, courseRow.id, userId);
  });
  return {
    upgraded: true,
    receiptId,
    fromVersion: enrollment.course_version,
    toVersion: courseRow.version,
    carriedActivityIds,
    remainingActivityIds
  };
}

export function getCourseDetail(courseId: string, userId: string) {
  const row = requireCourseRow(courseId);
  const coursePackage = coursePackageForUser(row, userId);
  const completed = completedLessonIdSet(
    coursePackage,
    selectedAttempts(coursePackage, row.id, userId)
  );
  const access = lessonAccessState(coursePackage, row.id, userId);
  const concepts = listConcepts(userId, { courseId: row.id });
  return {
    course: toCourseFromPackage(row, coursePackage),
    release: {
      enrolledVersion: coursePackage.course.version,
      latestVersion: row.version,
      updateAvailable: coursePackage.course.version !== row.version
    },
    progress: courseProgress(row.id, userId),
    modules: coursePackage.modules,
    lessons: coursePackage.lessons.map((lesson) => ({
      id: lesson.id,
      moduleId: lesson.moduleId,
      week: lesson.week,
      day: lesson.day,
      order: lesson.order,
      title: lesson.title,
      summary: lesson.summary,
      estimatedMinutes: lesson.estimatedMinutes,
      conceptIds: lesson.conceptIds,
      completed: completed.has(lesson.id),
      unlocked: access.accessibleLessonIds.has(lesson.id)
    })),
    concepts,
    resources: coursePackage.resources
  };
}

export function getLearningSession(
  courseId: string,
  userId: string,
  requestedLessonId?: string
) {
  const courseRow = requireCourseRow(courseId);
  const coursePackage = coursePackageForUser(courseRow, userId);
  const progress = courseProgress(courseRow.id, userId);
  const access = lessonAccessState(coursePackage, courseRow.id, userId);
  const preferredLessonId = progress.currentLessonId;
  const lessonId =
    requestedLessonId ||
    (preferredLessonId && access.accessibleLessonIds.has(preferredLessonId)
      ? preferredLessonId
      : access.frontierLessonId);
  const lesson = coursePackage.lessons.find((entry) => entry.id === lessonId);
  if (!lesson) {
    throw new HttpError(404, "lesson_not_found", "Lesson not found.");
  }
  const navigationRows = coursePackage.lessons;
  const completedLessonIds = completedLessonIdSet(
    coursePackage,
    selectedAttempts(coursePackage, courseRow.id, userId)
  );
  const currentIndex = navigationRows.findIndex(
    (entry) => entry.id === lesson.id
  );
  const conceptIds = [
    ...new Set([
      ...lesson.conceptIds,
      ...lesson.activities.flatMap((activity) => activity.conceptIds)
    ])
  ];
  const mastery = getMasteryMap(userId, conceptIds);
  const dimensionMastery = getDimensionMasteryMap(userId, conceptIds);
  const conceptRows = conceptIds.length
    ? (getDatabase()
        .prepare(
          `SELECT concepts.*,
             (SELECT COUNT(*) FROM course_concepts cc WHERE cc.concept_id = concepts.id) AS course_count
           FROM concepts WHERE id IN (${conceptIds.map(() => "?").join(",")})`
        )
        .all(...conceptIds) as Array<{
        id: string;
        slug: string;
        title: string;
        summary: string;
        definition_markdown: string;
        example_markdown: string;
        non_example_markdown: string;
        prerequisite_ids_json: string;
        related_ids_json: string;
        tags_json: string;
        course_count: number;
      }>)
    : [];
  const conceptById = new Map(
    conceptRows.map((concept) => [concept.id, concept])
  );
  const latestAttempts = latestLessonAttempts(
    coursePackage,
    courseRow.id,
    userId,
    lesson
  );
  const frontier = learnerLessonFrontier(lesson, latestAttempts);
  const learnerLesson = toLearnerLesson({
    ...lesson,
    content: frontier.content,
    activities: frontier.activities
  });
  const visibleActivityIds = new Set(frontier.availableActivityIds);
  return {
    course: toCourseFromPackage(courseRow, coursePackage),
    release: {
      enrolledVersion: coursePackage.course.version,
      latestVersion: courseRow.version,
      updateAvailable: coursePackage.course.version !== courseRow.version
    },
    progress,
    lesson: learnerLesson,
    flow: {
      availableActivityIds: frontier.availableActivityIds,
      submittableActivityIds: frontier.submittableActivityIds,
      blockedByActivityId: frontier.blockedByActivityId,
      disclosure: "open_navigation_with_guidance"
    },
    resources: coursePackage.resources,
    modules: coursePackage.modules,
    navigation: navigationRows.map((entry) => ({
      id: entry.id,
      moduleId: entry.moduleId,
      week: entry.week,
      day: entry.day,
      order: entry.order,
      title: entry.title,
      completed: completedLessonIds.has(entry.id),
      unlocked: access.accessibleLessonIds.has(entry.id)
    })),
    previousLessonId:
      currentIndex > 0 ? navigationRows[currentIndex - 1]!.id : null,
    nextLessonId:
      currentIndex >= 0 && currentIndex < navigationRows.length - 1
        ? navigationRows[currentIndex + 1]!.id
        : null,
    concepts: conceptIds.flatMap((conceptId) => {
      const concept = conceptById.get(conceptId);
      if (!concept) return [];
      return [
        {
          id: concept.id,
          slug: concept.slug,
          title: concept.title,
          summary: concept.summary,
          definitionMarkdown: concept.definition_markdown,
          exampleMarkdown: concept.example_markdown,
          nonExampleMarkdown: concept.non_example_markdown,
          prerequisiteConceptIds: parseJson<string[]>(
            concept.prerequisite_ids_json,
            []
          ),
          relatedConceptIds: parseJson<string[]>(concept.related_ids_json, []),
          tags: parseJson<string[]>(concept.tags_json, []),
          courseCount: concept.course_count,
          mastery: toMastery(
            mastery.get(concept.id),
            dimensionMastery.get(concept.id)
          )
        }
      ];
    }),
    latestAttempts: latestAttempts.filter(
      (attempt): attempt is LearnerAttempt =>
        Boolean(attempt && visibleActivityIds.has(attempt.activityId))
    )
  };
}

export function createVoiceLearningSession(input: {
  courseId: string;
  userId: string;
  week: number;
  day: number;
}) {
  const courseRow = requireCourseRow(input.courseId);
  const coursePackage = coursePackageForUser(courseRow, input.userId);
  const lesson = coursePackage.lessons.find(
    (entry) => entry.week === input.week && entry.day === input.day
  );
  if (!lesson) {
    throw new HttpError(
      404,
      "course_lesson_not_found",
      `Week ${input.week}, day ${input.day} does not exist in this course.`
    );
  }
  const token = randomUUID();
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO course_voice_sessions (
        token, course_id, course_version, user_id, lesson_id, expires_at,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      token,
      courseRow.id,
      coursePackage.course.version,
      input.userId,
      lesson.id,
      expiresAt,
      createdAt
    );
  return {
    outline: getCourseDetail(courseRow.id, input.userId),
    session: getLearningSession(courseRow.id, input.userId, lesson.id),
    voice: {
      token,
      expiresAt,
      lessonId: lesson.id,
      deliveryPolicy: {
        contentOrder: "source_order",
        disclosure: "one_block_or_activity_at_a_time",
        answerFormatting:
          "You may add punctuation and paragraph breaks without changing words. Show Albert every proposed deletion, replacement, uncertain mathematical symbol, or uncertain recognition and obtain explicit confirmation. Preserve meaning, uncertainty, reasoning, and claims.",
        confirmation:
          "Read the complete formatted answer back and obtain Albert's explicit confirmation before submission.",
        persistence:
          "Submit only the confirmed answerMarkdown. Do not submit or store audio, recording metadata, or a separate voice transcript."
      }
    }
  };
}

export function listConcepts(
  userId: string,
  options: { courseId?: string; query?: string; dueOnly?: boolean } = {}
) {
  const conditions: string[] = [];
  const bindings: Array<string | number> = [];
  let join = "";
  if (options.courseId) {
    join = "JOIN course_concepts cc ON cc.concept_id = c.id";
    conditions.push("cc.course_id = ?");
    bindings.push(options.courseId);
  }
  if (options.query?.trim()) {
    conditions.push(
      "(c.title LIKE ? ESCAPE '\\' OR c.summary LIKE ? ESCAPE '\\' OR c.tags_json LIKE ? ESCAPE '\\')"
    );
    const escaped = options.query.trim().replace(/[\\%_]/gu, "\\$&");
    bindings.push(`%${escaped}%`, `%${escaped}%`, `%${escaped}%`);
  }
  if (options.dueOnly) {
    join +=
      " JOIN concept_mastery due ON due.concept_id = c.id AND due.user_id = ?";
    bindings.unshift(userId);
    conditions.push(
      "due.next_review_at IS NOT NULL AND due.next_review_at <= ?"
    );
    bindings.push(nowIso());
  }
  const rows = getDatabase()
    .prepare(
      `SELECT DISTINCT c.*,
        (SELECT COUNT(*) FROM course_concepts count_cc WHERE count_cc.concept_id = c.id) AS course_count
       FROM concepts c ${join}
       ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
       ORDER BY c.title COLLATE NOCASE`
    )
    .all(...bindings) as Array<{
    id: string;
    slug: string;
    title: string;
    summary: string;
    definition_markdown: string;
    example_markdown: string;
    non_example_markdown: string;
    prerequisite_ids_json: string;
    related_ids_json: string;
    tags_json: string;
    course_count: number;
  }>;
  const mastery = getMasteryMap(
    userId,
    rows.map((entry) => entry.id)
  );
  const dimensionMastery = getDimensionMasteryMap(
    userId,
    rows.map((entry) => entry.id)
  );
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    definitionMarkdown: row.definition_markdown,
    exampleMarkdown: row.example_markdown,
    nonExampleMarkdown: row.non_example_markdown,
    prerequisiteConceptIds: parseJson<string[]>(row.prerequisite_ids_json, []),
    relatedConceptIds: parseJson<string[]>(row.related_ids_json, []),
    tags: parseJson<string[]>(row.tags_json, []),
    courseCount: row.course_count,
    mastery: toMastery(mastery.get(row.id), dimensionMastery.get(row.id))
  }));
}

export function getConceptDetail(conceptId: string, userId: string) {
  const concept = listConcepts(userId).find(
    (entry) => entry.id === conceptId || entry.slug === conceptId
  );
  if (!concept) {
    throw new HttpError(404, "concept_not_found", "Concept not found.");
  }
  const courses = getDatabase()
    .prepare(
      `SELECT courses.* FROM courses
       JOIN course_concepts cc ON cc.course_id = courses.id
       WHERE cc.concept_id = ? ORDER BY courses.title COLLATE NOCASE`
    )
    .all(concept.id) as CourseRow[];
  const lessonRows = getDatabase()
    .prepare(
      `SELECT l.course_id, l.id, l.week, l.day, l.title, l.definition_json
       FROM course_lessons l
       JOIN course_concepts cc ON cc.course_id = l.course_id
       WHERE cc.concept_id = ? ORDER BY l.order_index`
    )
    .all(concept.id) as Array<{
    course_id: string;
    id: string;
    week: number;
    day: number;
    title: string;
    definition_json: string;
  }>;
  const lessons = lessonRows
    .filter((row) =>
      parseJson<CourseLesson>(
        row.definition_json,
        {} as CourseLesson
      ).conceptIds?.includes(concept.id)
    )
    .map((row) => ({
      courseId: row.course_id,
      id: row.id,
      week: row.week,
      day: row.day,
      title: row.title
    }))
    .slice(0, 24);
  const evidence = getDatabase()
    .prepare(
      `SELECT e.score, e.evidence_markdown, e.created_at, a.course_id,
              a.lesson_id, a.activity_id
       FROM concept_evidence e
       JOIN course_attempts a ON a.id = e.attempt_id
       WHERE e.user_id = ? AND e.concept_id = ?
       ORDER BY e.created_at DESC LIMIT 20`
    )
    .all(userId, concept.id) as Array<{
    score: number;
    evidence_markdown: string;
    created_at: string;
    course_id: string;
    lesson_id: string;
    activity_id: string;
  }>;
  return {
    concept,
    courses: courses.map((course) => ({
      ...toCourse(course),
      progress: courseProgress(course.id, userId)
    })),
    lessons,
    evidence: evidence.map((entry) => ({
      score: Math.round(entry.score),
      evidenceMarkdown: entry.evidence_markdown,
      createdAt: entry.created_at,
      courseId: entry.course_id,
      lessonId: entry.lesson_id,
      activityId: entry.activity_id
    }))
  };
}

export function createCourseAttempt(input: {
  courseId: string;
  lessonId: string;
  activityId: string;
  userId: string;
  answerMarkdown: string;
  deliveryMode?: "visual" | "voice";
  voiceSessionToken?: string;
  idempotencyKey?: string;
}) {
  const course = requireCourseRow(input.courseId);
  const coursePackage = coursePackageForUser(course, input.userId);
  const lesson = coursePackage.lessons.find(
    (entry) => entry.id === input.lessonId
  );
  if (!lesson) {
    throw new HttpError(404, "lesson_not_found", "Lesson not found.");
  }
  const activity = lesson.activities.find(
    (entry) => entry.id === input.activityId
  );
  if (!activity) {
    throw new HttpError(404, "activity_not_found", "Activity not found.");
  }
  const deliveryMode = input.deliveryMode ?? "visual";
  const requestContentHash = createHash("sha256")
    .update(
      stableJson({
        courseId: course.id,
        courseVersion: coursePackage.course.version,
        userId: input.userId,
        lessonId: lesson.id,
        activityId: activity.id,
        answerMarkdown: input.answerMarkdown,
        deliveryMode
      })
    )
    .digest("hex");
  if (input.idempotencyKey) {
    const existing = getDatabase()
      .prepare(
        `SELECT id, request_content_hash, delivery_mode,
                lesson_attempt_ordinal, activity_attempt_ordinal
         FROM course_attempts
         WHERE course_id = ? AND user_id = ?
           AND lesson_id = ? AND activity_id = ? AND idempotency_key = ?`
      )
      .get(
        course.id,
        input.userId,
        lesson.id,
        activity.id,
        input.idempotencyKey
      ) as
      | {
          id: string;
          request_content_hash: string;
          delivery_mode: "visual" | "voice";
          lesson_attempt_ordinal: number;
          activity_attempt_ordinal: number;
        }
      | undefined;
    if (existing) {
      if (existing.request_content_hash !== requestContentHash) {
        throw new HttpError(
          409,
          "course_attempt_idempotency_conflict",
          "This submission key was already used for a different answer, delivery mode, or enrolled course version."
        );
      }
      return {
        attemptId: existing.id,
        existing: true,
        deliveryMode: existing.delivery_mode,
        lessonAttemptOrdinal: existing.lesson_attempt_ordinal,
        activityAttemptOrdinal: existing.activity_attempt_ordinal,
        course: toCourseFromPackage(course, coursePackage),
        lesson,
        activity
      };
    }
  }
  if (deliveryMode === "voice") {
    const voiceSession = input.voiceSessionToken
      ? (getDatabase()
          .prepare(
            `SELECT course_id, course_version, user_id, lesson_id, expires_at
             FROM course_voice_sessions WHERE token = ?`
          )
          .get(input.voiceSessionToken) as
          | {
              course_id: string;
              course_version: string;
              user_id: string;
              lesson_id: string;
              expires_at: string;
            }
          | undefined)
      : undefined;
    if (
      !voiceSession ||
      voiceSession.course_id !== course.id ||
      voiceSession.course_version !== coursePackage.course.version ||
      voiceSession.user_id !== input.userId ||
      voiceSession.lesson_id !== lesson.id ||
      Date.parse(voiceSession.expires_at) <= Date.now()
    ) {
      throw new HttpError(
        409,
        "course_voice_session_invalid",
        "Start a new voice learning session for this learner and lesson before submitting."
      );
    }
  }
  const frontier = learnerLessonFrontier(
    lesson,
    latestLessonAttempts(coursePackage, course.id, input.userId, lesson)
  );
  const now = nowIso();
  const created = runInTransaction(() => {
    if (input.idempotencyKey) {
      const existing = getDatabase()
        .prepare(
          `SELECT id, request_content_hash, delivery_mode,
                  lesson_attempt_ordinal, activity_attempt_ordinal
           FROM course_attempts
           WHERE course_id = ? AND user_id = ?
             AND lesson_id = ? AND activity_id = ? AND idempotency_key = ?`
        )
        .get(
          course.id,
          input.userId,
          lesson.id,
          activity.id,
          input.idempotencyKey
        ) as
        | {
            id: string;
            request_content_hash: string;
            delivery_mode: "visual" | "voice";
            lesson_attempt_ordinal: number;
            activity_attempt_ordinal: number;
          }
        | undefined;
      if (existing) {
        if (existing.request_content_hash !== requestContentHash) {
          throw new HttpError(
            409,
            "course_attempt_idempotency_conflict",
            "This submission key was already used for a different answer, delivery mode, or enrolled course version."
          );
        }
        return {
          attemptId: existing.id,
          existing: true,
          deliveryMode: existing.delivery_mode,
          lessonAttemptOrdinal: existing.lesson_attempt_ordinal,
          activityAttemptOrdinal: existing.activity_attempt_ordinal
        };
      }
    }
    const attemptId = randomUUID();
    const ordinals = getDatabase()
      .prepare(
        `SELECT
           COALESCE(MAX(lesson_attempt_ordinal), 0) + 1
             AS lesson_attempt_ordinal,
           COALESCE(MAX(
             CASE WHEN activity_id = ? THEN activity_attempt_ordinal ELSE 0 END
           ), 0) + 1 AS activity_attempt_ordinal
         FROM course_attempts
         WHERE course_id = ? AND course_version = ? AND user_id = ?
           AND lesson_id = ?`
      )
      .get(
        activity.id,
        course.id,
        coursePackage.course.version,
        input.userId,
        lesson.id
      ) as {
      lesson_attempt_ordinal: number;
      activity_attempt_ordinal: number;
    };
    getDatabase()
      .prepare(
        `INSERT INTO course_enrollments (
          course_id, user_id, current_lesson_id, points_earned, enrolled_at,
          updated_at, course_version
        ) VALUES (?, ?, ?, 0, ?, ?, ?)
        ON CONFLICT(course_id, user_id) DO UPDATE SET
          updated_at = excluded.updated_at`
      )
      .run(
        course.id,
        input.userId,
        lesson.id,
        now,
        now,
        coursePackage.course.version
      );
    const activitySnapshot = stableJson(activity);
    const activityContentHash = createHash("sha256")
      .update(activitySnapshot)
      .digest("hex");
    getDatabase()
      .prepare(
        `INSERT INTO course_attempts (
          id, course_id, lesson_id, activity_id, activity_type, user_id,
          answer_markdown, status, score, grade, points_awarded,
          submitted_at, assessed_at, course_version, activity_revision,
          activity_content_hash, activity_snapshot_json, delivery_mode,
          lesson_attempt_ordinal, activity_attempt_ordinal, idempotency_key,
          request_content_hash
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, 'assessing', NULL, NULL, 0, ?, NULL,
          ?, ?, ?, ?, ?, ?, ?, ?, ?
        )`
      )
      .run(
        attemptId,
        course.id,
        lesson.id,
        activity.id,
        activity.type,
        input.userId,
        input.answerMarkdown,
        now,
        coursePackage.course.version,
        activity.revision,
        activityContentHash,
        activitySnapshot,
        deliveryMode,
        ordinals.lesson_attempt_ordinal,
        ordinals.activity_attempt_ordinal,
        input.idempotencyKey ?? null,
        requestContentHash
      );
    return {
      attemptId,
      existing: false,
      deliveryMode,
      lessonAttemptOrdinal: ordinals.lesson_attempt_ordinal,
      activityAttemptOrdinal: ordinals.activity_attempt_ordinal
    };
  });
  return {
    ...created,
    course: toCourseFromPackage(course, coursePackage),
    lesson,
    activity
  };
}

export function completeCourseAttempt(input: {
  attemptId: string;
  userId: string;
  activity: CourseActivity;
  feedback: CourseAssessmentFeedback;
  provider: string | null;
  model: string | null;
  nextLessonId: string | null;
}) {
  const attempt = getDatabase()
    .prepare("SELECT * FROM course_attempts WHERE id = ? AND user_id = ?")
    .get(input.attemptId, input.userId) as
    | {
        id: string;
        course_id: string;
        course_version: string;
        lesson_id: string;
        status: string;
        activity_content_hash: string;
        activity_snapshot_json: string;
        delivery_mode: "visual" | "voice";
        lesson_attempt_ordinal: number;
        activity_attempt_ordinal: number;
      }
    | undefined;
  if (!attempt) {
    throw new HttpError(404, "course_attempt_not_found", "Attempt not found.");
  }
  if (attempt.status !== "assessing") {
    throw new HttpError(
      409,
      "course_attempt_already_completed",
      "This course attempt has already been completed."
    );
  }
  const courseRow = requireCourseRow(attempt.course_id);
  const coursePackage = coursePackageByVersion(
    courseRow,
    attempt.course_version
  );
  const activity = courseActivitySchema.parse(
    parseJson<unknown>(attempt.activity_snapshot_json, {})
  );
  const computedActivityHash = createHash("sha256")
    .update(stableJson(activity))
    .digest("hex");
  if (computedActivityHash !== attempt.activity_content_hash) {
    throw new HttpError(
      409,
      "course_attempt_snapshot_invalid",
      "The saved activity snapshot no longer matches its integrity hash."
    );
  }
  const lesson = coursePackage.lessons.find(
    (entry) => entry.id === attempt.lesson_id
  );
  if (!lesson) {
    throw new HttpError(
      409,
      "course_attempt_lesson_snapshot_missing",
      "The lesson for this saved course attempt is unavailable."
    );
  }
  const nextLessonId =
    coursePackage.lessons.find((entry) => entry.order > lesson.order)?.id ??
    null;
  const assessed = input.feedback.score !== null;
  const assessmentProfile = coursePackage.grading.assessmentProfiles.find(
    (profile) => profile.id === activity.assessmentProfileId
  );
  const gradeScale =
    assessmentProfile?.gradeScale ?? coursePackage.grading.gradeScale;
  const allowedMisconceptionIds = new Set(
    coursePackage.grading.misconceptions.map((entry) => entry.id)
  );
  const normalizedFeedback: CourseAssessmentFeedback = {
    ...input.feedback,
    grade:
      input.feedback.score === null
        ? null
        : scoreToLetterGrade(input.feedback.score, gradeScale),
    misconceptionIds: input.feedback.misconceptionIds.filter((id) =>
      allowedMisconceptionIds.has(id)
    )
  };
  const prior = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(CASE WHEN s.verdict = 'pass' THEN 1 ELSE 0 END), 0)
                AS pass_count,
              MAX(a.score) AS best_score,
              MAX(points_awarded) AS best_points
       FROM course_attempts a
       JOIN course_assessments s ON s.attempt_id = a.id
       WHERE a.course_id = ? AND a.user_id = ? AND a.activity_id = ?
         AND a.activity_content_hash = ?
         AND a.status = 'assessed' AND a.id <> ?`
    )
    .get(
      attempt.course_id,
      input.userId,
      activity.id,
      attempt.activity_content_hash,
      input.attemptId
    ) as {
    count: number;
    pass_count: number;
    best_score: number | null;
    best_points: number | null;
  };
  const eligibleForPoints = assessed && normalizedFeedback.verdict === "pass";
  const possiblePoints = eligibleForPoints
    ? Math.max(
        0,
        Math.round((activity.points * normalizedFeedback.score!) / 100)
      )
    : 0;
  const points = !eligibleForPoints
    ? 0
    : coursePackage.grading.pointsPolicy === "positive_delta"
      ? Math.max(0, possiblePoints - (prior.best_points ?? 0))
      : prior.pass_count === 0
        ? possiblePoints
        : 0;
  const masteryImprovementEligible =
    assessed &&
    (prior.best_score === null || normalizedFeedback.score! > prior.best_score);
  const now = nowIso();
  runInTransaction(() => {
    getDatabase()
      .prepare(
        `UPDATE course_attempts SET
          status = ?, score = ?, grade = ?, points_awarded = ?, assessed_at = ?
         WHERE id = ?`
      )
      .run(
        assessed ? "assessed" : "needs_review",
        normalizedFeedback.score,
        normalizedFeedback.grade,
        points,
        now,
        input.attemptId
      );
    getDatabase()
      .prepare(
        `INSERT INTO course_assessments (
          id, attempt_id, verdict, feedback_json, provider, model, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        input.attemptId,
        normalizedFeedback.verdict,
        JSON.stringify(normalizedFeedback),
        input.provider,
        input.model,
        now
      );
    if (assessed) {
      const lessonCompleted = completedLessonIdSet(
        coursePackage,
        selectedAttempts(coursePackage, attempt.course_id, input.userId)
      ).has(lesson.id);
      getDatabase()
        .prepare(
          `UPDATE course_enrollments SET
           current_lesson_id = COALESCE(?, current_lesson_id),
            points_earned = points_earned + ?, updated_at = ?
           WHERE course_id = ? AND user_id = ? AND course_version = ?`
        )
        .run(
          lessonCompleted ? nextLessonId : null,
          points,
          now,
          attempt.course_id,
          input.userId,
          attempt.course_version
        );
    }
    if (assessed) {
      const scores = new Map(
        normalizedFeedback.conceptScores.map((entry) => [
          entry.conceptId,
          entry
        ])
      );
      for (const conceptId of activity.conceptIds) {
        const conceptScore = scores.get(conceptId) ?? {
          conceptId,
          score: normalizedFeedback.score!,
          evidence: normalizedFeedback.summary
        };
        const previous = getDatabase()
          .prepare(
            `SELECT * FROM concept_mastery WHERE user_id = ? AND concept_id = ?`
          )
          .get(input.userId, conceptId) as MasteryRow | undefined;
        const nextMastery = masteryImprovementEligible
          ? updateMastery(previous?.mastery_score ?? null, conceptScore.score)
          : (previous?.mastery_score ?? conceptScore.score);
        const successfulReviews =
          (previous?.successful_review_count ?? 0) +
          (conceptScore.score >= 70 ? 1 : 0);
        const interval = nextReviewIntervalDays({
          score: conceptScore.score,
          previousIntervalDays: previous?.review_interval_days ?? null,
          successfulReviewCount: previous?.successful_review_count ?? 0,
          scheduleDays: activity.reviewAfterDays
        });
        const reviewAt = new Date(
          Date.now() + interval * 86_400_000
        ).toISOString();
        const evidenceCount = (previous?.evidence_count ?? 0) + 1;
        const averageScore = previous
          ? (previous.average_score * previous.evidence_count +
              conceptScore.score) /
            evidenceCount
          : conceptScore.score;
        getDatabase()
          .prepare(
            `INSERT INTO concept_mastery (
              user_id, concept_id, mastery_score, average_score, evidence_count,
              successful_review_count, review_interval_days, next_review_at,
              last_evidence_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, concept_id) DO UPDATE SET
              mastery_score = excluded.mastery_score,
              average_score = excluded.average_score,
              evidence_count = excluded.evidence_count,
              successful_review_count = excluded.successful_review_count,
              review_interval_days = excluded.review_interval_days,
              next_review_at = excluded.next_review_at,
              last_evidence_at = excluded.last_evidence_at,
              updated_at = excluded.updated_at`
          )
          .run(
            input.userId,
            conceptId,
            nextMastery,
            averageScore,
            evidenceCount,
            successfulReviews,
            interval,
            reviewAt,
            now,
            now
          );
        getDatabase()
          .prepare(
            `INSERT INTO concept_evidence (
              attempt_id, concept_id, user_id, score, evidence_markdown, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(
            input.attemptId,
            conceptId,
            input.userId,
            conceptScore.score,
            conceptScore.evidence,
            now
          );

        for (const dimensionId of activity.masteryDimensionIds) {
          const previousDimension = getDatabase()
            .prepare(
              `SELECT mastery_score, average_score, evidence_count
               FROM concept_mastery_dimensions
               WHERE user_id = ? AND concept_id = ? AND dimension_id = ?`
            )
            .get(input.userId, conceptId, dimensionId) as
            | {
                mastery_score: number;
                average_score: number;
                evidence_count: number;
              }
            | undefined;
          const dimensionEvidenceCount =
            (previousDimension?.evidence_count ?? 0) + 1;
          const dimensionAverage = previousDimension
            ? (previousDimension.average_score *
                previousDimension.evidence_count +
                conceptScore.score) /
              dimensionEvidenceCount
            : conceptScore.score;
          const dimensionMastery = masteryImprovementEligible
            ? updateMastery(
                previousDimension?.mastery_score ?? null,
                conceptScore.score
              )
            : (previousDimension?.mastery_score ?? conceptScore.score);
          getDatabase()
            .prepare(
              `INSERT INTO concept_mastery_dimensions (
                user_id, concept_id, dimension_id, mastery_score, average_score,
                evidence_count, last_evidence_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(user_id, concept_id, dimension_id) DO UPDATE SET
                mastery_score = excluded.mastery_score,
                average_score = excluded.average_score,
                evidence_count = excluded.evidence_count,
                last_evidence_at = excluded.last_evidence_at,
                updated_at = excluded.updated_at`
            )
            .run(
              input.userId,
              conceptId,
              dimensionId,
              dimensionMastery,
              dimensionAverage,
              dimensionEvidenceCount,
              now,
              now
            );
          getDatabase()
            .prepare(
              `INSERT INTO concept_dimension_evidence (
                attempt_id, concept_id, dimension_id, user_id, score,
                evidence_markdown, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              input.attemptId,
              conceptId,
              dimensionId,
              input.userId,
              conceptScore.score,
              conceptScore.evidence,
              now
            );
        }

        for (const misconceptionId of normalizedFeedback.misconceptionIds) {
          getDatabase()
            .prepare(
              `INSERT INTO learner_misconceptions (
                user_id, concept_id, misconception_id, first_observed_at,
                last_observed_at, resolved_at, evidence_count
              ) VALUES (?, ?, ?, ?, ?, NULL, 1)
              ON CONFLICT(user_id, concept_id, misconception_id) DO UPDATE SET
                last_observed_at = excluded.last_observed_at,
                resolved_at = NULL,
                evidence_count = learner_misconceptions.evidence_count + 1`
            )
            .run(input.userId, conceptId, misconceptionId, now, now);
        }
      }
    }
  });
  const updatedAccess = lessonAccessState(
    coursePackage,
    attempt.course_id,
    input.userId
  );
  const unlockedNextLessonId =
    nextLessonId && updatedAccess.accessibleLessonIds.has(nextLessonId)
      ? nextLessonId
      : null;
  return {
    attemptId: input.attemptId,
    status: assessed ? "assessed" : "needs_review",
    score: normalizedFeedback.score,
    grade: normalizedFeedback.grade,
    pointsAwarded: points,
    feedback: normalizedFeedback,
    deliveryMode: attempt.delivery_mode,
    lessonAttemptOrdinal: attempt.lesson_attempt_ordinal,
    activityAttemptOrdinal: attempt.activity_attempt_ordinal,
    progress: courseProgress(attempt.course_id, input.userId),
    nextLessonId: unlockedNextLessonId
  };
}

export function getCourseAttemptResult(attemptId: string, userId: string) {
  const row = getDatabase()
    .prepare(
      `SELECT a.*, s.feedback_json
       FROM course_attempts a
       LEFT JOIN course_assessments s ON s.attempt_id = a.id
       WHERE a.id = ? AND a.user_id = ?`
    )
    .get(attemptId, userId) as
    | (JsonRecord & {
        course_id: string;
        course_version: string;
        lesson_id: string;
        status: "assessing" | "assessed" | "needs_review";
        score: number | null;
        grade: string | null;
        points_awarded: number;
        delivery_mode: "visual" | "voice";
        lesson_attempt_ordinal: number;
        activity_attempt_ordinal: number;
        feedback_json?: string | null;
      })
    | undefined;
  if (!row) {
    throw new HttpError(404, "course_attempt_not_found", "Attempt not found.");
  }
  const courseRow = requireCourseRow(row.course_id);
  const coursePackage = coursePackageByVersion(
    courseRow,
    row.course_version
  );
  const access = lessonAccessState(coursePackage, row.course_id, userId);
  const lessonIndex = coursePackage.lessons.findIndex(
    (lesson) => lesson.id === row.lesson_id
  );
  const candidateNextLessonId =
    lessonIndex >= 0 ? coursePackage.lessons[lessonIndex + 1]?.id : undefined;
  return {
    attemptId,
    status: row.status,
    score: row.score,
    grade: row.grade,
    pointsAwarded: row.points_awarded,
    feedback: row.feedback_json
      ? parseJson<CourseAssessmentFeedback | null>(row.feedback_json, null)
      : null,
    deliveryMode: row.delivery_mode,
    lessonAttemptOrdinal: row.lesson_attempt_ordinal,
    activityAttemptOrdinal: row.activity_attempt_ordinal,
    progress: courseProgress(row.course_id, userId),
    nextLessonId:
      candidateNextLessonId &&
      access.accessibleLessonIds.has(candidateNextLessonId)
        ? candidateNextLessonId
        : null
  };
}

export function getActivityForAssessment(
  courseId: string,
  lessonId: string,
  activityId: string,
  userId: string
) {
  const course = requireCourseRow(courseId);
  const coursePackage = coursePackageForUser(course, userId);
  const lesson = coursePackage.lessons.find((entry) => entry.id === lessonId);
  if (!lesson) {
    throw new HttpError(404, "lesson_not_found", "Lesson not found.");
  }
  const activity = lesson.activities.find((entry) => entry.id === activityId);
  if (!activity) {
    throw new HttpError(404, "activity_not_found", "Activity not found.");
  }
  const next = coursePackage.lessons.find(
    (entry) => entry.order > lesson.order
  );
  const conceptRows = getDatabase()
    .prepare(
      `SELECT * FROM concepts WHERE id IN (${activity.conceptIds.map(() => "?").join(",")})`
    )
    .all(...activity.conceptIds) as Array<{
    id: string;
    title: string;
    summary: string;
    definition_markdown: string;
  }>;
  return {
    course: toCourseFromPackage(course, coursePackage),
    lesson,
    activity,
    gradeScale:
      coursePackage.grading.assessmentProfiles.find(
        (profile) => profile.id === activity.assessmentProfileId
      )?.gradeScale ?? coursePackage.grading.gradeScale,
    allowedMisconceptionIds: coursePackage.grading.misconceptions.map(
      (entry) => entry.id
    ),
    concepts: conceptRows.map((row) => ({
      id: row.id,
      title: row.title,
      summary: row.summary,
      definitionMarkdown: row.definition_markdown
    })),
    nextLessonId: next?.id ?? null
  };
}

export function buildAutomaticMultipleChoiceFeedback(
  activity: Extract<CourseActivity, { type: "multiple_choice" }>,
  answerMarkdown: string,
  gradeScale?: ReadonlyArray<{ minimum: number; label: string }>
): CourseAssessmentFeedback {
  const submitted = new Set(
    answerMarkdown
      .split(/[\s,]+/u)
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
  const expected = new Set(activity.correctOptionIds);
  const correct =
    submitted.size === expected.size &&
    [...expected].every((optionId) => submitted.has(optionId));
  const score = correct ? 100 : 0;
  return {
    verdict: correct ? "pass" : "revise",
    score,
    grade: scoreToLetterGrade(score, gradeScale),
    summary: correct ? "Correct." : "That selection is not yet correct.",
    strengths: correct
      ? ["The selected option matches the mathematical condition."]
      : [],
    issues: correct ? [] : [activity.explanationMarkdown],
    lineFeedback: [],
    criterionScores: [],
    nextStep: correct
      ? "Continue to the next activity."
      : "Use the explanation and try again.",
    conceptScores: activity.conceptIds.map((conceptId) => ({
      conceptId,
      score,
      evidence: correct
        ? "Correct multiple-choice response."
        : "Incorrect multiple-choice response."
    })),
    misconceptionIds: []
  };
}

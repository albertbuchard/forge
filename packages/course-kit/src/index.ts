import { z } from "zod";

export const stableIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/u);

const nonEmptyTextSchema = z.string().trim().min(1);
const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema)
  ])
);

export const DEFAULT_GRADE_SCALE = [
  { minimum: 97, label: "A+" },
  { minimum: 93, label: "A" },
  { minimum: 90, label: "A-" },
  { minimum: 87, label: "B+" },
  { minimum: 83, label: "B" },
  { minimum: 80, label: "B-" },
  { minimum: 77, label: "C+" },
  { minimum: 73, label: "C" },
  { minimum: 70, label: "C-" },
  { minimum: 60, label: "D" },
  { minimum: 0, label: "F" }
] as const;

export const DEFAULT_MASTERY_DIMENSIONS = [
  {
    id: "conceptual_understanding",
    label: "Conceptual understanding",
    description: "Definitions, relationships, examples, and nonexamples.",
    weight: 0.25
  },
  {
    id: "proof_reasoning",
    label: "Proof reasoning",
    description: "Logical structure, theorem use, and justified claims.",
    weight: 0.35
  },
  {
    id: "procedural_fluency",
    label: "Procedural fluency",
    description: "Reliable execution of calculations and standard methods.",
    weight: 0.2
  },
  {
    id: "transfer",
    label: "Transfer",
    description: "Choosing and adapting ideas in unfamiliar situations.",
    weight: 0.2
  }
] as const;

export const courseContentBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("markdown"),
    markdown: nonEmptyTextSchema
  }),
  z.object({
    type: z.literal("math"),
    latex: nonEmptyTextSchema,
    display: z.boolean().default(true),
    label: z.string().trim().default("")
  }),
  z.object({
    type: z.literal("callout"),
    tone: z.enum(["definition", "theorem", "warning", "intuition", "evidence"]),
    title: nonEmptyTextSchema,
    markdown: nonEmptyTextSchema
  }),
  z.object({
    type: z.literal("divider"),
    label: z.string().trim().max(120).default("")
  }),
  z.object({
    type: z.literal("resource"),
    resourceId: stableIdSchema,
    presentation: z.enum(["link", "card", "embed"]).default("link")
  }),
  z.object({
    type: z.literal("checkpoint"),
    activityId: stableIdSchema,
    title: nonEmptyTextSchema.max(180),
    introMarkdown: z.string().trim().default(""),
    continuation: z.enum([
      "after_pass",
      "after_remediation",
      "after_review",
      "always"
    ]),
    remediationActivityId: stableIdSchema.optional()
  }),
  z.object({
    type: z.literal("extension"),
    namespace: stableIdSchema,
    renderer: stableIdSchema,
    version: z.string().trim().min(1).max(40).default("1"),
    data: jsonValueSchema
  })
]);

export const proofRubricCriterionSchema = z.object({
  id: stableIdSchema,
  label: nonEmptyTextSchema.max(120),
  description: nonEmptyTextSchema.max(1_200),
  weight: z.number().positive().max(1),
  masteryDimensionIds: z.array(stableIdSchema).default([]),
  misconceptionIds: z.array(stableIdSchema).default([])
});

const activityBaseSchema = z.object({
  id: stableIdSchema,
  title: nonEmptyTextSchema.max(180),
  promptMarkdown: nonEmptyTextSchema,
  conceptIds: z.array(stableIdSchema).min(1),
  masteryDimensionIds: z
    .array(stableIdSchema)
    .min(1)
    .default(["conceptual_understanding"]),
  competencyIds: z.array(stableIdSchema).default([]),
  assessmentProfileId: stableIdSchema.default("default"),
  points: z.number().int().min(0).max(1_000),
  estimatedMinutes: z.number().int().positive().max(480),
  required: z.boolean().default(true),
  templateId: stableIdSchema.optional(),
  reviewAfterDays: z
    .array(z.number().int().positive().max(365))
    .default([1, 3, 8, 16]),
  revision: z.string().trim().min(1).max(40).default("1")
});

export const courseActivitySchema = z.discriminatedUnion("type", [
  activityBaseSchema.extend({
    type: z.literal("proof"),
    rubric: z.array(proofRubricCriterionSchema).min(1),
    referenceAnswerMarkdown: nonEmptyTextSchema,
    hints: z.array(z.string().trim().min(1)).default([])
  }),
  activityBaseSchema.extend({
    type: z.literal("multiple_choice"),
    options: z
      .array(
        z.object({
          id: stableIdSchema,
          labelMarkdown: nonEmptyTextSchema
        })
      )
      .min(2),
    correctOptionIds: z.array(stableIdSchema).min(1),
    explanationMarkdown: nonEmptyTextSchema
  }),
  activityBaseSchema.extend({
    type: z.enum(["short_answer", "computation", "reflection", "recall"]),
    referenceAnswerMarkdown: z.string().trim().default(""),
    answerGuidance: z.array(z.string().trim().min(1)).default([]),
    rubric: z.array(proofRubricCriterionSchema).optional()
  }),
  activityBaseSchema.extend({
    type: z.literal("extension"),
    namespace: stableIdSchema,
    renderer: stableIdSchema,
    version: z.string().trim().min(1).max(40).default("1"),
    responseMode: z.enum(["none", "text", "selection", "structured"]),
    config: jsonValueSchema,
    assessment: jsonValueSchema.optional()
  })
]);

export const courseConceptSchema = z.object({
  id: stableIdSchema,
  slug: stableIdSchema,
  title: nonEmptyTextSchema.max(180),
  summary: nonEmptyTextSchema.max(1_200),
  definitionMarkdown: nonEmptyTextSchema,
  exampleMarkdown: z.string().trim().default(""),
  nonExampleMarkdown: z.string().trim().default(""),
  prerequisiteConceptIds: z.array(stableIdSchema).default([]),
  relatedConceptIds: z.array(stableIdSchema).default([]),
  masteryDimensionIds: z.array(stableIdSchema).default([]),
  misconceptionIds: z.array(stableIdSchema).default([]),
  deliveryOwner: z
    .enum(["course", "shared", "assessment_only"])
    .default("course"),
  defaultStatus: z
    .enum([
      "required",
      "required_proof",
      "proof_not_required",
      "activity_only",
      "out_of_scope"
    ])
    .default("required"),
  tags: z.array(z.string().trim().min(1).max(80)).default([])
});

export const courseConceptRefSchema = z.object({
  id: stableIdSchema,
  sourceCourseId: stableIdSchema.optional(),
  sourceCourseVersion: z.string().trim().min(1).max(40).optional(),
  expectedContentHash: z.string().trim().min(1).max(160).optional(),
  status: z
    .enum([
      "required",
      "required_proof",
      "proof_not_required",
      "activity_only",
      "out_of_scope"
    ])
    .default("required"),
  deliveryOwner: z
    .enum(["course", "shared", "assessment_only"])
    .default("shared")
});

export const courseLessonSchema = z.object({
  id: stableIdSchema,
  moduleId: stableIdSchema,
  week: z.number().int().positive().max(520),
  day: z.number().int().positive().max(14),
  order: z.number().int().nonnegative(),
  title: nonEmptyTextSchema.max(220),
  summary: nonEmptyTextSchema.max(1_200),
  estimatedMinutes: z.number().int().positive().max(480),
  conceptIds: z.array(stableIdSchema).min(1),
  objectives: z.array(z.string().trim().min(1)).min(1),
  layoutId: stableIdSchema.optional(),
  content: z.array(courseContentBlockSchema).min(1),
  activities: z.array(courseActivitySchema).min(1)
});

export const courseModuleSchema = z.object({
  id: stableIdSchema,
  title: nonEmptyTextSchema.max(220),
  description: nonEmptyTextSchema,
  order: z.number().int().nonnegative(),
  startWeek: z.number().int().positive(),
  endWeek: z.number().int().positive(),
  lessonIds: z.array(stableIdSchema).min(1)
});

export const gradeScaleSchema = z
  .array(
    z.object({
      minimum: z.number().min(0).max(100),
      label: nonEmptyTextSchema.max(24)
    })
  )
  .min(2);

export const forgeCoursePackageSchema = z.object({
  schemaVersion: z.enum(["1.0", "1.1"]),
  course: z.object({
    id: stableIdSchema,
    slug: stableIdSchema,
    version: nonEmptyTextSchema.max(40),
    title: nonEmptyTextSchema.max(220),
    subtitle: z.string().trim().max(320).default(""),
    description: nonEmptyTextSchema,
    language: z.string().trim().min(2).max(20).default("en"),
    authors: z.array(z.string().trim().min(1).max(160)).min(1),
    license: z.string().trim().min(1).max(120),
    estimatedWeeks: z.number().int().positive(),
    minutesPerWeek: z.number().int().positive(),
    tags: z.array(z.string().trim().min(1).max(80)).default([]),
    entryLessonId: stableIdSchema,
    featuredLessonId: stableIdSchema.optional(),
    sourceUrl: z.string().url().optional()
  }),
  presentation: z
    .object({
      preset: stableIdSchema.default("forge.paper"),
      brandLabel: z.string().trim().max(80).default("Forge course"),
      defaultLessonLayoutId: stableIdSchema.default("default.lesson"),
      theme: z
        .object({
          accent: z
            .string()
            .regex(/^#[0-9A-Fa-f]{6}$/u)
            .default("#a84637"),
          highlight: z
            .string()
            .regex(/^#[0-9A-Fa-f]{6}$/u)
            .default("#d6a65a"),
          paper: z
            .string()
            .regex(/^#[0-9A-Fa-f]{6}$/u)
            .default("#f4efe5"),
          ink: z
            .string()
            .regex(/^#[0-9A-Fa-f]{6}$/u)
            .default("#10233f")
        })
        .default({}),
      extensions: z
        .array(
          z.object({
            namespace: stableIdSchema,
            version: z.string().trim().min(1).max(40),
            required: z.boolean().default(false)
          })
        )
        .default([])
    })
    .default({}),
  grading: z
    .object({
      defaultAssessmentProfileId: stableIdSchema.default("default"),
      attemptAggregation: z.enum(["latest", "best"]).default("latest"),
      pointsPolicy: z
        .enum(["first_completion", "positive_delta"])
        .default("first_completion"),
      lessonCompletion: z.literal("all_required").default("all_required"),
      gradeScale: gradeScaleSchema.default([...DEFAULT_GRADE_SCALE]),
      masteryDimensions: z
        .array(
          z.object({
            id: stableIdSchema,
            label: nonEmptyTextSchema.max(120),
            description: nonEmptyTextSchema.max(1_200),
            weight: z.number().nonnegative().max(1)
          })
        )
        .min(1)
        .default([...DEFAULT_MASTERY_DIMENSIONS]),
      competencies: z
        .array(
          z.object({
            id: stableIdSchema,
            label: nonEmptyTextSchema.max(120),
            description: z.string().trim().max(1_200).default("")
          })
        )
        .default([]),
      misconceptions: z
        .array(
          z.object({
            id: stableIdSchema,
            label: nonEmptyTextSchema.max(160),
            description: nonEmptyTextSchema.max(1_200),
            remediationConceptIds: z.array(stableIdSchema).default([])
          })
        )
        .default([]),
      assessmentProfiles: z
        .array(
          z.object({
            id: stableIdSchema,
            label: nonEmptyTextSchema.max(120),
            description: z.string().trim().max(1_200).default(""),
            gradeScale: gradeScaleSchema.optional(),
            timed: z.boolean().default(false),
            oral: z.boolean().default(false)
          })
        )
        .min(1)
        .default([
          {
            id: "default",
            label: "Default assessment",
            description: "Untimed written work.",
            timed: false,
            oral: false
          }
        ])
    })
    .default({}),
  conceptRefs: z.array(courseConceptRefSchema).default([]),
  conceptUpgrades: z
    .array(
      z.object({
        conceptId: stableIdSchema,
        fromContentHash: z.string().regex(/^[a-f0-9]{64}$/u),
        reason: nonEmptyTextSchema.max(1_200)
      })
    )
    .optional(),
  concepts: z.array(courseConceptSchema).default([]),
  modules: z.array(courseModuleSchema).min(1),
  lessons: z.array(courseLessonSchema).min(1),
  resources: z
    .array(
      z.object({
        id: stableIdSchema,
        label: nonEmptyTextSchema.max(180),
        url: z.string().url(),
        description: z.string().trim().default("")
      })
    )
    .default([]),
  extensions: z.record(jsonValueSchema).default({}),
  provenance: z.object({
    generatedAt: z.string().datetime({ offset: true }),
    contentHash: z.string().trim().default(""),
    notes: z.string().trim().default("")
  })
});

export type ForgeCoursePackage = z.infer<typeof forgeCoursePackageSchema>;
export type CourseConcept = z.infer<typeof courseConceptSchema>;
export type CourseConceptRef = z.infer<typeof courseConceptRefSchema>;
export type CourseLesson = z.infer<typeof courseLessonSchema>;
export type CourseActivity = z.infer<typeof courseActivitySchema>;
export type ProofActivity = Extract<CourseActivity, { type: "proof" }>;
export type GradeScale = z.infer<typeof gradeScaleSchema>;
export type ForgeCoursePackageInput = z.input<typeof forgeCoursePackageSchema>;
export type CourseConceptInput = z.input<typeof courseConceptSchema>;
export type CourseLessonInput = z.input<typeof courseLessonSchema>;
export type CourseActivityInput = z.input<typeof courseActivitySchema>;
export type ProofActivityInput = Extract<
  CourseActivityInput,
  { type: "proof" }
>;

export type LearnerCourseActivity =
  | Omit<Extract<CourseActivity, { type: "proof" }>, "referenceAnswerMarkdown">
  | Omit<
      Extract<CourseActivity, { type: "multiple_choice" }>,
      "correctOptionIds" | "explanationMarkdown"
    >
  | Omit<
      Extract<
        CourseActivity,
        { type: "short_answer" | "computation" | "reflection" | "recall" }
      >,
      "referenceAnswerMarkdown"
    >
  | Omit<Extract<CourseActivity, { type: "extension" }>, "assessment">;

export type LearnerCourseLesson = Omit<CourseLesson, "activities"> & {
  activities: LearnerCourseActivity[];
};

function duplicateIds(values: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function relativeLuminance(hex: string) {
  const channels = [1, 3, 5].map(
    (offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
  );
  return channels
    .map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    )
    .reduce(
      (sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!,
      0
    );
}

function contrastRatio(foreground: string, background: string) {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function assertReferences(coursePackage: ForgeCoursePackage) {
  const definedConceptIds = new Set(
    coursePackage.concepts.map((concept) => concept.id)
  );
  const referencedConceptIds = new Set(
    coursePackage.conceptRefs.map((concept) => concept.id)
  );
  const conceptIds = new Set([...definedConceptIds, ...referencedConceptIds]);
  const lessonIds = new Set(coursePackage.lessons.map((lesson) => lesson.id));
  const moduleIds = new Set(coursePackage.modules.map((module) => module.id));
  const dimensionIds = new Set(
    coursePackage.grading.masteryDimensions.map((entry) => entry.id)
  );
  const competencyIds = new Set(
    coursePackage.grading.competencies.map((entry) => entry.id)
  );
  const misconceptionIds = new Set(
    coursePackage.grading.misconceptions.map((entry) => entry.id)
  );
  const assessmentProfileIds = new Set(
    coursePackage.grading.assessmentProfiles.map((entry) => entry.id)
  );
  const errors: string[] = [];

  if (conceptIds.size === 0)
    errors.push("At least one concept or conceptRef is required.");
  const duplicateConceptIds = duplicateIds([
    ...coursePackage.concepts.map((entry) => entry.id),
    ...coursePackage.conceptRefs.map((entry) => entry.id)
  ]);
  const duplicateConceptUpgradeIds = duplicateIds(
    (coursePackage.conceptUpgrades ?? []).map((entry) => entry.conceptId)
  );
  const duplicateLessonIds = duplicateIds(
    coursePackage.lessons.map((entry) => entry.id)
  );
  const duplicateModuleIds = duplicateIds(
    coursePackage.modules.map((entry) => entry.id)
  );
  const duplicateActivityIds = duplicateIds(
    coursePackage.lessons.flatMap((lesson) =>
      lesson.activities.map((activity) => activity.id)
    )
  );
  const duplicateDimensionIds = duplicateIds(
    coursePackage.grading.masteryDimensions.map((entry) => entry.id)
  );
  if (duplicateConceptIds.length)
    errors.push(`Duplicate concept ids: ${duplicateConceptIds.join(", ")}`);
  if (duplicateConceptUpgradeIds.length)
    errors.push(
      `Duplicate concept upgrade ids: ${duplicateConceptUpgradeIds.join(", ")}`
    );
  for (const upgrade of coursePackage.conceptUpgrades ?? []) {
    if (!definedConceptIds.has(upgrade.conceptId)) {
      errors.push(
        `Concept upgrade ${upgrade.conceptId} must target a concept defined by this package.`
      );
    }
  }
  if (duplicateLessonIds.length)
    errors.push(`Duplicate lesson ids: ${duplicateLessonIds.join(", ")}`);
  if (duplicateModuleIds.length)
    errors.push(`Duplicate module ids: ${duplicateModuleIds.join(", ")}`);
  if (duplicateActivityIds.length)
    errors.push(`Duplicate activity ids: ${duplicateActivityIds.join(", ")}`);
  if (duplicateDimensionIds.length)
    errors.push(
      `Duplicate mastery dimension ids: ${duplicateDimensionIds.join(", ")}`
    );

  const totalMasteryWeight = coursePackage.grading.masteryDimensions.reduce(
    (sum, entry) => sum + entry.weight,
    0
  );
  if (Math.abs(totalMasteryWeight - 1) > 0.000_001) {
    errors.push(
      `Mastery dimension weights sum to ${totalMasteryWeight}, not 1.`
    );
  }
  if (
    contrastRatio(
      coursePackage.presentation.theme.ink,
      coursePackage.presentation.theme.paper
    ) < 4.5
  ) {
    errors.push("Presentation ink and paper colors must have 4.5:1 contrast.");
  }
  if (
    contrastRatio(
      coursePackage.presentation.theme.accent,
      coursePackage.presentation.theme.paper
    ) < 4.5
  ) {
    errors.push(
      "Presentation accent and paper colors must have 4.5:1 contrast."
    );
  }
  if (contrastRatio(coursePackage.presentation.theme.accent, "#ffffff") < 4.5) {
    errors.push("Presentation accent must support readable white action text.");
  }
  if (
    !assessmentProfileIds.has(coursePackage.grading.defaultAssessmentProfileId)
  ) {
    errors.push(
      `Default assessment profile ${coursePackage.grading.defaultAssessmentProfileId} does not exist.`
    );
  }
  for (const conceptRef of coursePackage.conceptRefs) {
    if (conceptRef.sourceCourseVersion && !conceptRef.sourceCourseId) {
      errors.push(
        `Concept reference ${conceptRef.id} declares a source version without a source course.`
      );
    }
  }

  for (const concept of coursePackage.concepts) {
    for (const targetId of [
      ...concept.prerequisiteConceptIds,
      ...concept.relatedConceptIds
    ]) {
      if (!conceptIds.has(targetId))
        errors.push(`Concept ${concept.id} links missing concept ${targetId}.`);
      if (targetId === concept.id)
        errors.push(`Concept ${concept.id} cannot link to itself.`);
    }
    for (const dimensionId of concept.masteryDimensionIds) {
      if (!dimensionIds.has(dimensionId))
        errors.push(
          `Concept ${concept.id} links missing mastery dimension ${dimensionId}.`
        );
    }
    for (const misconceptionId of concept.misconceptionIds) {
      if (!misconceptionIds.has(misconceptionId))
        errors.push(
          `Concept ${concept.id} links missing misconception ${misconceptionId}.`
        );
    }
  }

  for (const misconception of coursePackage.grading.misconceptions) {
    for (const conceptId of misconception.remediationConceptIds) {
      if (!conceptIds.has(conceptId))
        errors.push(
          `Misconception ${misconception.id} links missing remediation concept ${conceptId}.`
        );
    }
  }

  for (const module of coursePackage.modules) {
    for (const lessonId of module.lessonIds) {
      if (!lessonIds.has(lessonId))
        errors.push(`Module ${module.id} links missing lesson ${lessonId}.`);
    }
  }

  for (const lesson of coursePackage.lessons) {
    if (!moduleIds.has(lesson.moduleId))
      errors.push(
        `Lesson ${lesson.id} links missing module ${lesson.moduleId}.`
      );
    for (const conceptId of lesson.conceptIds) {
      if (!conceptIds.has(conceptId))
        errors.push(`Lesson ${lesson.id} links missing concept ${conceptId}.`);
    }
    const activityIds = new Set(
      lesson.activities.map((activity) => activity.id)
    );
    const checkpointBlocks = lesson.content.filter(
      (
        block
      ): block is Extract<
        (typeof lesson.content)[number],
        { type: "checkpoint" }
      > => block.type === "checkpoint"
    );
    const duplicateCheckpointActivityIds = duplicateIds(
      checkpointBlocks.map((block) => block.activityId)
    );
    if (duplicateCheckpointActivityIds.length) {
      errors.push(
        `Lesson ${lesson.id} places checkpoint activities more than once: ${duplicateCheckpointActivityIds.join(", ")}.`
      );
    }
    for (const checkpoint of checkpointBlocks) {
      const activity = lesson.activities.find(
        (candidate) => candidate.id === checkpoint.activityId
      );
      if (!activity) {
        errors.push(
          `Lesson ${lesson.id} checkpoint links missing activity ${checkpoint.activityId}.`
        );
        continue;
      }
      if (
        checkpoint.continuation === "after_remediation" &&
        !checkpoint.remediationActivityId
      ) {
        errors.push(
          `Lesson ${lesson.id} checkpoint ${checkpoint.activityId} requires a remediation activity.`
        );
      }
      if (
        checkpoint.remediationActivityId &&
        (!activityIds.has(checkpoint.remediationActivityId) ||
          checkpoint.remediationActivityId === checkpoint.activityId)
      ) {
        errors.push(
          `Lesson ${lesson.id} checkpoint ${checkpoint.activityId} has invalid remediation activity ${checkpoint.remediationActivityId}.`
        );
      }
    }
    if (coursePackage.schemaVersion === "1.1") {
      for (const activity of lesson.activities.filter(
        (candidate) => candidate.required
      )) {
        if (
          !checkpointBlocks.some(
            (checkpoint) => checkpoint.activityId === activity.id
          )
        ) {
          errors.push(
            `Schema 1.1 lesson ${lesson.id} does not place required activity ${activity.id} in its teaching sequence.`
          );
        }
      }
    } else if (checkpointBlocks.length > 0) {
      errors.push(
        `Schema 1.0 lesson ${lesson.id} cannot contain checkpoint blocks.`
      );
    }
    for (const activity of lesson.activities) {
      for (const conceptId of activity.conceptIds) {
        if (!conceptIds.has(conceptId))
          errors.push(
            `Activity ${activity.id} links missing concept ${conceptId}.`
          );
      }
      for (const dimensionId of activity.masteryDimensionIds) {
        if (!dimensionIds.has(dimensionId))
          errors.push(
            `Activity ${activity.id} links missing mastery dimension ${dimensionId}.`
          );
      }
      for (const competencyId of activity.competencyIds) {
        if (!competencyIds.has(competencyId))
          errors.push(
            `Activity ${activity.id} links missing competency ${competencyId}.`
          );
      }
      if (!assessmentProfileIds.has(activity.assessmentProfileId)) {
        errors.push(
          `Activity ${activity.id} links missing assessment profile ${activity.assessmentProfileId}.`
        );
      }
      const rubric = "rubric" in activity ? (activity.rubric ?? []) : [];
      if (rubric.length > 0) {
        const duplicateRubricIds = duplicateIds(
          rubric.map((criterion) => criterion.id)
        );
        if (duplicateRubricIds.length > 0) {
          errors.push(
            `Rubric ${activity.id} has duplicate criterion ids: ${duplicateRubricIds.join(", ")}.`
          );
        }
        const totalWeight = rubric.reduce(
          (sum, criterion) => sum + criterion.weight,
          0
        );
        if (Math.abs(totalWeight - 1) > 0.000_001) {
          errors.push(
            `Rubric ${activity.id} weights sum to ${totalWeight}, not 1.`
          );
        }
        for (const criterion of rubric) {
          for (const dimensionId of criterion.masteryDimensionIds) {
            if (!dimensionIds.has(dimensionId))
              errors.push(
                `Rubric criterion ${criterion.id} links missing mastery dimension ${dimensionId}.`
              );
          }
          for (const misconceptionId of criterion.misconceptionIds) {
            if (!misconceptionIds.has(misconceptionId))
              errors.push(
                `Rubric criterion ${criterion.id} links missing misconception ${misconceptionId}.`
              );
          }
        }
      }
      if (activity.type === "multiple_choice") {
        const optionIds = new Set(activity.options.map((option) => option.id));
        for (const optionId of activity.correctOptionIds) {
          if (!optionIds.has(optionId))
            errors.push(
              `Activity ${activity.id} has missing correct option ${optionId}.`
            );
        }
      }
    }
  }

  if (!lessonIds.has(coursePackage.course.entryLessonId)) {
    errors.push(
      `Entry lesson ${coursePackage.course.entryLessonId} does not exist.`
    );
  }
  if (
    coursePackage.course.featuredLessonId &&
    !lessonIds.has(coursePackage.course.featuredLessonId)
  ) {
    errors.push(
      `Featured lesson ${coursePackage.course.featuredLessonId} does not exist.`
    );
  }
  if (errors.length > 0) throw new Error(errors.join("\n"));
}

export function defineCoursePackage(
  input: z.input<typeof forgeCoursePackageSchema>
) {
  const parsed = forgeCoursePackageSchema.parse(input);
  const resolved = {
    ...parsed,
    lessons: parsed.lessons.map((lesson) => ({
      ...lesson,
      layoutId: lesson.layoutId ?? parsed.presentation.defaultLessonLayoutId
    }))
  };
  assertReferences(resolved);
  return resolved;
}

export function toLearnerActivity(
  activity: CourseActivity
): LearnerCourseActivity {
  if (activity.type === "proof") {
    const { referenceAnswerMarkdown: _hidden, ...safe } = activity;
    return safe;
  }
  if (activity.type === "multiple_choice") {
    const {
      correctOptionIds: _correct,
      explanationMarkdown: _explanation,
      ...safe
    } = activity;
    return safe;
  }
  if (activity.type === "extension") {
    const { assessment: _assessment, ...safe } = activity;
    return safe;
  }
  const { referenceAnswerMarkdown: _hidden, ...safe } = activity;
  return safe;
}

export function toLearnerLesson(lesson: CourseLesson): LearnerCourseLesson {
  return {
    ...lesson,
    activities: lesson.activities.map(toLearnerActivity)
  };
}

export function scoreToLetterGrade(
  score: number,
  gradeScale: ReadonlyArray<{
    minimum: number;
    label: string;
  }> = DEFAULT_GRADE_SCALE
) {
  const ordered = [...gradeScale].sort((a, b) => b.minimum - a.minimum);
  return ordered.find((entry) => score >= entry.minimum)?.label ?? "—";
}

export function updateMastery(
  previousMastery: number | null,
  evidenceScore: number
) {
  const previous = previousMastery ?? 0;
  const evidenceWeight = previousMastery === null ? 1 : 0.35;
  return Math.round(
    Math.max(
      0,
      Math.min(
        100,
        previous * (1 - evidenceWeight) + evidenceScore * evidenceWeight
      )
    )
  );
}

export function nextReviewIntervalDays(input: {
  score: number;
  previousIntervalDays: number | null;
  successfulReviewCount: number;
  scheduleDays?: number[];
}) {
  const schedule = input.scheduleDays?.length
    ? [...input.scheduleDays].sort((a, b) => a - b)
    : [1, 3, 8, 16];
  if (input.score < 70) return schedule[0] ?? 1;
  const nextIndex = Math.min(input.successfulReviewCount, schedule.length - 1);
  return schedule[nextIndex] ?? schedule.at(-1) ?? 16;
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

export type CourseProgress = {
  completedLessons: number;
  totalLessons: number;
  progressPercent: number;
  averageScore: number | null;
  grade: string | null;
  pointsEarned: number;
  currentLessonId: string | null;
};

export type ForgeCourse = {
  id: string;
  slug: string;
  version: string;
  schemaVersion: string;
  title: string;
  subtitle: string;
  description: string;
  language: string;
  authors: string[];
  license: string;
  estimatedWeeks: number;
  minutesPerWeek: number;
  tags: string[];
  entryLessonId: string;
  featuredLessonId: string | null;
  sourceUrl: string | null;
  contentHash: string;
  presentation: {
    preset: string;
    brandLabel: string;
    defaultLessonLayoutId: string;
    theme: {
      accent: string;
      highlight: string;
      paper: string;
      ink: string;
    };
    extensions: Array<{
      namespace: string;
      version: string;
      required: boolean;
    }>;
  };
  grading: {
    defaultAssessmentProfileId: string;
    attemptAggregation: "latest" | "best";
    pointsPolicy: "first_completion" | "positive_delta";
    lessonCompletion: "all_required";
    gradeScale: Array<{ minimum: number; label: string }>;
    masteryDimensions: Array<{
      id: string;
      label: string;
      description: string;
      weight: number;
    }>;
  };
  createdAt: string;
  updatedAt: string;
};

export type ConceptMastery = {
  masteryScore: number;
  averageScore: number;
  evidenceCount: number;
  successfulReviewCount: number;
  reviewIntervalDays: number | null;
  nextReviewAt: string | null;
  lastEvidenceAt: string | null;
  due: boolean;
  dimensions: Array<{
    id: string;
    masteryScore: number;
    averageScore: number;
    evidenceCount: number;
    lastEvidenceAt: string | null;
  }>;
};

export type ForgeConcept = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  definitionMarkdown: string;
  exampleMarkdown: string;
  nonExampleMarkdown: string;
  prerequisiteConceptIds: string[];
  relatedConceptIds: string[];
  tags: string[];
  courseCount: number;
  mastery: ConceptMastery;
};

export type ProofRubricCriterion = {
  id: string;
  label: string;
  description: string;
  weight: number;
  masteryDimensionIds: string[];
  misconceptionIds: string[];
};

type ActivityBase = {
  id: string;
  title: string;
  promptMarkdown: string;
  conceptIds: string[];
  masteryDimensionIds: string[];
  competencyIds: string[];
  assessmentProfileId: string;
  points: number;
  estimatedMinutes: number;
  required: boolean;
  templateId?: string;
  reviewAfterDays: number[];
  revision: string;
};

export type CourseActivity =
  | (ActivityBase & {
      type: "proof";
      rubric: ProofRubricCriterion[];
      hints: string[];
    })
  | (ActivityBase & {
      type: "multiple_choice";
      options: Array<{ id: string; labelMarkdown: string }>;
    })
  | (ActivityBase & {
      type: "short_answer" | "computation" | "reflection" | "recall";
      answerGuidance: string[];
      rubric?: ProofRubricCriterion[];
    })
  | (ActivityBase & {
      type: "extension";
      namespace: string;
      renderer: string;
      version: string;
      responseMode: "none" | "text" | "selection" | "structured";
      config: unknown;
    });

export type CourseContentBlock =
  | { type: "markdown"; markdown: string }
  | { type: "math"; latex: string; display: boolean; label: string }
  | {
      type: "callout";
      tone: "definition" | "theorem" | "warning" | "intuition" | "evidence";
      title: string;
      markdown: string;
    }
  | { type: "divider"; label: string }
  | {
      type: "checkpoint";
      activityId: string;
      title: string;
      introMarkdown: string;
      continuation:
        | "after_pass"
        | "after_remediation"
        | "after_review"
        | "always";
      remediationActivityId?: string;
    }
  | {
      type: "resource";
      resourceId: string;
      presentation: "link" | "card" | "embed";
    }
  | {
      type: "extension";
      namespace: string;
      renderer: string;
      version: string;
      data: unknown;
    };

export type CourseLesson = {
  id: string;
  moduleId: string;
  week: number;
  day: number;
  order: number;
  title: string;
  summary: string;
  estimatedMinutes: number;
  conceptIds: string[];
  objectives: string[];
  layoutId?: string;
  content: CourseContentBlock[];
  activities: CourseActivity[];
};

export type CourseModule = {
  id: string;
  title: string;
  description: string;
  order: number;
  startWeek: number;
  endWeek: number;
  lessonIds: string[];
};

export type CourseResource = {
  id: string;
  label: string;
  url: string;
  description: string;
};

export type AssessmentFeedback = {
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

export type CourseAttempt = {
  id: string;
  activityId: string;
  status: "assessing" | "assessed" | "needs_review";
  score: number | null;
  grade: string | null;
  pointsAwarded: number;
  answerMarkdown: string;
  submittedAt: string;
  deliveryMode?: "visual" | "voice";
  lessonAttemptOrdinal?: number;
  activityAttemptOrdinal?: number;
  feedback: AssessmentFeedback | null;
};

export type CourseReleaseStatus = {
  enrolledVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
};

export type LearningSession = {
  course: ForgeCourse;
  release: CourseReleaseStatus;
  progress: CourseProgress;
  lesson: CourseLesson;
  flow: {
    availableActivityIds: string[];
    submittableActivityIds: string[];
    blockedByActivityId: string | null;
    disclosure: "checkpoint_frontier" | "open_navigation_with_guidance";
  };
  resources: CourseResource[];
  modules: CourseModule[];
  navigation: Array<{
    id: string;
    moduleId: string;
    week: number;
    day: number;
    order: number;
    title: string;
    completed: boolean;
    unlocked: boolean;
  }>;
  previousLessonId: string | null;
  nextLessonId: string | null;
  concepts: ForgeConcept[];
  latestAttempts: Array<CourseAttempt | null>;
};

export type CourseDetail = {
  course: ForgeCourse;
  release: CourseReleaseStatus;
  progress: CourseProgress;
  modules: CourseModule[];
  lessons: Array<{
    id: string;
    moduleId: string;
    week: number;
    day: number;
    order: number;
    title: string;
    summary: string;
    estimatedMinutes: number;
    conceptIds: string[];
    completed: boolean;
    unlocked: boolean;
  }>;
  concepts: ForgeConcept[];
  resources: CourseResource[];
};

export type ConceptDetail = {
  concept: ForgeConcept;
  courses: Array<ForgeCourse & { progress: CourseProgress }>;
  lessons: Array<{
    courseId: string;
    id: string;
    week: number;
    day: number;
    title: string;
  }>;
  evidence: Array<{
    score: number;
    evidenceMarkdown: string;
    createdAt: string;
    courseId: string;
    lessonId: string;
    activityId: string;
  }>;
};

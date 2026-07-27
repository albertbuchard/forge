import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Library,
  Lock,
  Menu,
  MessageSquareText,
  Sparkles,
  Target,
  Trophy,
  X
} from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  CourseFeedbackMarkdown,
  CourseMarkdown
} from "@/components/courses/course-markdown";
import {
  CourseContentBlockView,
  CourseExtensionActivityView,
  CourseLessonLayoutView
} from "@/components/courses/course-renderer-registry";
import { MasteryRing } from "@/components/courses/mastery-ring";
import { useForgeShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { LoadingState, ErrorState } from "@/components/ui/page-state";
import { getForgeLearningSession, submitForgeCourseAttempt } from "@/lib/api";
import type {
  AssessmentFeedback,
  CourseActivity,
  CourseContentBlock,
  LearningSession
} from "@/lib/course-types";
import { cn } from "@/lib/utils";

function activityLabel(type: CourseActivity["type"]) {
  if (type === "multiple_choice") return "Check your understanding";
  if (type === "proof") return "Proof studio";
  if (type === "recall") return "Recall from memory";
  if (type === "computation") return "Exact computation";
  if (type === "reflection") return "Reflect";
  return "Explain in your own words";
}

export function activitySubmissionLabel(type: CourseActivity["type"]) {
  if (type === "multiple_choice") return "Check answer";
  if (type === "extension") return "Submit activity";
  if (type === "proof") return "Submit for proof review";
  return "Submit for written review";
}

export function recallWeekCheckpoints(
  currentWeek: number,
  promptMarkdown: string
) {
  const checkpoints = new Map<number, number>();
  for (const match of promptMarkdown.matchAll(/\bWeek\s+(\d+)\b/giu)) {
    const sourceWeek = Number(match[1]);
    const intervalWeeks = currentWeek - sourceWeek;
    if (
      Number.isInteger(sourceWeek) &&
      sourceWeek > 0 &&
      intervalWeeks > 0 &&
      !checkpoints.has(intervalWeeks)
    ) {
      checkpoints.set(intervalWeeks, sourceWeek);
    }
  }
  return [...checkpoints.entries()]
    .map(([intervalWeeks, sourceWeek]) => ({ intervalWeeks, sourceWeek }))
    .sort((left, right) => left.intervalWeeks - right.intervalWeeks);
}

function gradeTone(score: number | null) {
  if (score === null) return "var(--course-muted)";
  if (score >= 85) return "var(--course-green)";
  if (score >= 70) return "var(--course-gold)";
  return "var(--course-red)";
}

type CourseDraft = {
  version: 1;
  answer: string;
  selectedOptions: string[];
  updatedAt: string;
};

export function courseDraftStorageKey(input: {
  userId?: string;
  courseId: string;
  lessonId: string;
  activityId: string;
}) {
  return [
    "forge:course-draft:v1",
    input.userId || "operator",
    input.courseId,
    input.lessonId,
    input.activityId
  ]
    .map(encodeURIComponent)
    .join(":");
}

export function parseCourseDraft(value: string | null): CourseDraft | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<CourseDraft>;
    if (
      parsed.version !== 1 ||
      typeof parsed.answer !== "string" ||
      !Array.isArray(parsed.selectedOptions) ||
      parsed.selectedOptions.some((option) => typeof option !== "string") ||
      typeof parsed.updatedAt !== "string"
    ) {
      return null;
    }
    return parsed as CourseDraft;
  } catch {
    return null;
  }
}

export function courseAccentStyle(
  theme?: LearningSession["course"]["presentation"]["theme"]
) {
  return {
    "--course-package-accent": theme?.accent,
    "--course-package-highlight": theme?.highlight
  } as CSSProperties;
}

function attemptStatusLabel(
  attempt: LearningSession["latestAttempts"][number] | undefined
) {
  if (!attempt) return "Not started";
  if (attempt.status === "assessing") return "Reviewing";
  if (attempt.status === "needs_review") return "Needs review";
  return attempt.feedback?.verdict === "pass" ? "Passed" : "Revise";
}

export function courseLessonFlowState(
  session: Pick<LearningSession, "lesson" | "latestAttempts">
) {
  const hasCheckpointFlow = session.lesson.content.some(
    (block) => block.type === "checkpoint"
  );
  const attemptFor = (activityId: string) =>
    session.latestAttempts.find(
      (attempt) => attempt?.activityId === activityId
    );
  const requiredPassed = session.lesson.activities
    .filter((activity) => activity.required)
    .every(
      (activity) =>
        attemptFor(activity.id)?.status === "assessed" &&
        attemptFor(activity.id)?.feedback?.verdict === "pass"
    );
  if (!hasCheckpointFlow) {
    return {
      blocks: session.lesson.content,
      availableActivityIds: session.lesson.activities.map(
        (activity) => activity.id
      ),
      blockedBy: null as Extract<
        CourseContentBlock,
        { type: "checkpoint" }
      > | null,
      complete: requiredPassed
    };
  }

  const blocks: CourseContentBlock[] = [];
  const availableActivityIds: string[] = [];
  let blockedBy: Extract<
    CourseContentBlock,
    { type: "checkpoint" }
  > | null = null;
  for (const block of session.lesson.content) {
    blocks.push(block);
    if (block.type !== "checkpoint") continue;
    availableActivityIds.push(block.activityId);
    const attempt = attemptFor(block.activityId);
    const remediationAttempt = block.remediationActivityId
      ? attemptFor(block.remediationActivityId)
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
    if (!mayContinue) {
      blockedBy = block;
      break;
    }
  }
  return {
    blocks,
    availableActivityIds,
    blockedBy,
    complete: requiredPassed
  };
}

export function CourseSectionNavigation({
  currentIndex,
  totalSteps,
  canContinue,
  continueLabel = "Continue",
  onPrevious,
  onContinue
}: {
  currentIndex: number;
  totalSteps: number;
  canContinue: boolean;
  continueLabel?: string;
  onPrevious: () => void;
  onContinue: () => void;
}) {
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex < totalSteps - 1;
  if (!hasPrevious && !(canContinue && hasNext)) return null;
  return (
    <div className="course-flow-stage__next">
      {hasPrevious ? (
        <Button size="lg" variant="secondary" onClick={onPrevious}>
          <ArrowLeft className="size-4" /> Previous section
        </Button>
      ) : null}
      {canContinue && hasNext ? (
        <Button size="lg" className="ml-auto" onClick={onContinue}>
          {continueLabel} <ArrowRight className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}

export function CourseDrawer({
  label,
  side = "left",
  onClose,
  children
}: {
  label: string;
  side?: "left" | "right";
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusableSelector =
      'button:not([disabled]), a[href], textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusFirst = () => {
      const first =
        dialogRef.current?.querySelector<HTMLElement>(focusableSelector) ??
        dialogRef.current;
      first?.focus();
    };
    const frame = window.requestAnimationFrame(focusFirst);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const controls = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector)
      ];
      if (controls.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = controls[0]!;
      const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [onClose]);

  return (
    <div
      className={cn(
        "course-drawer-backdrop",
        side === "right" && "justify-end"
      )}
      onMouseDown={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={cn(
          "h-full",
          side === "left"
            ? "w-[min(88vw,300px)]"
            : "w-[min(92vw,340px)] overflow-y-auto bg-[var(--course-paper)]"
        )}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function CourseOutline({
  session,
  onNavigate,
  onClose
}: {
  session: LearningSession;
  onNavigate: (lessonId: string) => void;
  onClose?: () => void;
}) {
  const [expanded, setExpanded] = useState(
    () => new Set([session.lesson.moduleId])
  );
  const outlineNavRef = useRef<HTMLElement>(null);
  const currentLessonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setExpanded((current) => new Set([...current, session.lesson.moduleId]));
  }, [session.lesson.moduleId]);

  useEffect(() => {
    if (!expanded.has(session.lesson.moduleId)) return;
    const frame = window.requestAnimationFrame(() => {
      const nav = outlineNavRef.current;
      const current = currentLessonRef.current;
      if (!nav || !current) return;
      const navBox = nav.getBoundingClientRect();
      const currentBox = current.getBoundingClientRect();
      nav.scrollTop +=
        currentBox.top -
        navBox.top -
        nav.clientHeight / 2 +
        currentBox.height / 2;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [expanded, session.lesson.id, session.lesson.moduleId]);

  return (
    <aside className="course-outline">
      <div className="course-outline__brand">
        <div className="flex items-center gap-2.5">
          <div className="course-brand-mark">
            <BookOpen className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="font-editorial text-[17px] font-semibold leading-tight">
              {session.course.presentation.brandLabel}
            </div>
            <div className="mt-0.5 font-label text-[9px] uppercase tracking-[0.2em] text-[var(--course-outline-ink-muted)]">
              Forge course
            </div>
          </div>
        </div>
        {onClose ? (
          <button
            className="course-icon-button lg:hidden"
            onClick={onClose}
            aria-label="Close course outline"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      <div className="course-outline__progress">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="font-label text-[9px] uppercase tracking-[0.16em] text-[var(--course-outline-ink-subtle)]">
              Course progress
            </div>
            <div className="mt-1 text-sm font-semibold text-[var(--course-outline-ink)]">
              {session.progress.completedLessons} of{" "}
              {session.progress.totalLessons} days
            </div>
          </div>
          <span className="font-editorial text-2xl text-[var(--course-outline-ink)]">
            {session.progress.progressPercent}%
          </span>
        </div>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-[var(--course-outline-ink-faint)]">
          <div
            className="h-full rounded-full bg-[var(--course-gold)] transition-[width]"
            style={{ width: `${session.progress.progressPercent}%` }}
          />
        </div>
      </div>

      <nav
        ref={outlineNavRef}
        className="course-outline__nav"
        aria-label="Course outline"
      >
        {session.modules.map((module) => {
          const open = expanded.has(module.id);
          const lessons = session.navigation.filter(
            (lesson) => lesson.moduleId === module.id
          );
          const active = module.id === session.lesson.moduleId;
          return (
            <section key={module.id} className="course-outline__module">
              <button
                className={cn(
                  "course-outline__module-button",
                  active && "is-active"
                )}
                onClick={() => {
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(module.id)) next.delete(module.id);
                    else next.add(module.id);
                    return next;
                  });
                }}
              >
                <span className="min-w-0 text-left">
                  <span className="block font-label text-[9px] uppercase tracking-[0.14em] text-[var(--course-outline-ink-subtle)]">
                    Weeks {module.startWeek}–{module.endWeek}
                  </span>
                  <span className="mt-1 block truncate text-xs font-semibold text-[var(--course-outline-ink-strong)]">
                    {module.title}
                  </span>
                </span>
                {open ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronRight className="size-3.5" />
                )}
              </button>
              {open ? (
                <div className="course-outline__lessons">
                  {lessons.map((lesson) => (
                    <button
                      key={lesson.id}
                      ref={
                        lesson.id === session.lesson.id
                          ? currentLessonRef
                          : undefined
                      }
                      aria-current={
                        lesson.id === session.lesson.id ? "step" : undefined
                      }
                      className={cn(
                        "course-outline__lesson",
                        lesson.id === session.lesson.id && "is-current",
                        !lesson.unlocked && "is-locked"
                      )}
                      disabled={!lesson.unlocked}
                      aria-label={
                        lesson.unlocked
                          ? undefined
                          : `Week ${lesson.week}, day ${lesson.day}: locked until the preceding day is complete`
                      }
                      onClick={() => {
                        onNavigate(lesson.id);
                        onClose?.();
                      }}
                    >
                      <span className="course-outline__lesson-marker">
                        {lesson.completed ? (
                          <Check className="size-3" />
                        ) : !lesson.unlocked ? (
                          <Lock className="size-3" aria-hidden="true" />
                        ) : (
                          lesson.day
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[10px] text-[var(--course-outline-ink-subtle)]">
                          Week {lesson.week} · Day {lesson.day}
                          {lesson.id === session.lesson.id ? " · Current" : ""}
                          {!lesson.unlocked ? " · Locked" : ""}
                        </span>
                        <span className="block truncate text-[11px] text-[var(--course-outline-ink-body)]">
                          {lesson.title.split(" · ")[0]}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}
      </nav>

      <div className="course-outline__footer">
        <Link to="/courses" className="course-outline__footer-link">
          <Library className="size-3.5" /> Course library
        </Link>
        <Link to="/concepts" className="course-outline__footer-link">
          <Brain className="size-3.5" /> Concept atlas
        </Link>
      </div>
    </aside>
  );
}

export function FeedbackPanel({ feedback }: { feedback: AssessmentFeedback }) {
  const pending = feedback.score === null;
  return (
    <section className="course-feedback" aria-live="polite">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="course-kicker">
            <Sparkles className="size-3.5" /> Forge automated proof review
          </div>
          <h3 className="mt-2 font-editorial text-2xl text-[var(--course-navy)]">
            {pending
              ? "Your work is safely saved"
              : feedback.verdict === "pass"
                ? "Automated review passed"
                : feedback.verdict === "revise"
                  ? "Automated review suggests a revision"
                  : "Automated review found major gaps"}
          </h3>
        </div>
        {feedback.score !== null ? (
          <div
            className="course-grade-seal"
            style={{ color: gradeTone(feedback.score) }}
          >
            <span>{feedback.grade}</span>
            <small>{feedback.score}/100</small>
          </div>
        ) : (
          <CircleAlert className="mt-1 size-6 text-[var(--course-gold)]" />
        )}
      </div>
      {!pending ? (
        <p className="course-feedback__notice">
          Model-generated feedback can be wrong. Check the rubric evidence and
          revise whenever the reasoning can be stronger.
        </p>
      ) : null}
      <CourseFeedbackMarkdown
        markdown={feedback.summary}
        className="course-feedback__markdown mt-3"
      />
      {feedback.strengths.length > 0 ? (
        <div className="mt-5">
          <div className="course-feedback__label text-[var(--course-green)]">
            What works
          </div>
          <ul className="mt-2 grid gap-2">
            {feedback.strengths.map((strength) => (
              <li key={strength} className="flex gap-2 text-sm leading-5">
                <Check className="mt-0.5 size-4 shrink-0 text-[var(--course-green)]" />
                <CourseFeedbackMarkdown
                  markdown={strength}
                  className="course-feedback__markdown"
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {feedback.issues.length > 0 ? (
        <div className="mt-5">
          <div className="course-feedback__label text-[var(--course-red)]">
            What to repair
          </div>
          <ul className="mt-2 grid gap-2">
            {feedback.issues.map((issue) => (
              <li key={issue} className="flex gap-2 text-sm leading-5">
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-[var(--course-red)]" />
                <CourseFeedbackMarkdown
                  markdown={issue}
                  className="course-feedback__markdown"
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {feedback.criterionScores.length > 0 ? (
        <div className="mt-5">
          <div className="course-feedback__label">Rubric evidence</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {feedback.criterionScores.map((criterion) => (
              <div key={criterion.criterionId} className="course-rubric__item">
                <div className="flex items-center justify-between gap-3 text-xs font-semibold">
                  <span>{criterion.criterionId.replaceAll("_", " ")}</span>
                  <span>{Math.round(criterion.score)}/100</span>
                </div>
                <CourseFeedbackMarkdown
                  markdown={criterion.rationale}
                  className="course-feedback__markdown mt-1 text-xs"
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {feedback.lineFeedback.length > 0 ? (
        <div className="mt-5 grid gap-2">
          {feedback.lineFeedback.map((entry, index) => (
            <blockquote
              key={`${entry.quote}-${index}`}
              className="course-line-feedback"
            >
              {entry.quote ? (
                <CourseFeedbackMarkdown
                  markdown={`“${entry.quote}”`}
                  className="course-feedback__markdown font-editorial italic"
                />
              ) : null}
              <CourseFeedbackMarkdown
                markdown={entry.comment}
                className="course-feedback__markdown mt-1"
              />
            </blockquote>
          ))}
        </div>
      ) : null}
      <div className="mt-5 rounded-sm border-l-2 border-[var(--course-gold)] bg-[var(--course-gold-soft)] px-4 py-3">
        <div className="course-feedback__label">Next move</div>
        <CourseFeedbackMarkdown
          markdown={feedback.nextStep}
          className="course-feedback__markdown mt-1"
        />
      </div>
    </section>
  );
}

function ConceptRail({ session }: { session: LearningSession }) {
  const currentAttempt = session.latestAttempts
    .filter((attempt) => attempt !== null)
    .sort(
      (left, right) =>
        Date.parse(right.submittedAt) - Date.parse(left.submittedAt)
    )[0];
  return (
    <aside className="course-concepts-rail">
      <div className="course-concepts-rail__heading">
        <div>
          <div className="course-kicker">
            <Brain className="size-3.5" /> Concept ledger
          </div>
          <h2 className="mt-2 font-editorial text-2xl text-[var(--course-navy)]">
            Ideas in this lesson
          </h2>
        </div>
        <Link
          to="/concepts"
          className="course-icon-link"
          aria-label="Open concept atlas"
        >
          <ArrowRight className="size-4" />
        </Link>
      </div>

      <div className="mt-5 grid gap-3">
        {session.concepts.map((concept) => (
          <Link
            key={concept.id}
            to={`/concepts/${concept.slug}`}
            className="course-concept-card"
          >
            <div className="flex items-center gap-3">
              <MasteryRing value={concept.mastery.masteryScore} size={54} />
              <div className="min-w-0">
                <h3 className="font-editorial text-lg font-semibold text-[var(--course-navy)]">
                  {concept.title}
                </h3>
                <div className="mt-0.5 font-label text-[9px] uppercase tracking-[0.12em] text-[var(--course-muted)]">
                  {concept.mastery.evidenceCount === 0
                    ? "New concept"
                    : `${concept.mastery.evidenceCount} pieces of evidence`}
                </div>
              </div>
            </div>
            <p className="mt-3 line-clamp-3 text-xs leading-5 text-[var(--course-ink-soft)]">
              {concept.summary}
            </p>
            <div className="mt-3 flex items-center justify-between border-t border-[var(--course-line)] pt-2.5 text-[10px]">
              <span
                className={
                  concept.mastery.due
                    ? "text-[var(--course-red)]"
                    : "text-[var(--course-muted)]"
                }
              >
                {concept.mastery.due
                  ? "Review due"
                  : concept.mastery.nextReviewAt
                    ? `Review ${new Date(concept.mastery.nextReviewAt).toLocaleDateString()}`
                    : "Build first evidence"}
              </span>
              <ChevronRight className="size-3.5" />
            </div>
          </Link>
        ))}
      </div>

      <div className="course-grade-card">
        <div className="flex items-center justify-between">
          <div className="course-kicker">
            <Trophy className="size-3.5" /> Course standing
          </div>
          <span className="font-label text-xs font-bold text-[var(--course-red)]">
            {session.progress.pointsEarned} pts
          </span>
        </div>
        <div className="mt-4 flex items-end justify-between gap-3">
          <div>
            <div className="font-editorial text-4xl text-[var(--course-navy)]">
              {session.progress.grade ?? "—"}
            </div>
            <div className="mt-1 text-[11px] text-[var(--course-muted)]">
              Running course grade
            </div>
          </div>
          <div className="text-right">
            <div className="font-label text-lg font-bold text-[var(--course-navy)]">
              {session.progress.averageScore ?? "—"}
            </div>
            <div className="text-[10px] text-[var(--course-muted)]">
              average
            </div>
          </div>
        </div>
        {currentAttempt?.feedback ? (
          <div className="mt-4 border-t border-[var(--course-line)] pt-3 text-xs leading-5 text-[var(--course-ink-soft)]">
            <span className="font-semibold">Latest: </span>
            <CourseFeedbackMarkdown
              markdown={currentAttempt.feedback.summary}
              className="course-feedback__markdown inline"
            />
          </div>
        ) : null}
      </div>
    </aside>
  );
}

export function CourseLearnPage() {
  const { courseId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const shell = useForgeShell();
  const userId = shell.selectedUserIds[0];
  const lessonId = searchParams.get("lesson") ?? undefined;
  const queryClient = useQueryClient();
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [conceptsOpen, setConceptsOpen] = useState(false);
  const [answer, setAnswer] = useState("");
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [hydratedDraftKey, setHydratedDraftKey] = useState<string | null>(null);
  const [activeActivityId, setActiveActivityId] = useState<string | null>(null);
  const [activeBlockIndex, setActiveBlockIndex] = useState(0);
  const [localFeedback, setLocalFeedback] = useState<AssessmentFeedback | null>(
    null
  );

  const query = useQuery({
    queryKey: ["forge-course-learn", courseId, lessonId, userId],
    queryFn: () => getForgeLearningSession({ courseId, lessonId, userId })
  });
  const session = query.data;
  const lessonFlow = useMemo(
    () => (session ? courseLessonFlowState(session) : null),
    [session]
  );
  const activeBlock =
    lessonFlow?.blocks[
      Math.min(activeBlockIndex, Math.max(lessonFlow.blocks.length - 1, 0))
    ];
  const availableActivities =
    session?.lesson.activities.filter((entry) =>
      lessonFlow?.availableActivityIds.includes(entry.id)
    ) ?? [];
  const activity =
    (activeBlock?.type === "checkpoint"
      ? availableActivities.find(
          (entry) => entry.id === activeBlock.activityId
        )
      : availableActivities.find((entry) => entry.id === activeActivityId)) ??
    availableActivities[0];

  useEffect(() => {
    if (!session) {
      setActiveActivityId(null);
      return;
    }
    if (activeBlock?.type === "checkpoint") {
      setActiveActivityId(activeBlock.activityId);
      return;
    }
    const needsWork = (candidate: CourseActivity) => {
      const latest = session.latestAttempts.find(
        (attempt) => attempt?.activityId === candidate.id
      );
      return (
        latest?.status !== "assessed" || latest.feedback?.verdict !== "pass"
      );
    };
    const available = session.lesson.activities.filter((candidate) =>
      lessonFlow?.availableActivityIds.includes(candidate.id)
    );
    const firstPending =
      available.find(
        (candidate) => candidate.required && needsWork(candidate)
      ) ?? available.find(needsWork);
    setActiveActivityId(
      firstPending?.id ?? available[0]?.id ?? null
    );
  }, [activeBlock, lessonFlow?.availableActivityIds, session]);

  useEffect(() => {
    setActiveBlockIndex(0);
  }, [session?.lesson.id]);

  const draftKey = useMemo(() => {
    if (!session || !activity) return null;
    return courseDraftStorageKey({
      userId,
      courseId: session.course.id,
      lessonId: session.lesson.id,
      activityId: activity.id
    });
  }, [activity, session, userId]);

  useEffect(() => {
    if (!draftKey || !activity) return;
    const stored = parseCourseDraft(window.localStorage.getItem(draftKey));
    const latestAttempt = session?.latestAttempts.find(
      (attempt) => attempt?.activityId === activity.id
    );
    const restoredAnswer =
      stored?.answer ?? latestAttempt?.answerMarkdown ?? "";
    setAnswer(restoredAnswer);
    setSelectedOptions(
      stored?.selectedOptions ??
        (activity.type === "multiple_choice" && restoredAnswer
          ? restoredAnswer.split(",").filter(Boolean)
          : [])
    );
    setLocalFeedback(null);
    setHydratedDraftKey(draftKey);
  }, [activity, draftKey, session?.latestAttempts]);

  useEffect(() => {
    if (!draftKey || hydratedDraftKey !== draftKey) return;
    const draft: CourseDraft = {
      version: 1,
      answer,
      selectedOptions,
      updatedAt: new Date().toISOString()
    };
    window.localStorage.setItem(draftKey, JSON.stringify(draft));
  }, [answer, draftKey, hydratedDraftKey, selectedOptions]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!session || event.altKey === false) return;
      if (event.key === "ArrowLeft" && session.previousLessonId) {
        setSearchParams({ lesson: session.previousLessonId });
      }
      if (
        event.key === "ArrowRight" &&
        session.nextLessonId &&
        lessonFlow?.complete
      ) {
        setSearchParams({ lesson: session.nextLessonId });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lessonFlow?.complete, session, setSearchParams]);

  const submission = useMutation({
    mutationFn: async () => {
      if (!session || !activity) throw new Error("The lesson is not ready.");
      const answerMarkdown =
        activity.type === "multiple_choice"
          ? selectedOptions.join(",")
          : activity.type === "extension" && activity.responseMode === "none"
            ? "completed"
            : answer;
      return submitForgeCourseAttempt({
        courseId: session.course.id,
        lessonId: session.lesson.id,
        activityId: activity.id,
        userId,
        answerMarkdown
      });
    },
    onSuccess: async (result) => {
      setLocalFeedback(result.feedback);
      await queryClient.invalidateQueries({
        queryKey: ["forge-course-learn", courseId]
      });
      await queryClient.invalidateQueries({ queryKey: ["forge-concepts"] });
    }
  });

  const latestFeedback =
    localFeedback ??
    session?.latestAttempts.find((entry) => entry?.activityId === activity?.id)
      ?.feedback ??
    null;
  const currentAttempt = session?.latestAttempts.find(
    (entry) => entry?.activityId === activity?.id
  );
  const recallCheckpoints =
    activity?.type === "recall"
      ? recallWeekCheckpoints(
          session?.lesson.week ?? 0,
          activity.promptMarkdown
        )
      : [];
  const canSubmit = useMemo(() => {
    if (!activity) return false;
    if (activity.type === "extension") {
      return activity.responseMode === "none" || answer.trim().length > 0;
    }
    return activity.type === "multiple_choice"
      ? selectedOptions.length > 0
      : answer.trim().length >= 8;
  }, [activity, answer, selectedOptions]);

  const courseTheme = courseAccentStyle(session?.course.presentation.theme);

  const navigateLesson = (nextLessonId: string) => {
    setSearchParams({ lesson: nextLessonId });
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth"
    });
  };

  if (query.isLoading) {
    return (
      <div className="course-loading">
        <LoadingState
          eyebrow="Forge Courses"
          title="Opening your lesson"
          description="Loading the course path, concept ledger, and latest proof evidence."
        />
      </div>
    );
  }
  if (query.isError || !session || !activity) {
    return (
      <div className="course-loading">
        <ErrorState
          eyebrow="Forge Courses"
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="course-app" style={courseTheme}>
      <div
        inert={outlineOpen || conceptsOpen ? true : undefined}
        aria-hidden={outlineOpen || conceptsOpen ? true : undefined}
      >
        <header className="course-topbar">
          <div className="flex min-w-0 items-center gap-2">
            <button
              className="course-icon-button course-outline-trigger"
              onClick={() => setOutlineOpen(true)}
              aria-label="Open course outline"
            >
              <Menu className="size-4" />
            </button>
            <Link
              to={`/courses/${session.course.slug}`}
              className="course-icon-link"
              aria-label="Back to course overview"
            >
              <ArrowLeft className="size-4" />
            </Link>
            <div className="min-w-0">
              <div className="truncate font-editorial text-[15px] font-semibold text-[var(--course-navy)]">
                {session.course.title}
              </div>
              <div className="mt-0.5 truncate font-label text-[9px] uppercase tracking-[0.13em] text-[var(--course-muted)]">
                Forge course · Week {session.lesson.week} · Day{" "}
                {session.lesson.day} · {activityLabel(activity.type)}
              </div>
            </div>
          </div>
          <div className="hidden items-center gap-5 md:flex">
            <div className="course-topbar-stat">
              <Trophy className="size-3.5" />
              <strong>{session.progress.pointsEarned}</strong>
              <span>points</span>
            </div>
            <div className="course-topbar-stat">
              <Target className="size-3.5" />
              <strong>{session.progress.grade ?? "—"}</strong>
              <span>grade</span>
            </div>
            <div className="h-5 w-px bg-[var(--course-line)]" />
            <div className="w-32">
              <div className="flex justify-between font-label text-[9px] uppercase tracking-[0.1em] text-[var(--course-muted)]">
                <span>Progress</span>
                <span>{session.progress.progressPercent}%</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--course-line)]">
                <div
                  className="h-full bg-[var(--course-red)]"
                  style={{ width: `${session.progress.progressPercent}%` }}
                />
              </div>
            </div>
          </div>
          <button
            className="course-icon-button course-concepts-trigger"
            onClick={() => setConceptsOpen(true)}
            aria-label="Open concept ledger"
          >
            <Brain className="size-4" />
          </button>
          <div
            className="course-mobile-standing md:hidden"
            aria-label="Course standing"
          >
            <span>
              <strong>{session.progress.completedLessons}</strong>/
              {session.progress.totalLessons} days
            </span>
            <span>
              <strong>{session.progress.progressPercent}%</strong> complete
            </span>
            <span>
              <strong>{session.progress.grade ?? "—"}</strong> grade
            </span>
            <span>
              <strong>{session.progress.pointsEarned}</strong> pts
            </span>
          </div>
        </header>

        <CourseLessonLayoutView
          layoutId={
            session.lesson.layoutId ||
            session.course.presentation.defaultLessonLayoutId
          }
          preset={session.course.presentation.preset}
        >
          <div className="hidden lg:block" data-course-slot="outline">
            <CourseOutline session={session} onNavigate={navigateLesson} />
          </div>
          <main className="course-lesson" data-course-slot="lesson">
            <div className="course-lesson__inner">
              <div className="course-lesson__meta">
                <span className="course-kicker">
                  Term{" "}
                  {session.modules.findIndex(
                    (module) => module.id === session.lesson.moduleId
                  ) + 1}
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock3 className="size-3.5" />{" "}
                  {session.lesson.estimatedMinutes} min
                </span>
              </div>
              <h1 className="course-lesson__title">
                {session.lesson.title.split(" · ").at(-1)}
              </h1>
              <p className="course-lesson__summary">{session.lesson.summary}</p>

              {session.release.updateAvailable ? (
                <div className="course-release-notice" role="status">
                  <strong>
                    Version {session.release.latestVersion} is available.
                  </strong>
                  <span>
                    You are still learning from version{" "}
                    {session.release.enrolledVersion}; Forge will not move or
                    reinterpret your saved work without your choice.
                  </span>
                  <Link to={`/courses/${session.course.slug}`}>
                    Review the update
                  </Link>
                </div>
              ) : null}

              <div className="course-objectives">
                <div className="course-kicker">
                  <Target className="size-3.5" /> Today’s target
                </div>
                <ul>
                  {session.lesson.objectives.map((objective) => (
                    <li key={objective}>
                      <CourseMarkdown markdown={objective} />
                    </li>
                  ))}
                </ul>
              </div>

              <section
                className="course-flow-stage"
                aria-label="Current lesson section"
              >
                <div className="course-flow-stage__header">
                  <span>
                    Today · Step {activeBlockIndex + 1} of{" "}
                    {lessonFlow?.blocks.length ?? 1}
                  </span>
                  <span>One section at a time</span>
                </div>
                <div className="course-content-stack">
                  {activeBlock?.type === "checkpoint" ? (
                    <div
                      className={cn(
                        "course-inline-checkpoint is-active",
                        attemptStatusLabel(
                          session.latestAttempts.find(
                            (attempt) =>
                              attempt?.activityId === activeBlock.activityId
                          )
                        ) === "Passed" && "is-complete"
                      )}
                      aria-current="step"
                    >
                      <span className="course-inline-checkpoint__marker">
                        {attemptStatusLabel(
                          session.latestAttempts.find(
                            (attempt) =>
                              attempt?.activityId === activeBlock.activityId
                          )
                        ) === "Passed" ? (
                          <Check className="size-4" aria-hidden="true" />
                        ) : (
                          <MessageSquareText
                            className="size-4"
                            aria-hidden="true"
                          />
                        )}
                      </span>
                      <span className="course-inline-checkpoint__copy">
                        <strong>{activeBlock.title}</strong>
                        {activeBlock.introMarkdown ? (
                          <CourseMarkdown
                            markdown={activeBlock.introMarkdown}
                          />
                        ) : null}
                      </span>
                      <span className="course-inline-checkpoint__status">
                        {attemptStatusLabel(
                          session.latestAttempts.find(
                            (attempt) =>
                              attempt?.activityId === activeBlock.activityId
                          )
                        )}
                      </span>
                    </div>
                  ) : activeBlock ? (
                    <CourseContentBlockView
                      block={activeBlock}
                      index={activeBlockIndex}
                      resources={session.resources}
                    />
                  ) : null}
                </div>
                {activeBlock?.type !== "checkpoint" ? (
                  <CourseSectionNavigation
                    currentIndex={activeBlockIndex}
                    totalSteps={lessonFlow?.blocks.length ?? 0}
                    canContinue
                    onPrevious={() =>
                      setActiveBlockIndex((current) =>
                        Math.max(0, current - 1)
                      )
                    }
                    onContinue={() =>
                      setActiveBlockIndex((current) => current + 1)
                    }
                  />
                ) : null}
              </section>

              {activeBlock?.type === "checkpoint" ? (
                <section className="course-proof-studio">
                <div className="course-proof-studio__header">
                  <div>
                    <div className="course-kicker">
                      <MessageSquareText className="size-3.5" />{" "}
                      {activityLabel(activity.type)}
                    </div>
                    <h2 className="mt-2 font-editorial text-[28px] text-[var(--course-navy)]">
                      {activity.title}
                    </h2>
                  </div>
                  <div className="text-right font-label text-[9px] uppercase tracking-[0.12em] text-[var(--course-muted)]">
                    <div>
                      {activity.required ? "Required" : "Optional"} ·{" "}
                      {attemptStatusLabel(currentAttempt)}
                    </div>
                    <div>{activity.points} points</div>
                    <div className="mt-1">{activity.estimatedMinutes} min</div>
                  </div>
                </div>
                <CourseMarkdown
                  markdown={activity.promptMarkdown}
                  className="mt-4 text-[15px]"
                />
                {recallCheckpoints.length > 0 ? (
                  <section
                    className="course-recall-schedule"
                    aria-label="Spaced retrieval intervals"
                  >
                    <div className="course-kicker">Spaced retrieval</div>
                    <ul>
                      {recallCheckpoints.map(
                        ({ intervalWeeks, sourceWeek }) => (
                          <li key={`${intervalWeeks}-${sourceWeek}`}>
                            <strong>
                              {intervalWeeks}{" "}
                              {intervalWeeks === 1 ? "week" : "weeks"} ago
                            </strong>
                            <span>Week {sourceWeek}</span>
                          </li>
                        )
                      )}
                    </ul>
                  </section>
                ) : null}

                {activity.type === "proof" ? (
                  <details className="course-rubric">
                    <summary>How this proof is graded</summary>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {activity.rubric.map((criterion) => (
                        <div key={criterion.id} className="course-rubric__item">
                          <div className="flex justify-between gap-3 font-semibold">
                            <span>{criterion.label}</span>
                            <span>{Math.round(criterion.weight * 100)}%</span>
                          </div>
                          <p className="mt-1 text-xs leading-5 text-[var(--course-ink-soft)]">
                            {criterion.description}
                          </p>
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null}

                {activity.type === "extension" ? (
                  <CourseExtensionActivityView
                    activity={activity}
                    response={answer}
                    onResponseChange={setAnswer}
                    disabled={submission.isPending}
                  />
                ) : activity.type === "multiple_choice" ? (
                  <div className="mt-5 grid gap-2">
                    {activity.options.map((option) => {
                      const selected = selectedOptions.includes(option.id);
                      return (
                        <button
                          key={option.id}
                          className={cn(
                            "course-option",
                            selected && "is-selected"
                          )}
                          onClick={() =>
                            setSelectedOptions((current) =>
                              selected
                                ? current.filter((id) => id !== option.id)
                                : [...current, option.id]
                            )
                          }
                        >
                          <span className="course-option__marker">
                            {selected ? (
                              <Check className="size-3.5" />
                            ) : (
                              option.id.toUpperCase()
                            )}
                          </span>
                          <CourseMarkdown markdown={option.labelMarkdown} />
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="course-answer-wrap">
                    <div className="course-answer-toolbar">
                      <span>Write the reasoning in your own words</span>
                      <span>{answer.length.toLocaleString()} characters</span>
                    </div>
                    <textarea
                      value={answer}
                      onChange={(event) => setAnswer(event.target.value)}
                      placeholder={
                        activity.type === "proof"
                          ? "State your assumptions, then write the proof step by step…"
                          : "Show your reasoning, not only the final result…"
                      }
                      aria-label="Your solution"
                    />
                  </div>
                )}

                {submission.isError ? (
                  <p className="mt-3 text-sm text-[var(--course-red)]">
                    {submission.error instanceof Error
                      ? submission.error.message
                      : "The submission could not be saved."}
                  </p>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="max-w-md text-[11px] leading-5 text-[var(--course-muted)]">
                    {activity.type === "multiple_choice"
                      ? "Forge checks this answer deterministically and records the result as auditable course evidence."
                      : "Forge sends written work to your configured model connection. The reference solution remains hidden; your response is saved even if assessment is unavailable."}
                  </p>
                  <Button
                    size="lg"
                    className="course-submit"
                    disabled={!canSubmit}
                    pending={submission.isPending}
                    pendingLabel="Reviewing carefully…"
                    onClick={() => submission.mutate()}
                  >
                    <Sparkles className="size-4" />
                    {activitySubmissionLabel(activity.type)}
                  </Button>
                </div>
                </section>
              ) : null}

              {activeBlock?.type === "checkpoint" && latestFeedback ? (
                <FeedbackPanel feedback={latestFeedback} />
              ) : null}
              {activeBlock?.type === "checkpoint" ? (
                <CourseSectionNavigation
                  currentIndex={activeBlockIndex}
                  totalSteps={lessonFlow?.blocks.length ?? 0}
                  canContinue={Boolean(latestFeedback)}
                  continueLabel="Continue to the next section"
                  onPrevious={() =>
                    setActiveBlockIndex((current) =>
                      Math.max(0, current - 1)
                    )
                  }
                  onContinue={() =>
                    setActiveBlockIndex((current) => current + 1)
                  }
                />
              ) : null}

              <div className="course-lesson-nav">
                <Button
                  variant="secondary"
                  disabled={!session.previousLessonId}
                  onClick={() =>
                    session.previousLessonId &&
                    navigateLesson(session.previousLessonId)
                  }
                >
                  <ArrowLeft className="size-4" /> Previous day
                </Button>
                <Button
                  variant="secondary"
                  disabled={!session.nextLessonId || !lessonFlow?.complete}
                  onClick={() =>
                    session.nextLessonId && navigateLesson(session.nextLessonId)
                  }
                >
                  Next day <ArrowRight className="size-4" />
                </Button>
              </div>
              {session.nextLessonId && !lessonFlow?.complete ? (
                <p
                  className="mt-3 text-center text-xs text-[var(--course-muted)]"
                  role="status"
                >
                  Pass every required checkpoint to continue to the next day.
                  Your saved work remains available for revision.
                </p>
              ) : null}
            </div>
          </main>
          <div className="hidden xl:block" data-course-slot="concepts">
            <ConceptRail session={session} />
          </div>
        </CourseLessonLayoutView>
      </div>

      {outlineOpen ? (
        <CourseDrawer
          label="Course outline"
          onClose={() => setOutlineOpen(false)}
        >
          <CourseOutline
            session={session}
            onNavigate={navigateLesson}
            onClose={() => setOutlineOpen(false)}
          />
        </CourseDrawer>
      ) : null}
      {conceptsOpen ? (
        <CourseDrawer
          label="Concept ledger"
          side="right"
          onClose={() => setConceptsOpen(false)}
        >
          <div className="flex justify-end p-3">
            <button
              className="course-icon-button"
              onClick={() => setConceptsOpen(false)}
              aria-label="Close concept ledger"
            >
              <X className="size-4" />
            </button>
          </div>
          <ConceptRail session={session} />
        </CourseDrawer>
      ) : null}
    </div>
  );
}

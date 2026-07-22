import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpen,
  Brain,
  CalendarRange,
  Clock3,
  Download,
  Flame,
  Library,
  Repeat2,
  Sparkles,
  Trophy,
  Upload
} from "lucide-react";
import { Link } from "react-router-dom";
import { MasteryRing } from "@/components/courses/mastery-ring";
import { PageHero } from "@/components/shell/page-hero";
import { useForgeShell } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import {
  exportForgeCourse,
  importForgeCourse,
  listForgeConcepts,
  listForgeCourses
} from "@/lib/api";

function CourseTabs({ active }: { active: "courses" | "concepts" }) {
  return (
    <nav
      className="flex flex-wrap gap-1 border-b border-[var(--ui-border-subtle)] px-5 pt-2 sm:px-6 lg:px-7"
      aria-label="Learning library"
    >
      <Link
        className={
          active === "courses"
            ? "course-shell-tab is-active"
            : "course-shell-tab"
        }
        to="/courses"
      >
        <Library className="size-4" /> Courses
      </Link>
      <Link
        className={
          active === "concepts"
            ? "course-shell-tab is-active"
            : "course-shell-tab"
        }
        to="/concepts"
      >
        <Brain className="size-4" /> Concepts
      </Link>
      <Link className="course-shell-tab" to="/concepts?due=true">
        <Repeat2 className="size-4" /> Review queue
      </Link>
    </nav>
  );
}

export { CourseTabs };

export function CoursesPage() {
  const shell = useForgeShell();
  const userId = shell.selectedUserIds[0];
  const queryClient = useQueryClient();
  const importInputRef = useRef<HTMLInputElement>(null);
  const [transferMessage, setTransferMessage] = useState("");
  const courses = useQuery({
    queryKey: ["forge-courses", userId],
    queryFn: () => listForgeCourses(userId)
  });
  const due = useQuery({
    queryKey: ["forge-concepts", "due", userId],
    queryFn: () => listForgeConcepts({ userId, dueOnly: true })
  });
  const importer = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > 12 * 1024 * 1024) {
        throw new Error("Course packages must be 12 MB or smaller.");
      }
      return importForgeCourse(JSON.parse(await file.text()) as unknown);
    },
    onSuccess: async (result) => {
      setTransferMessage(
        `Imported ${result.course.title}: ${result.imported.lessons} lessons and ${result.imported.concepts} concept links.`
      );
      await queryClient.invalidateQueries({ queryKey: ["forge-courses"] });
      await queryClient.invalidateQueries({ queryKey: ["forge-concepts"] });
    },
    onError: (error) => {
      setTransferMessage(
        error instanceof Error
          ? error.message
          : "The course could not be imported."
      );
    }
  });

  const exportPackage = async (courseId: string, slug: string) => {
    try {
      const exported = await exportForgeCourse(courseId);
      const url = URL.createObjectURL(exported.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = exported.fileName ?? `${slug}.forge-course.json`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setTransferMessage(`Exported ${slug}.forge-course.json.`);
    } catch (error) {
      setTransferMessage(
        error instanceof Error
          ? error.message
          : "The course could not be exported."
      );
    }
  };

  return (
    <div className="grid gap-0">
      <PageHero
        eyebrow="Learn in Forge"
        title={<span className="font-editorial">Courses & concepts</span>}
        titleText="Courses and concepts"
        description="Follow structured courses, write real proofs, and build a concept record that carries across every course you take."
        copyMode="title_plus_orientation"
        actions={
          <div className="flex flex-wrap gap-2">
            <input
              ref={importInputRef}
              type="file"
              accept=".json,.forge-course.json,application/json"
              className="sr-only"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) importer.mutate(file);
                event.currentTarget.value = "";
              }}
            />
            <button
              type="button"
              className="inline-flex min-h-10 items-center gap-2 rounded-[var(--radius-control)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 text-sm font-semibold text-[var(--ui-ink-strong)]"
              disabled={importer.isPending}
              onClick={() => importInputRef.current?.click()}
            >
              <Upload className="size-4 text-[var(--secondary)]" />
              {importer.isPending ? "Validating…" : "Import course"}
            </button>
            <Link
              to="/concepts?due=true"
              className="inline-flex min-h-10 items-center gap-2 rounded-[var(--radius-control)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 text-sm font-semibold text-[var(--ui-ink-strong)]"
            >
              <Repeat2 className="size-4 text-[var(--tertiary)]" /> Review due
              concepts
            </Link>
          </div>
        }
      />
      <CourseTabs active="courses" />

      <div className="grid gap-6 px-5 py-6 sm:px-6 lg:px-7">
        {transferMessage ? (
          <p
            role="status"
            className="rounded-[var(--radius-control)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3 text-sm text-[var(--ui-ink-soft)]"
          >
            {transferMessage}
          </p>
        ) : null}
        {courses.isLoading ? (
          <LoadingState
            eyebrow="Course library"
            title="Opening the library"
            description="Loading course paths and your current standing."
          />
        ) : courses.isError ? (
          <ErrorState
            eyebrow="Course library"
            error={courses.error}
            onRetry={() => void courses.refetch()}
          />
        ) : (
          <>
            <section>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="type-label text-[var(--ui-ink-faint)]">
                    Your learning paths
                  </div>
                  <h2 className="mt-1 font-editorial text-3xl text-[var(--ui-ink-strong)]">
                    Courses
                  </h2>
                </div>
                <span className="text-sm text-[var(--ui-ink-soft)]">
                  {courses.data?.courses.length ?? 0} available
                </span>
              </div>
              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                {courses.data?.courses.map((course) => {
                  const startLesson =
                    course.progress.currentLessonId ??
                    course.featuredLessonId ??
                    course.entryLessonId;
                  return (
                    <Card
                      key={course.id}
                      className="course-library-card overflow-hidden p-0"
                    >
                      <div className="course-library-card__band" />
                      <div className="grid gap-5 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-6">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge size="sm" tone="signal">
                              {course.estimatedWeeks} weeks
                            </Badge>
                            {course.tags.slice(0, 2).map((tag) => (
                              <Badge key={tag} size="sm" tone="meta">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                          <h3 className="mt-4 max-w-2xl font-editorial text-[clamp(1.75rem,3vw,2.65rem)] leading-[1.05] text-[var(--ui-ink-strong)]">
                            {course.title}
                          </h3>
                          <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--ui-ink-soft)]">
                            {course.subtitle || course.description}
                          </p>
                          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[var(--ui-ink-soft)]">
                            <span className="flex items-center gap-1.5">
                              <CalendarRange className="size-3.5" />{" "}
                              {course.progress.completedLessons}/
                              {course.progress.totalLessons} daily lessons
                            </span>
                            <span className="flex items-center gap-1.5">
                              <Clock3 className="size-3.5" />{" "}
                              {course.minutesPerWeek} min/week
                            </span>
                            <span className="flex items-center gap-1.5">
                              <Trophy className="size-3.5" />{" "}
                              {course.progress.pointsEarned} points
                            </span>
                          </div>
                          <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-[var(--ui-surface-2)]">
                            <div
                              className="h-full rounded-full bg-[var(--tertiary)]"
                              style={{
                                width: `${Math.max(1, course.progress.progressPercent)}%`
                              }}
                            />
                          </div>
                          <div className="mt-2 flex justify-between text-[10px] uppercase tracking-[0.12em] text-[var(--ui-ink-faint)]">
                            <span>
                              {course.progress.progressPercent}% complete
                            </span>
                            <span>
                              {course.progress.grade
                                ? `Grade ${course.progress.grade}`
                                : "First proof awaits"}
                            </span>
                          </div>
                        </div>
                        <div className="flex min-w-36 flex-row items-center justify-between gap-4 border-t border-[var(--ui-border-subtle)] pt-4 sm:flex-col sm:justify-center sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
                          <div className="text-center">
                            <div className="font-editorial text-4xl text-[var(--ui-ink-strong)]">
                              {course.progress.grade ?? "—"}
                            </div>
                            <div className="mt-1 text-[10px] uppercase tracking-[0.12em] text-[var(--ui-ink-faint)]">
                              Course grade
                            </div>
                          </div>
                          <Link
                            to={`/courses/${course.slug}/learn?lesson=${startLesson}`}
                            className="course-library-start"
                          >
                            {course.progress.completedLessons > 0
                              ? "Continue"
                              : "Begin"}{" "}
                            <ArrowRight className="size-4" />
                          </Link>
                          <Link
                            to={`/courses/${course.slug}`}
                            className="text-xs text-[var(--ui-ink-soft)] underline decoration-[var(--ui-border-strong)] underline-offset-4"
                          >
                            View syllabus
                          </Link>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 text-xs text-[var(--ui-ink-soft)] underline decoration-[var(--ui-border-strong)] underline-offset-4"
                            onClick={() =>
                              void exportPackage(course.id, course.slug)
                            }
                          >
                            <Download className="size-3.5" /> Export package
                          </button>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <Card className="p-5 sm:p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="type-label text-[var(--secondary)]">
                      Concepts, not checkboxes
                    </div>
                    <h2 className="mt-2 font-editorial text-3xl text-[var(--ui-ink-strong)]">
                      One ledger for what you actually know
                    </h2>
                  </div>
                  <Brain className="size-7 text-[var(--secondary)]" />
                </div>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--ui-ink-soft)]">
                  Every graded proof adds evidence to the concepts it uses.
                  Mastery, review dates, examples, and course appearances stay
                  attached to the concept itself—so learning transfers instead
                  of resetting.
                </p>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <div className="course-learning-principle">
                    <Sparkles className="size-4" />
                    <strong>Proof feedback</strong>
                    <span>Specific gaps, not answer reveal</span>
                  </div>
                  <div className="course-learning-principle">
                    <Flame className="size-4" />
                    <strong>Spaced review</strong>
                    <span>Recall when memory needs it</span>
                  </div>
                  <div className="course-learning-principle">
                    <BookOpen className="size-4" />
                    <strong>Cross-course</strong>
                    <span>One concept, many paths</span>
                  </div>
                </div>
              </Card>

              <Card className="p-5 sm:p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="type-label text-[var(--tertiary)]">
                      Recall queue
                    </div>
                    <h2 className="mt-1 font-editorial text-2xl text-[var(--ui-ink-strong)]">
                      Due now
                    </h2>
                  </div>
                  <Repeat2 className="size-5 text-[var(--tertiary)]" />
                </div>
                <div className="mt-4 grid gap-2">
                  {due.data?.concepts.slice(0, 3).map((concept) => (
                    <Link
                      key={concept.id}
                      to={`/concepts/${concept.slug}`}
                      className="flex items-center gap-3 rounded-[var(--radius-control)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3 hover:border-[var(--ui-border-strong)]"
                    >
                      <MasteryRing
                        value={concept.mastery.masteryScore}
                        size={46}
                      />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-[var(--ui-ink-strong)]">
                          {concept.title}
                        </div>
                        <div className="mt-0.5 text-xs text-[var(--ui-ink-soft)]">
                          Review due
                        </div>
                      </div>
                    </Link>
                  ))}
                  {!due.isLoading && (due.data?.concepts.length ?? 0) === 0 ? (
                    <p className="rounded-[var(--radius-control)] border border-dashed border-[var(--ui-border-subtle)] p-4 text-sm leading-6 text-[var(--ui-ink-soft)]">
                      No concepts are due yet. Your first graded proof will
                      start the review schedule.
                    </p>
                  ) : null}
                </div>
                <Link
                  to="/concepts?due=true"
                  className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[var(--primary)]"
                >
                  Open review queue <ArrowRight className="size-4" />
                </Link>
              </Card>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

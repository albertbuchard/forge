import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Brain,
  CalendarRange,
  Check,
  Clock3,
  ExternalLink,
  Library,
  Lock,
  Trophy
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { MasteryRing } from "@/components/courses/mastery-ring";
import { PageHero } from "@/components/shell/page-hero";
import { useForgeShell } from "@/components/shell/app-shell";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import { getForgeCourse, upgradeForgeCourseEnrollment } from "@/lib/api";

export function CourseDetailPage() {
  const { courseId = "" } = useParams();
  const shell = useForgeShell();
  const userId = shell.selectedUserIds[0];
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["forge-course", courseId, userId],
    queryFn: () => getForgeCourse(courseId, userId)
  });
  const lessons = query.data?.lessons;
  const upgrade = useMutation({
    mutationFn: () => upgradeForgeCourseEnrollment(courseId, userId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["forge-course", courseId]
      });
      await queryClient.invalidateQueries({
        queryKey: ["forge-course-learn", courseId]
      });
    }
  });
  const lessonsByModule = useMemo(() => {
    const map = new Map<string, NonNullable<typeof lessons>>();
    for (const lesson of lessons ?? []) {
      const current = map.get(lesson.moduleId) ?? [];
      current.push(lesson);
      map.set(lesson.moduleId, current);
    }
    return map;
  }, [lessons]);

  if (query.isLoading)
    return (
      <div className="p-6">
        <LoadingState eyebrow="Course" title="Opening the syllabus" />
      </div>
    );
  if (query.isError || !query.data)
    return (
      <div className="p-6">
        <ErrorState
          eyebrow="Course"
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      </div>
    );

  const { course, release, progress, modules, concepts, resources } =
    query.data;
  const startLesson =
    (progress.currentLessonId &&
    query.data.lessons.some(
      (lesson) => lesson.id === progress.currentLessonId && lesson.unlocked
    )
      ? progress.currentLessonId
      : query.data.lessons.find((lesson) => lesson.unlocked && !lesson.completed)
          ?.id) ??
    query.data.lessons.find((lesson) => lesson.unlocked)?.id ??
    course.entryLessonId;
  return (
    <div>
      <PageHero
        eyebrow="Forge course"
        title={<h1 className="font-editorial">{course.title}</h1>}
        titleText={course.title}
        description={course.subtitle || course.description}
        copyMode="title_plus_orientation"
        badge={`${course.estimatedWeeks} weeks`}
        actions={
          <Link
            to={`/courses/${course.slug}/learn?lesson=${startLesson}`}
            className="course-library-start min-h-11 px-5"
          >
            {progress.completedLessons > 0 ? "Continue course" : "Begin course"}{" "}
            <ArrowRight className="size-4" />
          </Link>
        }
      />

      <div className="grid gap-6 px-5 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_21rem] lg:px-7">
        <main className="min-w-0">
          <Link
            to="/courses"
            className="inline-flex items-center gap-2 text-sm text-[var(--ui-ink-soft)]"
          >
            <ArrowLeft className="size-4" /> Course library
          </Link>
          {release.updateAvailable ? (
            <Card className="mt-4 border-[var(--primary)] p-5">
              <div className="type-label text-[var(--primary)]">
                Course update available
              </div>
              <h2 className="mt-2 font-editorial text-2xl text-[var(--ui-ink-strong)]">
                Review and move to version {release.latestVersion}
              </h2>
              <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
                You are learning from version {release.enrolledVersion}. Forge
                keeps that release unchanged until you choose to update. Passed
                work carries forward only when the activity itself is unchanged.
              </p>
              <button
                type="button"
                className="course-library-start mt-4 min-h-11 px-5"
                disabled={upgrade.isPending}
                onClick={() => upgrade.mutate()}
              >
                {upgrade.isPending ? "Checking saved work…" : "Update course"}
              </button>
              {upgrade.isError ? (
                <p className="mt-3 text-sm text-[var(--danger)]">
                  The update could not be completed. Your current course and
                  saved work have not changed.
                </p>
              ) : null}
            </Card>
          ) : null}
          <Card className="mt-4 grid gap-5 p-5 sm:grid-cols-4 sm:p-6">
            <div className="course-detail-stat">
              <strong>{progress.progressPercent}%</strong>
              <span>complete</span>
            </div>
            <div className="course-detail-stat">
              <strong>{progress.grade ?? "—"}</strong>
              <span>course grade</span>
            </div>
            <div className="course-detail-stat">
              <strong>{progress.pointsEarned}</strong>
              <span>points earned</span>
            </div>
            <div className="course-detail-stat">
              <strong>
                {progress.completedLessons}/{progress.totalLessons}
              </strong>
              <span>days completed</span>
            </div>
          </Card>

          <section className="mt-7">
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="type-label text-[var(--secondary)]">
                  The full path
                </div>
                <h2 className="mt-1 font-editorial text-3xl text-[var(--ui-ink-strong)]">
                  Syllabus
                </h2>
              </div>
              <div className="hidden items-center gap-4 text-xs text-[var(--ui-ink-soft)] sm:flex">
                <span className="flex items-center gap-1.5">
                  <CalendarRange className="size-3.5" /> {course.estimatedWeeks}{" "}
                  weeks
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock3 className="size-3.5" /> {course.minutesPerWeek}{" "}
                  min/week
                </span>
              </div>
            </div>
            <div className="mt-4 grid gap-3">
              {modules.map((module) => {
                const lessons = lessonsByModule.get(module.id) ?? [];
                const weeks = [
                  ...new Set(lessons.map((lesson) => lesson.week))
                ];
                return (
                  <details
                    key={module.id}
                    className="course-module-card"
                    open={
                      module.id ===
                      query.data.lessons.find(
                        (lesson) => lesson.id === startLesson
                      )?.moduleId
                    }
                  >
                    <summary>
                      <span className="course-module-card__number">
                        {module.order + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block font-editorial text-xl font-semibold text-[var(--ui-ink-strong)]">
                          {module.title}
                        </span>
                        <span className="mt-1 block text-xs text-[var(--ui-ink-soft)]">
                          Weeks {module.startWeek}–{module.endWeek} ·{" "}
                          {lessons.length} daily lessons
                        </span>
                      </span>
                      <ArrowRight className="ml-auto size-4 text-[var(--ui-ink-faint)]" />
                    </summary>
                    <p className="px-4 pb-3 pl-[4.4rem] text-sm leading-6 text-[var(--ui-ink-soft)]">
                      {module.description}
                    </p>
                    <div className="grid border-t border-[var(--ui-border-subtle)] sm:grid-cols-2 xl:grid-cols-3">
                      {weeks.map((week) => {
                        const weekLessons = lessons.filter(
                          (lesson) => lesson.week === week
                        );
                        const first = weekLessons[0]!;
                        const completed = weekLessons.filter(
                          (lesson) => lesson.completed
                        ).length;
                        const weekContent = (
                          <>
                            <div className="flex items-center justify-between">
                              <span className="type-label text-[var(--tertiary)]">
                                Week {week}
                              </span>
                              {completed > 0 ? (
                                <span className="flex items-center gap-1 text-[10px] text-[var(--secondary)]">
                                  <Check className="size-3" /> {completed}/5
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-2 line-clamp-2 text-sm font-semibold leading-5 text-[var(--ui-ink-strong)]">
                              {first.title.split(" · ").at(-1)}
                            </div>
                            <div className="mt-2 text-xs text-[var(--ui-ink-soft)]">
                              {first.unlocked ? (
                                <>
                                  Open daily work{" "}
                                  <ArrowRight className="ml-1 inline size-3" />
                                </>
                              ) : (
                                <>
                                  <Lock className="mr-1 inline size-3" />
                                  Complete the preceding week first
                                </>
                              )}
                            </div>
                          </>
                        );
                        return first.unlocked ? (
                          <Link
                            key={week}
                            to={`/courses/${course.slug}/learn?lesson=${first.id}`}
                            className="course-week-link"
                          >
                            {weekContent}
                          </Link>
                        ) : (
                          <div
                            key={week}
                            className="course-week-link opacity-65"
                            aria-label={`Week ${week} is locked until the preceding week is complete`}
                          >
                            {weekContent}
                          </div>
                        );
                      })}
                    </div>
                  </details>
                );
              })}
            </div>
          </section>
        </main>

        <aside className="grid content-start gap-4">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div className="type-label text-[var(--secondary)]">
                Concept coverage
              </div>
              <Brain className="size-4 text-[var(--secondary)]" />
            </div>
            <h2 className="mt-2 font-editorial text-2xl text-[var(--ui-ink-strong)]">
              {concepts.length} durable ideas
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
              Proof evidence updates these entities directly, even when they
              reappear in another course.
            </p>
            <div className="mt-4 grid gap-2">
              {concepts.slice(0, 8).map((concept) => (
                <Link
                  key={concept.id}
                  to={`/concepts/${concept.slug}`}
                  className="flex items-center gap-3 rounded-[var(--radius-control)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-2.5"
                >
                  <MasteryRing value={concept.mastery.masteryScore} size={42} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[var(--ui-ink-strong)]">
                      {concept.title}
                    </div>
                    <div className="mt-0.5 text-[10px] text-[var(--ui-ink-faint)]">
                      {concept.mastery.evidenceCount} evidence
                    </div>
                  </div>
                </Link>
              ))}
            </div>
            <Link
              to={`/concepts`}
              className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[var(--primary)]"
            >
              Open concept atlas <ArrowRight className="size-4" />
            </Link>
          </Card>
          {resources.length > 0 ? (
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <div className="type-label text-[var(--primary)]">
                  Course library
                </div>
                <Library className="size-4 text-[var(--primary)]" />
              </div>
              <h2 className="mt-2 font-editorial text-2xl text-[var(--ui-ink-strong)]">
                Sources and references
              </h2>
              <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
                Use these alongside the authored daily work. A reference can
                support a proof, but it cannot replace writing the proof.
              </p>
              <div className="mt-4 grid gap-2">
                {resources.map((resource) => (
                  <a
                    key={resource.id}
                    href={resource.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group rounded-[var(--radius-control)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3 transition-colors hover:border-[var(--ui-border-strong)]"
                  >
                    <span className="flex items-start justify-between gap-3 text-sm font-semibold text-[var(--ui-ink-strong)]">
                      {resource.label}
                      <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-[var(--ui-ink-faint)] transition-colors group-hover:text-[var(--primary)]" />
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-[var(--ui-ink-soft)]">
                      {resource.description}
                    </span>
                  </a>
                ))}
              </div>
            </Card>
          ) : null}
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div className="type-label text-[var(--tertiary)]">
                Course standing
              </div>
              <Trophy className="size-4 text-[var(--tertiary)]" />
            </div>
            <div className="mt-4 flex items-end justify-between">
              <div className="font-editorial text-5xl text-[var(--ui-ink-strong)]">
                {progress.grade ?? "—"}
              </div>
              <div className="text-right">
                <strong className="text-xl text-[var(--ui-ink-strong)]">
                  {progress.averageScore ?? "—"}
                </strong>
                <span className="block text-[10px] text-[var(--ui-ink-faint)]">
                  average
                </span>
              </div>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

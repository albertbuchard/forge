import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Brain,
  CalendarClock,
  Network,
  Repeat2,
  Trophy
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { CourseMarkdown } from "@/components/courses/course-markdown";
import { MasteryRing } from "@/components/courses/mastery-ring";
import { PageHero } from "@/components/shell/page-hero";
import { useForgeShell } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import { getForgeConcept } from "@/lib/api";

export function ConceptDetailPage() {
  const { conceptId = "" } = useParams();
  const shell = useForgeShell();
  const userId = shell.selectedUserIds[0];
  const query = useQuery({
    queryKey: ["forge-concept", conceptId, userId],
    queryFn: () => getForgeConcept(conceptId, userId)
  });

  if (query.isLoading)
    return (
      <div className="p-6">
        <LoadingState eyebrow="Concept" title="Opening the concept record" />
      </div>
    );
  if (query.isError || !query.data)
    return (
      <div className="p-6">
        <ErrorState
          eyebrow="Concept"
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      </div>
    );

  const { concept, courses, lessons, evidence } = query.data;
  const practice = lessons[0];
  return (
    <div>
      <PageHero
        eyebrow="Forge concept entity"
        title={<h1 className="font-editorial">{concept.title}</h1>}
        titleText={concept.title}
        description={concept.summary}
        copyMode="title_plus_orientation"
        badge={`${concept.courseCount} course${concept.courseCount === 1 ? "" : "s"}`}
        actions={
          practice ? (
            <Link
              to={`/courses/${practice.courseId}/learn?lesson=${practice.id}`}
              className="course-library-start min-h-11 px-5"
            >
              {concept.mastery.due ? (
                <Repeat2 className="size-4" />
              ) : (
                <BookOpen className="size-4" />
              )}{" "}
              {concept.mastery.due ? "Review concept" : "Practice in course"}
            </Link>
          ) : null
        }
      />

      <div className="grid gap-6 px-5 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:px-7">
        <main className="min-w-0">
          <Link
            to="/concepts"
            className="inline-flex items-center gap-2 text-sm text-[var(--ui-ink-soft)]"
          >
            <ArrowLeft className="size-4" /> Concept atlas
          </Link>
          <Card className="mt-4 p-5 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-5 border-b border-[var(--ui-border-subtle)] pb-5">
              <div>
                <div className="type-label text-[var(--secondary)]">
                  Canonical definition
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {concept.tags.map((tag) => (
                    <Badge key={tag} size="sm" tone="meta">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
              <MasteryRing value={concept.mastery.masteryScore} size={76} />
            </div>
            <CourseMarkdown
              markdown={concept.definitionMarkdown}
              className="mt-6 text-lg"
            />
            <div className="mt-7 grid gap-4 md:grid-cols-2">
              <section className="concept-example is-example">
                <div className="type-label text-[var(--secondary)]">
                  Example
                </div>
                <CourseMarkdown
                  markdown={
                    concept.exampleMarkdown || "No example has been added yet."
                  }
                  className="mt-2 text-sm"
                />
              </section>
              <section className="concept-example is-nonexample">
                <div className="type-label text-[var(--tertiary)]">
                  Nonexample
                </div>
                <CourseMarkdown
                  markdown={
                    concept.nonExampleMarkdown ||
                    "No nonexample has been added yet."
                  }
                  className="mt-2 text-sm"
                />
              </section>
            </div>
          </Card>

          <section className="mt-7">
            <div className="flex items-center justify-between">
              <div>
                <div className="type-label text-[var(--primary)]">
                  Where it appears
                </div>
                <h2 className="mt-1 font-editorial text-3xl text-[var(--ui-ink-strong)]">
                  Course appearances
                </h2>
              </div>
              <Network className="size-5 text-[var(--primary)]" />
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {courses.map((course) => (
                <Card key={course.id} className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="type-label text-[var(--ui-ink-faint)]">
                        Course
                      </div>
                      <h3 className="mt-2 font-editorial text-xl font-semibold text-[var(--ui-ink-strong)]">
                        {course.title}
                      </h3>
                    </div>
                    <Badge size="sm" tone="signal">
                      {course.progress.progressPercent}%
                    </Badge>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
                    {course.subtitle}
                  </p>
                  <Link
                    to={`/courses/${course.slug}`}
                    className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[var(--primary)]"
                  >
                    View course <ArrowRight className="size-4" />
                  </Link>
                </Card>
              ))}
            </div>
          </section>

          {evidence.length > 0 ? (
            <section className="mt-7">
              <div>
                <div className="type-label text-[var(--secondary)]">
                  What the grades are based on
                </div>
                <h2 className="mt-1 font-editorial text-3xl text-[var(--ui-ink-strong)]">
                  Evidence history
                </h2>
              </div>
              <div className="mt-4 grid gap-2">
                {evidence.map((entry, index) => (
                  <Card
                    key={`${entry.activityId}-${entry.createdAt}-${index}`}
                    className="grid gap-3 p-4 sm:grid-cols-[4rem_minmax(0,1fr)_auto] sm:items-center"
                  >
                    <div className="font-editorial text-2xl text-[var(--ui-ink-strong)]">
                      {entry.score}
                    </div>
                    <p className="text-sm leading-6 text-[var(--ui-ink-soft)]">
                      {entry.evidenceMarkdown}
                    </p>
                    <Link
                      to={`/courses/${entry.courseId}/learn?lesson=${entry.lessonId}`}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--primary)]"
                    >
                      Open proof <ArrowRight className="size-3" />
                    </Link>
                  </Card>
                ))}
              </div>
            </section>
          ) : null}
        </main>

        <aside className="grid content-start gap-4">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div className="type-label text-[var(--secondary)]">
                Mastery record
              </div>
              <Brain className="size-4 text-[var(--secondary)]" />
            </div>
            <div className="mt-5 flex items-center gap-4">
              <MasteryRing value={concept.mastery.masteryScore} size={84} />
              <div>
                <div className="font-editorial text-3xl text-[var(--ui-ink-strong)]">
                  {concept.mastery.masteryScore}%
                </div>
                <div className="mt-1 text-xs text-[var(--ui-ink-soft)]">
                  current mastery
                </div>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <div className="concept-metric">
                <strong>{concept.mastery.evidenceCount}</strong>
                <span>evidence</span>
              </div>
              <div className="concept-metric">
                <strong>{concept.mastery.averageScore || "—"}</strong>
                <span>average</span>
              </div>
            </div>
            {concept.mastery.dimensions.length > 0 ? (
              <div className="mt-5 border-t border-[var(--ui-border-subtle)] pt-4">
                <div className="type-label text-[var(--ui-ink-faint)]">
                  Evidence dimensions
                </div>
                <div className="mt-3 grid gap-3">
                  {concept.mastery.dimensions.map((dimension) => (
                    <div key={dimension.id}>
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="font-semibold capitalize text-[var(--ui-ink-strong)]">
                          {dimension.id.replaceAll("_", " ")}
                        </span>
                        <span className="text-[var(--ui-ink-soft)]">
                          {dimension.masteryScore}%
                        </span>
                      </div>
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--ui-surface-2)]">
                        <div
                          className="h-full rounded-full bg-[var(--secondary)]"
                          style={{ width: `${dimension.masteryScore}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="mt-4 flex items-start gap-2 border-t border-[var(--ui-border-subtle)] pt-4 text-xs leading-5 text-[var(--ui-ink-soft)]">
              <CalendarClock className="mt-0.5 size-4 shrink-0 text-[var(--tertiary)]" />
              <span>
                {concept.mastery.due
                  ? "Review is due now."
                  : concept.mastery.nextReviewAt
                    ? `Next review ${new Date(concept.mastery.nextReviewAt).toLocaleDateString()}.`
                    : "The first graded activity will schedule a review."}
              </span>
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div className="type-label text-[var(--tertiary)]">
                Connections
              </div>
              <Network className="size-4 text-[var(--tertiary)]" />
            </div>
            <div className="mt-4">
              <div className="text-xs font-semibold text-[var(--ui-ink-strong)]">
                Prerequisites
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {concept.prerequisiteConceptIds.length > 0 ? (
                  concept.prerequisiteConceptIds.map((id) => (
                    <Link key={id} to={`/concepts/${id}`}>
                      <Badge size="sm" tone="meta">
                        {id.replaceAll("-", " ")}
                      </Badge>
                    </Link>
                  ))
                ) : (
                  <span className="text-xs text-[var(--ui-ink-faint)]">
                    None
                  </span>
                )}
              </div>
            </div>
            <div className="mt-4 border-t border-[var(--ui-border-subtle)] pt-4">
              <div className="text-xs font-semibold text-[var(--ui-ink-strong)]">
                Related concepts
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {concept.relatedConceptIds.map((id) => (
                  <Link key={id} to={`/concepts/${id}`}>
                    <Badge size="sm" tone="meta">
                      {id.replaceAll("-", " ")}
                    </Badge>
                  </Link>
                ))}
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div className="type-label text-[var(--ui-ink-faint)]">
                Learning outcome
              </div>
              <Trophy className="size-4 text-[var(--tertiary)]" />
            </div>
            <p className="mt-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
              Mastery moves only when a graded response provides evidence.
              Reading alone does not inflate the score.
            </p>
          </Card>
        </aside>
      </div>
    </div>
  );
}

import { useDeferredValue, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Brain, Network, Repeat2, Search } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { MasteryRing } from "@/components/courses/mastery-ring";
import { CourseTabs } from "@/pages/courses-page";
import { PageHero } from "@/components/shell/page-hero";
import { useForgeShell } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import { listForgeConcepts } from "@/lib/api";

export function ConceptsPage() {
  const shell = useForgeShell();
  const userId = shell.selectedUserIds[0];
  const [searchParams, setSearchParams] = useSearchParams();
  const dueOnly = searchParams.get("due") === "true";
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const concepts = useQuery({
    queryKey: ["forge-concepts", userId, deferredQuery, dueOnly],
    queryFn: () => listForgeConcepts({ userId, query: deferredQuery, dueOnly })
  });

  return (
    <div>
      <PageHero
        eyebrow="Forge entities"
        title={<span className="font-editorial">Concept atlas</span>}
        titleText="Concept atlas"
        description="Browse the durable ideas behind your courses. Each concept carries definitions, dependencies, proof evidence, mastery, and its own recall schedule."
        copyMode="title_plus_orientation"
        actions={
          <button
            className={
              dueOnly ? "course-due-toggle is-active" : "course-due-toggle"
            }
            onClick={() => setSearchParams(dueOnly ? {} : { due: "true" })}
          >
            <Repeat2 className="size-4" />{" "}
            {dueOnly ? "Showing due reviews" : "Show due reviews"}
          </button>
        }
      />
      <CourseTabs active="concepts" />

      <div className="grid gap-5 px-5 py-6 sm:px-6 lg:px-7">
        <Card className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-5">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[var(--ui-ink-faint)]" />
            <Input
              className="pl-11"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search concepts, definitions, or tags…"
            />
          </label>
          <div className="flex items-center gap-3 text-sm text-[var(--ui-ink-soft)]">
            <Brain className="size-4 text-[var(--secondary)]" />
            <span>{concepts.data?.concepts.length ?? 0} concepts</span>
            {dueOnly ? (
              <Badge size="sm" tone="signal">
                Review queue
              </Badge>
            ) : null}
          </div>
        </Card>

        {concepts.isLoading ? (
          <LoadingState
            eyebrow="Concept atlas"
            title="Mapping your concepts"
            description="Loading definitions, course connections, and mastery evidence."
          />
        ) : concepts.isError ? (
          <ErrorState
            eyebrow="Concept atlas"
            error={concepts.error}
            onRetry={() => void concepts.refetch()}
          />
        ) : (concepts.data?.concepts.length ?? 0) === 0 ? (
          <Card className="grid place-items-center gap-3 py-14 text-center">
            <Network className="size-8 text-[var(--ui-ink-faint)]" />
            <h2 className="font-editorial text-2xl text-[var(--ui-ink-strong)]">
              {dueOnly ? "Nothing is due" : "No matching concepts"}
            </h2>
            <p className="max-w-md text-sm leading-6 text-[var(--ui-ink-soft)]">
              {dueOnly
                ? "Complete a graded activity to begin a concept’s spaced review cycle."
                : "Try a broader search term."}
            </p>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {(concepts.data?.concepts ?? []).map((concept) => (
              <Link
                key={concept.id}
                to={`/concepts/${concept.slug}`}
                className="course-atlas-card"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap gap-1.5">
                      {concept.tags.slice(0, 2).map((tag) => (
                        <Badge key={tag} size="xs" tone="meta">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                    <h2 className="mt-3 font-editorial text-2xl font-semibold text-[var(--ui-ink-strong)]">
                      {concept.title}
                    </h2>
                  </div>
                  <MasteryRing value={concept.mastery.masteryScore} />
                </div>
                <p className="mt-3 line-clamp-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
                  {concept.summary}
                </p>
                <div className="mt-5 grid grid-cols-3 gap-2 border-t border-[var(--ui-border-subtle)] pt-4 text-center">
                  <div>
                    <strong>{concept.mastery.evidenceCount}</strong>
                    <span>evidence</span>
                  </div>
                  <div>
                    <strong>{concept.courseCount}</strong>
                    <span>courses</span>
                  </div>
                  <div>
                    <strong>{concept.mastery.averageScore || "—"}</strong>
                    <span>average</span>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between text-xs">
                  <span
                    className={
                      concept.mastery.due
                        ? "font-semibold text-[var(--tertiary)]"
                        : "text-[var(--ui-ink-faint)]"
                    }
                  >
                    {concept.mastery.due
                      ? "Review due now"
                      : concept.mastery.nextReviewAt
                        ? `Next review ${new Date(concept.mastery.nextReviewAt).toLocaleDateString()}`
                        : "No evidence yet"}
                  </span>
                  <ArrowRight className="size-4 text-[var(--primary)]" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

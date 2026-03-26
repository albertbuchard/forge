import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { PsycheSectionNav } from "@/components/psyche/psyche-section-nav";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/page-state";
import { createModeGuideSession, listModeGuideSessions } from "@/lib/api";
import { collectQueryCollectionState, retryQueryCollection } from "@/lib/query-collection";
import { modeGuideSessionSchema } from "@/lib/psyche-schemas";
import type { ModeGuideSessionInput } from "@/lib/psyche-types";

type GuideFormShape = {
  summary: string;
  copingResponse: string;
  childState: string;
  criticStyle: string;
  healthyContact: string;
};

const OPTIONS = {
  copingResponse: [
    { value: "fight", label: "Fight" },
    { value: "flight", label: "Flight" },
    { value: "freeze", label: "Freeze" },
    { value: "detach", label: "Detach" },
    { value: "comply", label: "Comply" },
    { value: "overcompensate", label: "Overcompensate" },
    { value: "none", label: "Mixed / unsure" }
  ],
  childState: [
    { value: "vulnerable", label: "Vulnerable" },
    { value: "angry", label: "Angry" },
    { value: "impulsive", label: "Impulsive" },
    { value: "lonely", label: "Lonely" },
    { value: "ashamed", label: "Ashamed" },
    { value: "none", label: "Mixed / unsure" }
  ],
  criticStyle: [
    { value: "demanding", label: "Demanding" },
    { value: "punitive", label: "Punitive" },
    { value: "none", label: "Neither / unclear" }
  ],
  healthyContact: [
    { value: "healthy_adult", label: "Healthy adult" },
    { value: "happy_child", label: "Happy child" },
    { value: "none", label: "Hard to access right now" }
  ]
} as const;

export function PsycheModeGuidePage() {
  const queryClient = useQueryClient();
  const sessionsQuery = useQuery({
    queryKey: ["forge-psyche-mode-guide-sessions"],
    queryFn: listModeGuideSessions
  });
  const form = useForm<GuideFormShape>({
    defaultValues: {
      summary: "What mode was most present in this moment?",
      copingResponse: "none",
      childState: "none",
      criticStyle: "none",
      healthyContact: "none"
    }
  });

  const guideMutation = useMutation({
    mutationFn: async (values: GuideFormShape) => {
      const payload = modeGuideSessionSchema.parse({
        summary: values.summary,
        answers: [
          { questionKey: "coping_response", value: values.copingResponse },
          { questionKey: "child_state", value: values.childState },
          { questionKey: "critic_style", value: values.criticStyle },
          { questionKey: "healthy_contact", value: values.healthyContact }
        ]
      } satisfies ModeGuideSessionInput);
      return createModeGuideSession(payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["forge-psyche-mode-guide-sessions"] });
    }
  });

  const routeQueries = [sessionsQuery] as const;
  const routeState = collectQueryCollectionState(routeQueries);
  const latestSession = guideMutation.data?.session ?? sessionsQuery.data?.sessions?.[0];

  if (routeState.isLoading) {
    return (
      <LoadingState
        eyebrow="Mode guide"
        title="Loading guided sessions"
        description="Hydrating previous mode-guide runs and the latest stored readings."
      />
    );
  }

  if (routeState.error) {
    return <ErrorState eyebrow="Mode guide" error={routeState.error} onRetry={() => void retryQueryCollection(routeQueries)} />;
  }

  return (
    <div className="grid gap-5">
      <PageHero
        eyebrow="Mode guide"
        title="Guided Mode Identification"
        description="A short guided pass can help separate coping responses, child states, critic pressure, and whatever healthy contact is still available."
        badge={`${sessionsQuery.data?.sessions.length ?? 0} sessions`}
        actions={
          <Link to="/psyche/modes">
            <Button variant="secondary">Back to mode map</Button>
          </Link>
        }
      />
      <PsycheSectionNav />

      <section className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card className="bg-[linear-gradient(180deg,rgba(16,20,30,0.96),rgba(11,15,24,0.94))]">
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Guided questionnaire</div>
          <form className="mt-4 grid gap-5" onSubmit={form.handleSubmit(async (values) => guideMutation.mutateAsync(values))}>
            <label className="grid gap-2">
              <span className="text-sm text-white/58">Prompt</span>
              <input className="w-full rounded-2xl border border-white/8 bg-white/6 px-4 py-3 text-sm text-white outline-none placeholder:text-white/35" {...form.register("summary")} />
            </label>

            <Card className="rounded-[24px] bg-[rgba(248,113,113,0.08)] p-4">
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-rose-100/80">When the pressure rose, what coping move dominated?</div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {OPTIONS.copingResponse.map((option) => (
                  <label key={option.value} className="flex items-center gap-3 rounded-[18px] bg-white/[0.04] px-4 py-3">
                    <input type="radio" value={option.value} {...form.register("copingResponse")} />
                    <span className="text-white/74">{option.label}</span>
                  </label>
                ))}
              </div>
            </Card>

            <Card className="rounded-[24px] bg-[rgba(196,181,253,0.08)] p-4">
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-violet-100/80">Which child state felt closest?</div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {OPTIONS.childState.map((option) => (
                  <label key={option.value} className="flex items-center gap-3 rounded-[18px] bg-white/[0.04] px-4 py-3">
                    <input type="radio" value={option.value} {...form.register("childState")} />
                    <span className="text-white/74">{option.label}</span>
                  </label>
                ))}
              </div>
            </Card>

            <div className="grid gap-4 md:grid-cols-2">
              <Card className="rounded-[24px] bg-white/[0.04] p-4">
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/48">What was the critic like?</div>
                <div className="mt-3 grid gap-2">
                  {OPTIONS.criticStyle.map((option) => (
                    <label key={option.value} className="flex items-center gap-3 rounded-[18px] bg-white/[0.04] px-4 py-3">
                      <input type="radio" value={option.value} {...form.register("criticStyle")} />
                      <span className="text-white/74">{option.label}</span>
                    </label>
                  ))}
                </div>
              </Card>

              <Card className="rounded-[24px] bg-white/[0.04] p-4">
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/48">What healthy contact was still reachable?</div>
                <div className="mt-3 grid gap-2">
                  {OPTIONS.healthyContact.map((option) => (
                    <label key={option.value} className="flex items-center gap-3 rounded-[18px] bg-white/[0.04] px-4 py-3">
                      <input type="radio" value={option.value} {...form.register("healthyContact")} />
                      <span className="text-white/74">{option.label}</span>
                    </label>
                  ))}
                </div>
              </Card>
            </div>

            <Button type="submit">Run guide</Button>
          </form>
        </Card>

        <div className="grid gap-5">
          <Card className="bg-[linear-gradient(180deg,rgba(15,21,34,0.96),rgba(10,15,23,0.94))]">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Latest reading</div>
            {!latestSession ? (
              <div className="mt-4">
                <EmptyState
                  eyebrow="Guided reading"
                  title="No guided sessions yet"
                  description="Run the guide once to separate coping response, child state, critic pressure, and reachable healthy contact."
                />
              </div>
            ) : (
              <div className="mt-4 grid gap-3">
                {latestSession.results.map((result) => (
                  <div key={`${result.family}:${result.label}`} className="rounded-[22px] bg-white/[0.04] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium text-white">{result.label}</div>
                      <Badge className="text-white/70">{Math.round(result.confidence * 100)}%</Badge>
                    </div>
                    <div className="mt-2 text-sm text-white/58">{result.family.replaceAll("_", " ")}</div>
                    <div className="mt-3 text-sm leading-6 text-white/66">{result.reasoning}</div>
                  </div>
                ))}
                <Link to="/psyche/modes">
                  <Button variant="secondary">Use this in the mode map</Button>
                </Link>
              </div>
            )}
          </Card>

          <Card>
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Session history</div>
            <div className="mt-4 grid gap-3">
              {(sessionsQuery.data?.sessions ?? []).length === 0 ? (
                <EmptyState
                  eyebrow="Session history"
                  title="No stored guide history"
                  description="Completed guide sessions will accumulate here so later mode-map work can build from real prior readings."
                />
              ) : (
                (sessionsQuery.data?.sessions ?? []).map((session) => (
                  <div key={session.id} className="rounded-[20px] bg-white/[0.04] p-4">
                    <div className="font-medium text-white">{session.summary}</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {session.results.map((result) => (
                        <Badge key={`${session.id}:${result.label}`} className="text-white/72">
                          {result.label}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
}

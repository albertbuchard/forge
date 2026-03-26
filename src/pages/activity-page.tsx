import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { PageHero } from "@/components/shell/page-hero";
import { ActivityTable } from "@/components/activity-table";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/page-state";
import { listActivity, removeActivityLog } from "@/lib/api";
import { getActivityEventHref } from "@/lib/entity-links";
import { formatDateTime } from "@/lib/utils";

export function ActivityPage() {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const entityId = searchParams.get("entityId") ?? undefined;
  const entityType = searchParams.get("entityType") ?? undefined;
  const highlightedEventId = searchParams.get("eventId");
  const activityQuery = useQuery({
    queryKey: ["activity-archive", entityType, entityId],
    queryFn: () => listActivity({ limit: 100, entityType, entityId })
  });
  const removeEventMutation = useMutation({
    mutationFn: (eventId: string) => removeActivityLog(eventId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["activity-archive"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-snapshot"] }),
        queryClient.invalidateQueries({ queryKey: ["task-context"] }),
        queryClient.invalidateQueries({ queryKey: ["project-board"] })
      ]);
    }
  });

  const rows = activityQuery.data?.activity ?? [];

  if (activityQuery.isLoading) {
    return (
      <LoadingState
        eyebrow="Evidence archive"
        title="Loading activity"
        description="Pulling the visible audit trail, grouped evidence, and correction history."
      />
    );
  }

  if (activityQuery.isError) {
    return <ErrorState eyebrow="Evidence archive" error={activityQuery.error} onRetry={() => void activityQuery.refetch()} />;
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        eyebrow="Evidence archive"
        title={entityId ? "No evidence matched this filter" : "No activity recorded yet"}
        description={
          entityId
            ? "Forge could not find visible events for this specific entity yet. Try a broader archive view or create some work first."
            : "As you complete work, log runs, or make corrections, the audit trail will appear here."
        }
      />
    );
  }

  const grouped = rows.reduce<Record<string, typeof rows>>((accumulator, event) => {
    const key = event.createdAt.slice(0, 10);
    accumulator[key] = [...(accumulator[key] ?? []), event];
    return accumulator;
  }, {});

  return (
    <div className="grid gap-5">
      <PageHero
        title="Activity"
        description={
          entityId
            ? "This filtered archive shows the evidence connected to the item you opened, so you can confirm what changed and when."
            : "Activity is your visible audit trail. Use it to inspect progress, confirm corrections, and trace work back to the goal, project, or task it came from."
        }
        badge={`${rows.length} recent events`}
      />

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <ActivityTable
          rows={rows}
          onRemove={async (eventId) => {
            await removeEventMutation.mutateAsync(eventId);
          }}
        />
        <div className="grid gap-4">
          {Object.entries(grouped)
            .slice(0, 6)
            .map(([day, events]) => (
              <Card key={day}>
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">{day}</div>
                <div className="mt-4 grid gap-3">
                  {events.slice(0, 3).map((event) => (
                    <div
                      key={event.id}
                      className={`rounded-[18px] p-4 ${highlightedEventId === event.id ? "bg-[rgba(192,193,255,0.12)] shadow-[inset_0_0_0_1px_rgba(192,193,255,0.2)]" : "bg-white/[0.04]"}`}
                    >
                      <div className="font-medium text-white">{event.title}</div>
                      <div className="mt-2 text-sm text-white/58">{event.description}</div>
                      <div className="mt-3 text-[11px] uppercase tracking-[0.16em] text-white/35">{formatDateTime(event.createdAt)}</div>
                      {getActivityEventHref(event) ? (
                        <Link to={getActivityEventHref(event)!} className="mt-3 inline-flex text-[11px] uppercase tracking-[0.16em] text-[var(--primary)]">
                          Open related item
                        </Link>
                      ) : null}
                    </div>
                  ))}
                </div>
              </Card>
            ))}
        </div>
      </section>
    </div>
  );
}

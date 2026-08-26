import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/page-state";
import { readable } from "@/components/work/work-components";
import type {
  OpportunityCampaign,
  WorkEngagement,
  WorkRecord
} from "@/lib/work-api";
import { uniqueById, SectionHeading } from "./work-page-overview";

function workContextHref(entityType: string, entityId: string) {
  const id = encodeURIComponent(entityId);
  const workSegments: Record<string, string> = {
    work_organization: "organizations",
    work_engagement: "engagements",
    opportunity_campaign: "campaigns",
    job_opportunity: "opportunities",
    job_application: "applications",
    job_interview: "interviews",
    job_offer: "offers",
    work_outreach: "outreach"
  };
  if (workSegments[entityType])
    return `/work/${workSegments[entityType]}/${id}`;
  const direct: Record<string, string> = {
    goal: "goals",
    strategy: "strategies",
    project: "projects",
    issue: "tasks",
    task: "tasks",
    subtask: "tasks",
    person: "people",
    artifact: "artifacts"
  };
  if (direct[entityType]) return `/${direct[entityType]}/${id}`;
  if (["note", "wiki_page"].includes(entityType)) return `/notes?focus=${id}`;
  if (entityType === "life_event") return `/life-events?focus=${id}`;
  if (entityType === "calendar_event") return `/calendar?eventId=${id}`;
  if (entityType === "trigger_report") return `/psyche/reports/${id}`;
  if (entityType === "insight") return `/knowledge-graph?focus=insight:${id}`;
  if (entityType === "psyche_value") return `/psyche/values?focus=${id}`;
  if (entityType === "sleep_session") return `/sleep?focus=${id}`;
  if (entityType === "workout_session") return `/sports/workouts/${id}`;
  if (entityType === "habit") return `/habits?focus=${id}`;
  if (entityType === "movement_place") return `/movement?place=${id}`;
  return null;
}

export function PlansTab({
  engagements,
  campaigns
}: {
  engagements: WorkEngagement[];
  campaigns: OpportunityCampaign[];
}) {
  const related = uniqueById<WorkRecord>(
    engagements
      .flatMap((engagement) => engagement.related ?? [])
      .map((item) => ({
        ...item,
        id: `${String(item.entityType)}:${String(item.entityId)}:${String(item.relationship)}`
      })),
    campaigns
      .flatMap((campaign) => campaign.related ?? [])
      .map((item) => ({
        ...item,
        id: `${String(item.entityType)}:${String(item.entityId)}:${String(item.relationship)}`
      }))
  );
  const groups = [
    { title: "Goals, plans, and strategy", types: ["goal", "strategy"] },
    {
      title: "Projects, actions, and triggers",
      types: ["project", "issue", "task", "subtask", "habit", "trigger_report"]
    },
    {
      title: "People and organizations",
      types: ["person", "work_organization"]
    },
    {
      title: "Knowledge and evidence",
      types: ["note", "wiki_page", "insight", "artifact", "tag"]
    },
    {
      title: "Events, places, and health context",
      types: [
        "calendar_event",
        "life_event",
        "movement_place",
        "psyche_value",
        "sleep_session",
        "workout_session"
      ]
    },
    {
      title: "Work and job search records",
      types: [
        "work_engagement",
        "opportunity_campaign",
        "job_opportunity",
        "job_application",
        "job_interview",
        "job_offer",
        "work_outreach"
      ]
    }
  ];
  const populatedGroups = groups
    .map((group) => ({
      ...group,
      items: related.filter((item) =>
        group.types.includes(String(item.entityType))
      )
    }))
    .filter((group) => group.items.length > 0);
  const connectionHref = engagements[0]
    ? `/work/engagements/${engagements[0].id}?section=connections`
    : campaigns[0]
      ? `/work/campaigns/${campaigns[0].id}?section=connections`
      : "/work?tab=current";
  return (
    <div className="grid gap-7">
      <SectionHeading
        eyebrow="Direction and context"
        title="What supports your work"
        description="See the goals, people, projects, evidence, and other records that you have connected to work and job searches."
      />
      {related.length ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {populatedGroups.map((group) => {
            const { items } = group;
            return (
              <Card key={group.title}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold text-[var(--ui-ink-strong)]">
                    {group.title}
                  </h3>
                  <Badge tone="meta">{items.length}</Badge>
                </div>
                <div className="mt-3 grid gap-2">
                  {items.slice(0, 8).map((item) => {
                    const href = workContextHref(
                      String(item.entityType),
                      String(item.entityId)
                    );
                    const body = (
                      <>
                        <div className="font-medium text-[var(--ui-ink-strong)]">
                          {String(
                            item.title ||
                              readable(item.entityType, "Connected record")
                          )}
                        </div>
                        <div className="mt-1 text-xs text-[var(--ui-ink-soft)]">
                          {readable(item.relationship)} ·{" "}
                          {readable(item.entityType)}
                        </div>
                        {item.detail ? (
                          <div className="mt-1 line-clamp-2 text-xs text-[var(--ui-ink-faint)]">
                            {String(item.detail)}
                          </div>
                        ) : null}
                      </>
                    );
                    return href ? (
                      <Link
                        key={item.id}
                        to={href}
                        className="rounded-[15px] bg-[var(--ui-surface-2)] p-3 text-sm transition hover:bg-[var(--ui-surface-hover)]"
                      >
                        {body}
                      </Link>
                    ) : (
                      <div
                        key={item.id}
                        className="rounded-[15px] bg-[var(--ui-surface-2)] p-3 text-sm"
                      >
                        {body}
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title="No connected Work context yet"
          description="Open a role or job search, choose Connections, and use smart search to add goals, people, projects, tasks, evidence, or other Forge records."
          action={
            <Link to={connectionHref}>
              <Button>Open connections</Button>
            </Link>
          }
        />
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Clock3, Link2, Plus, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  WorkStatusBadge,
  formatDate,
  readable
} from "@/components/work/work-components";
import { replaceWorkRelationships } from "@/lib/work-api";
import type { WorkRecord } from "@/lib/work-api";
export type WorkDetailKind =
  | "engagements"
  | "organizations"
  | "campaigns"
  | "opportunities"
  | "applications"
  | "interviews"
  | "offers"
  | "outreach";

export const workDays = [
  ["monday", "Mon"],
  ["tuesday", "Tue"],
  ["wednesday", "Wed"],
  ["thursday", "Thu"],
  ["friday", "Fri"],
  ["saturday", "Sat"],
  ["sunday", "Sun"]
] as const;

export type WorkDay = (typeof workDays)[number][0];

export function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function details(value: unknown) {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>)
    .filter(
      ([, entry]) => entry !== null && entry !== undefined && entry !== ""
    )
    .map(
      ([key, entry]) =>
        [
          key.replaceAll(/([A-Z])/gu, " $1").replaceAll("_", " "),
          typeof entry === "object" ? JSON.stringify(entry) : String(entry)
        ] as const
    );
}

const RELATIONSHIP_TARGET_TYPES = [
  "goal",
  "strategy",
  "project",
  "issue",
  "task",
  "subtask",
  "person",
  "artifact",
  "note",
  "wiki_page",
  "calendar_event",
  "life_event",
  "insight",
  "psyche_value",
  "sleep_session",
  "workout_session",
  "trigger_report",
  "habit",
  "movement_place",
  "tag",
  "work_organization",
  "work_engagement",
  "opportunity_campaign",
  "job_opportunity",
  "job_application",
  "job_interview",
  "job_offer",
  "work_outreach"
] as const;

function relationshipHref(entityType: string, entityId: string) {
  const id = encodeURIComponent(entityId);
  if (
    [
      "work_organization",
      "work_engagement",
      "opportunity_campaign",
      "job_opportunity",
      "job_application",
      "job_interview",
      "job_offer",
      "work_outreach"
    ].includes(entityType)
  ) {
    const segment: Record<string, string> = {
      work_organization: "organizations",
      work_engagement: "engagements",
      opportunity_campaign: "campaigns",
      job_opportunity: "opportunities",
      job_application: "applications",
      job_interview: "interviews",
      job_offer: "offers",
      work_outreach: "outreach"
    };
    return `/work/${segment[entityType]}/${id}`;
  }
  const segment: Record<string, string> = {
    goal: "goals",
    strategy: "strategies",
    project: "projects",
    issue: "tasks",
    task: "tasks",
    subtask: "tasks",
    person: "people",
    artifact: "artifacts"
  };
  if (segment[entityType]) return `/${segment[entityType]}/${id}`;
  if (entityType === "note" || entityType === "wiki_page")
    return `/notes?focus=${id}`;
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

export function RelationshipEditor({
  links,
  entityType,
  entityId,
  revision,
  userIds,
  onRefresh
}: {
  links: unknown;
  entityType: string;
  entityId: string;
  revision: number;
  userIds: string[];
  onRefresh: () => Promise<void>;
}) {
  const records = useMemo(
    () =>
      Array.isArray(links) ? (links as Array<Record<string, unknown>>) : [],
    [links]
  );
  const outgoing = useMemo(
    () =>
      records
        .filter(
          (link) =>
            link.sourceEntityType === entityType &&
            link.sourceEntityId === entityId
        )
        .map((link) => ({
          targetEntityType: String(link.targetEntityType),
          targetEntityId: String(link.targetEntityId),
          relationship: String(link.relationship ?? "related"),
          anchorKey: String(link.anchorKey ?? "")
        })),
    [entityId, entityType, records]
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(outgoing);
  const [targetType, setTargetType] = useState<string>("goal");
  const [targetId, setTargetId] = useState("");
  const [relationship, setRelationship] = useState("related");
  const [anchorKey, setAnchorKey] = useState("");
  useEffect(() => {
    if (!editing) setDraft(outgoing);
  }, [editing, outgoing]);
  const save = useMutation({
    mutationFn: () =>
      replaceWorkRelationships(userIds, entityType, entityId, {
        expectedRevision: revision,
        links: draft
      }),
    onSuccess: async () => {
      setEditing(false);
      await onRefresh();
    }
  });
  const add = () => {
    if (!targetId.trim() || !relationship.trim()) return;
    setDraft((current) => [
      ...current.filter(
        (link) =>
          !(
            link.targetEntityType === targetType &&
            link.targetEntityId === targetId.trim()
          )
      ),
      {
        targetEntityType: targetType,
        targetEntityId: targetId.trim(),
        relationship: relationship.trim(),
        anchorKey: anchorKey.trim()
      }
    ]);
    setTargetId("");
    setAnchorKey("");
  };
  return (
    <Card className="p-0">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--ui-border-subtle)] px-4 py-3">
        <div className="flex items-center gap-2">
          <Link2 className="size-4 text-[var(--primary)]" />
          <h2 className="font-semibold text-[var(--ui-ink-strong)]">
            Connected Forge context
          </h2>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setEditing((current) => !current)}
        >
          {editing ? "Cancel" : "Edit links"}
        </Button>
      </div>
      {records.length ? (
        <ul className="divide-y divide-[var(--ui-border-subtle)]">
          {records.map((link, index) => {
            const isOutgoing =
              link.sourceEntityType === entityType &&
              link.sourceEntityId === entityId;
            const otherType = String(
              isOutgoing ? link.targetEntityType : link.sourceEntityType
            );
            const otherId = String(
              isOutgoing ? link.targetEntityId : link.sourceEntityId
            );
            const href = relationshipHref(otherType, otherId);
            return (
              <li
                key={`${String(link.sourceEntityType)}-${String(link.sourceEntityId)}-${String(link.targetEntityType)}-${String(link.targetEntityId)}-${index}`}
                className="px-4 py-3"
              >
                <div className="text-sm font-medium text-[var(--ui-ink-strong)]">
                  {readable(link.relationship, "Related")}{" "}
                  <span className="text-xs font-normal text-[var(--ui-ink-faint)]">
                    · {isOutgoing ? "outgoing" : "incoming"}
                  </span>
                </div>
                {href ? (
                  <Link
                    to={href}
                    className="mt-1 block truncate text-xs text-[var(--primary)]"
                  >
                    {otherType}:{otherId}
                  </Link>
                ) : (
                  <div className="mt-1 truncate text-xs text-[var(--ui-ink-faint)]">
                    {otherType}:{otherId}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-4 py-6 text-sm text-[var(--ui-ink-soft)]">
          No linked goals, strategies, people, projects, tasks, triggers, or
          Artifacts yet.
        </p>
      )}
      {editing ? (
        <div className="grid gap-3 border-t border-[var(--ui-border-subtle)] p-4">
          <p className="text-xs leading-5 text-[var(--ui-ink-soft)]">
            Incoming links remain owned by their source. This editor replaces
            only this record’s outgoing links with optimistic concurrency.
          </p>
          {draft.map((link, index) => (
            <div
              key={`${link.targetEntityType}-${link.targetEntityId}-${index}`}
              className="flex items-center justify-between gap-3 rounded-[14px] bg-[var(--ui-surface-2)] p-3"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-[var(--ui-ink-strong)]">
                  {readable(link.relationship)}
                </div>
                <div className="truncate text-xs text-[var(--ui-ink-faint)]">
                  {link.targetEntityType}:{link.targetEntityId}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setDraft((current) =>
                    current.filter((_, candidate) => candidate !== index)
                  )
                }
              >
                Remove
              </Button>
            </div>
          ))}
          <div className="grid gap-2">
            <select
              aria-label="Linked entity type"
              value={targetType}
              onChange={(event) => setTargetType(event.target.value)}
              className="min-h-10 rounded-[14px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-sm"
            >
              {RELATIONSHIP_TARGET_TYPES.map((type) => (
                <option key={type} value={type}>
                  {readable(type)}
                </option>
              ))}
            </select>
            <Input
              aria-label="Linked entity identifier"
              placeholder="Existing Forge entity ID"
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
            />
            <Input
              aria-label="Relationship"
              placeholder="supports, belongs_to, motivated_by…"
              value={relationship}
              onChange={(event) => setRelationship(event.target.value)}
            />
            <Input
              aria-label="Anchor key"
              placeholder="Optional anchor"
              value={anchorKey}
              onChange={(event) => setAnchorKey(event.target.value)}
            />
            <Button
              variant="secondary"
              disabled={!targetId.trim() || !relationship.trim()}
              onClick={add}
            >
              <Plus className="size-4" />
              Add outgoing link
            </Button>
            <Button pending={save.isPending} onClick={() => save.mutate()}>
              <Save className="size-4" />
              Save all outgoing links
            </Button>
            {save.error ? (
              <p className="text-sm text-[var(--danger)]">
                {save.error.message}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function eventText(event: Record<string, unknown>) {
  const summary = [
    event.factualDescription,
    event.description,
    event.title,
    event.nextAction
  ].find((value) => typeof value === "string" && value.trim().length > 0);
  return typeof summary === "string"
    ? summary
    : "Recorded without an additional note.";
}

export function EventTimeline({
  events,
  empty = "No history events yet."
}: {
  events: unknown;
  empty?: string;
}) {
  const records = Array.isArray(events)
    ? (events as Array<Record<string, unknown>>)
    : [];
  return (
    <Card className="p-0">
      <div className="flex items-center gap-2 border-b border-[var(--ui-border-subtle)] px-4 py-3">
        <Clock3 className="size-4 text-[var(--primary)]" />
        <h2 className="font-semibold text-[var(--ui-ink-strong)]">History</h2>
      </div>
      {records.length ? (
        <ol className="divide-y divide-[var(--ui-border-subtle)]">
          {records.map((event, index) => (
            <li
              key={String(event.id ?? index)}
              className="grid gap-1 px-4 py-3 sm:grid-cols-[9rem_minmax(0,1fr)]"
            >
              <time className="text-xs text-[var(--ui-ink-faint)]">
                {formatDate(event.occurredAt ?? event.createdAt)}
              </time>
              <div>
                <div className="text-sm font-medium text-[var(--ui-ink-strong)]">
                  {readable(event.eventType ?? event.newStatus, "Event")}
                </div>
                <p className="mt-1 text-sm leading-5 text-[var(--ui-ink-soft)]">
                  {eventText(event)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="px-4 py-6 text-sm text-[var(--ui-ink-soft)]">{empty}</p>
      )}
    </Card>
  );
}

export function SupportingRevisionHistory({
  revisions
}: {
  revisions: unknown;
}) {
  const records = Array.isArray(revisions)
    ? revisions.filter((revision): revision is Record<string, unknown> =>
        Boolean(revision && typeof revision === "object")
      )
    : [];
  return (
    <Card className="p-0">
      <div className="flex items-center gap-2 border-b border-[var(--ui-border-subtle)] px-4 py-3">
        <Clock3 className="size-4 text-[var(--primary)]" />
        <h2 className="font-semibold text-[var(--ui-ink-strong)]">
          Immutable revisions
        </h2>
      </div>
      {records.length ? (
        <ol className="divide-y divide-[var(--ui-border-subtle)]">
          {records.map((revision, index) => {
            const actor = record(revision.actor);
            const snapshot = record(revision.record);
            return (
              <li
                key={`${String(revision.version)}-${index}`}
                className="grid gap-2 px-4 py-3 sm:grid-cols-[8rem_minmax(0,1fr)]"
              >
                <div>
                  <div className="text-sm font-medium text-[var(--ui-ink-strong)]">
                    Version {String(revision.version ?? records.length - index)}
                  </div>
                  <time className="text-xs text-[var(--ui-ink-faint)]">
                    {formatDate(revision.createdAt)}
                  </time>
                </div>
                <div>
                  <div className="text-sm text-[var(--ui-ink-medium)]">
                    {String(actor.label ?? actor.id ?? "Recorded actor")}
                  </div>
                  <div className="mt-1 text-xs text-[var(--ui-ink-faint)]">
                    {snapshot.status
                      ? `Status: ${readable(snapshot.status)}`
                      : snapshot.stage
                        ? `Stage: ${readable(snapshot.stage)}`
                        : "A versioned snapshot is preserved."}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="px-4 py-6 text-sm text-[var(--ui-ink-faint)]">
          No prior revision is available.
        </p>
      )}
    </Card>
  );
}

export function FactsGrid({
  facts
}: {
  facts: Array<{ label: string; value: unknown }>;
}) {
  return (
    <dl className="grid gap-px overflow-hidden rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-border-subtle)] sm:grid-cols-2 lg:grid-cols-3">
      {facts.map((fact) => (
        <div
          key={fact.label}
          className="min-w-0 bg-[var(--ui-surface-1)] px-4 py-3"
        >
          <dt className="text-[11px] uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
            {fact.label}
          </dt>
          <dd className="mt-1 break-words text-sm text-[var(--ui-ink-strong)]">
            {fact.value === null ||
            fact.value === undefined ||
            fact.value === ""
              ? "Unknown"
              : String(fact.value).replaceAll("_", " ")}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function sourceClaimEvidenceLabel(claim: Record<string, unknown>) {
  const evidence = record(claim.evidence);
  const provenance = record(claim.provenance);
  return String(
    evidence.sourceLabel ??
      evidence.sourceName ??
      provenance.sourceLabel ??
      "Evidence recorded"
  );
}

export function OpportunitySourceEvidence({
  sources
}: {
  sources: WorkRecord[];
}) {
  return (
    <Card className="p-0">
      <div className="border-b border-[var(--ui-border-subtle)] px-4 py-3">
        <h2 className="font-semibold text-[var(--ui-ink-strong)]">
          Source evidence
        </h2>
        <p className="mt-1 text-xs leading-5 text-[var(--ui-ink-soft)]">
          Each material sourced fact retains its evidence fingerprint,
          observation time, confidence, and provenance. Restricted compensation
          or application details remain redacted without the matching
          permission.
        </p>
      </div>
      {sources.length ? (
        <div className="divide-y divide-[var(--ui-border-subtle)]">
          {sources.map((source) => {
            const claims = Array.isArray(source.claims)
              ? source.claims.filter(
                  (claim): claim is Record<string, unknown> =>
                    Boolean(claim && typeof claim === "object")
                )
              : [];
            return (
              <details
                key={source.id}
                className="group px-4 py-3"
                open={sources.length === 1}
              >
                <summary className="cursor-pointer list-none rounded-[14px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-[var(--ui-ink-strong)]">
                        {String(source.sourceName || "Recorded source")}
                      </div>
                      <div className="mt-1 text-xs text-[var(--ui-ink-soft)]">
                        {claims.length} fact claim
                        {claims.length === 1 ? "" : "s"} · checked{" "}
                        {formatDate(source.lastCheckedAt, "not recorded")}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <WorkStatusBadge status={source.status} />
                      {source.confidence === null ||
                      source.confidence === undefined ? null : (
                        <Badge tone="meta">
                          {Math.round(Number(source.confidence) * 100)}%
                          confidence
                        </Badge>
                      )}
                    </div>
                  </div>
                </summary>
                <div className="mt-3 grid gap-3">
                  <div className="flex flex-wrap gap-3 text-xs">
                    {source.sourceUrl ? (
                      <a
                        href={String(source.sourceUrl)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[var(--primary)]"
                      >
                        Open source
                      </a>
                    ) : null}
                    {source.snapshotArtifactId ? (
                      <Link
                        to={`/artifacts/${encodeURIComponent(String(source.snapshotArtifactId))}`}
                        className="text-[var(--primary)]"
                      >
                        Open source snapshot
                      </Link>
                    ) : null}
                    <span className="text-[var(--ui-ink-faint)]">
                      First seen {formatDate(source.firstSeenAt)}
                    </span>
                  </div>
                  {claims.length ? (
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {claims.map((claim, index) => (
                        <li
                          key={`${String(claim.field)}-${String(claim.observedAt)}-${index}`}
                          className="rounded-[15px] bg-[var(--ui-surface-2)] p-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-sm font-medium text-[var(--ui-ink-strong)]">
                              {readable(claim.field, "Sourced fact")}
                            </span>
                            {claim.redacted ? (
                              <Badge tone="meta">Restricted</Badge>
                            ) : claim.confidence === null ||
                              claim.confidence === undefined ? null : (
                              <Badge tone="meta">
                                {Math.round(Number(claim.confidence) * 100)}%
                              </Badge>
                            )}
                          </div>
                          {claim.redacted ? (
                            <p className="mt-1 text-xs text-[var(--ui-ink-faint)]">
                              A matching permission is required to inspect this
                              evidence.
                            </p>
                          ) : (
                            <>
                              <p className="mt-1 text-xs text-[var(--ui-ink-soft)]">
                                {sourceClaimEvidenceLabel(claim)}
                              </p>
                              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[var(--ui-ink-faint)]">
                                <span>
                                  {formatDate(
                                    claim.observedAt,
                                    "Observation time unknown"
                                  )}
                                </span>
                                {claim.valueFingerprint ? (
                                  <span className="font-mono">
                                    value{" "}
                                    {String(claim.valueFingerprint).slice(
                                      0,
                                      12
                                    )}
                                  </span>
                                ) : null}
                              </div>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-[var(--ui-ink-faint)]">
                      This source is recorded, but no field-level claims were
                      supplied.
                    </p>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      ) : (
        <p className="px-4 py-6 text-sm text-[var(--ui-ink-faint)]">
          No source evidence has been recorded for this opportunity.
        </p>
      )}
    </Card>
  );
}

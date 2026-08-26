import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Clock3, Link2, Save } from "lucide-react";
import {
  EntityLinkMultiSelect,
  type EntityLinkOption
} from "@/components/psyche/entity-link-multiselect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  WorkSectionNav,
  WorkStatusBadge,
  formatDate,
  readable
} from "@/components/work/work-components";
import { searchLocalRecords } from "@/lib/api";
import { getWorkRelationships, replaceWorkRelationships } from "@/lib/work-api";
import type { WorkLink, WorkRecord, WorkRelatedSummary } from "@/lib/work-api";
import type { LocalSearchEntityType, LocalSearchResult } from "@/lib/types";
export type WorkDetailKind =
  | "engagements"
  | "organizations"
  | "campaigns"
  | "opportunities"
  | "applications"
  | "interviews"
  | "offers"
  | "outreach";

export function WorkDetailSections<T extends string>({
  options,
  defaultSection,
  children
}: {
  options: Array<{ id: T; label: string; description?: string }>;
  defaultSection: T;
  children: (active: T) => ReactNode;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("section");
  const active =
    options.find((option) => option.id === requested)?.id ?? defaultSection;
  const changeSection = (section: T) => {
    const next = new URLSearchParams(searchParams);
    next.set("section", section);
    setSearchParams(next, { replace: true });
  };
  return (
    <div className="grid gap-5">
      <WorkSectionNav
        label="Record sections"
        active={active}
        options={options}
        onChange={changeSection}
      />
      {children(active)}
    </div>
  );
}

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

const RELATIONSHIP_SEARCH_TYPES = [
  "goal",
  "strategy",
  "project",
  "task",
  "person",
  "artifact",
  "note",
  "calendar_event",
  "life_event",
  "insight",
  "psyche_value",
  "sleep_session",
  "workout_session",
  "trigger_report",
  "habit",
  "tag",
  "work_organization",
  "work_engagement",
  "opportunity_campaign",
  "job_opportunity",
  "job_application",
  "job_interview",
  "job_offer",
  "work_outreach"
] satisfies LocalSearchEntityType[];

const RELATIONSHIP_CHOICES = [
  ["related", "Related to"],
  ["supports", "Supports"],
  ["advances", "Advances"],
  ["depends_on", "Depends on"],
  ["involves", "Involves"]
] as const;

function resultTargetType(result: LocalSearchResult) {
  if (["issue", "subtask", "wiki_page"].includes(result.entityKind ?? ""))
    return String(result.entityKind);
  return result.entityType;
}

function relationshipValue(entityType: string, entityId: string) {
  return `${entityType}:${encodeURIComponent(entityId)}`;
}

function parseRelationshipValue(value: string) {
  const separator = value.indexOf(":");
  if (separator < 1) return null;
  return {
    targetEntityType: value.slice(0, separator),
    targetEntityId: decodeURIComponent(value.slice(separator + 1))
  };
}

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
  const scopeKey = userIds.join(",");
  const relationshipQuery = useQuery({
    queryKey: ["work", "relationships", entityType, entityId, scopeKey],
    queryFn: () => getWorkRelationships(userIds, entityType, entityId),
    enabled: userIds.length > 0
  });
  const records = useMemo(
    () =>
      relationshipQuery.data?.links ??
      (Array.isArray(links) ? (links as WorkLink[]) : []),
    [links, relationshipQuery.data?.links]
  );
  const related = useMemo<WorkRelatedSummary[]>(
    () => relationshipQuery.data?.related ?? [],
    [relationshipQuery.data?.related]
  );
  const summaryByTarget = useMemo(
    () =>
      new Map(
        related.map((item) => [
          relationshipValue(item.entityType, item.entityId),
          item
        ])
      ),
    [related]
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
  const [foundOptions, setFoundOptions] = useState<EntityLinkOption[]>([]);
  useEffect(() => {
    if (!editing) setDraft(outgoing);
  }, [editing, outgoing]);
  const existingOptions = useMemo<EntityLinkOption[]>(
    () =>
      outgoing.map((link) => {
        const value = relationshipValue(
          link.targetEntityType,
          link.targetEntityId
        );
        const summary = summaryByTarget.get(value);
        return {
          value,
          label: summary?.title || `Linked ${readable(link.targetEntityType)}`,
          description: summary?.detail || readable(link.targetEntityType)
        };
      }),
    [outgoing, summaryByTarget]
  );
  const allOptions = useMemo(() => {
    const options = new Map<string, EntityLinkOption>();
    [...foundOptions, ...existingOptions].forEach((option) =>
      options.set(option.value, option)
    );
    return [...options.values()];
  }, [existingOptions, foundOptions]);
  const searchOptions = useCallback(
    async (query: string): Promise<EntityLinkOption[]> => {
      const response = await searchLocalRecords({
        query,
        entityTypes: RELATIONSHIP_SEARCH_TYPES,
        userIds,
        limit: 24
      });
      const options = response.results
        .map((result) => ({ result, targetType: resultTargetType(result) }))
        .filter(
          ({ result, targetType }) =>
            targetType !== entityType || result.entityId !== entityId
        )
        .map(({ result, targetType }) => ({
          value: relationshipValue(targetType, result.entityId),
          label: result.title,
          description: result.detail || readable(targetType),
          searchText: `${result.title} ${result.detail} ${result.category}`
        }));
      setFoundOptions((current) => {
        const merged = new Map(
          [...current, ...options].map((option) => [option.value, option])
        );
        return [...merged.values()];
      });
      return options;
    },
    [entityId, entityType, userIds]
  );
  const save = useMutation({
    mutationFn: () =>
      replaceWorkRelationships(userIds, entityType, entityId, {
        expectedRevision: revision,
        links: draft
      }),
    onSuccess: async () => {
      setEditing(false);
      await relationshipQuery.refetch();
      await onRefresh();
    }
  });
  const updateSelection = (values: string[]) => {
    setDraft((current) => {
      const currentByValue = new Map(
        current.map((link) => [
          relationshipValue(link.targetEntityType, link.targetEntityId),
          link
        ])
      );
      return values.flatMap((value) => {
        const parsed = parseRelationshipValue(value);
        if (!parsed) return [];
        return [
          currentByValue.get(value) ?? {
            ...parsed,
            relationship: "related",
            anchorKey: ""
          }
        ];
      });
    });
  };
  return (
    <Card className="p-0">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--ui-border-subtle)] px-4 py-3">
        <div className="flex items-center gap-2">
          <Link2 className="size-4 text-[var(--primary)]" />
          <h2 className="font-semibold text-[var(--ui-ink-strong)]">
            Connections
          </h2>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setEditing((current) => !current)}
        >
          {editing
            ? "Cancel"
            : records.length
              ? "Edit connections"
              : "Add connection"}
        </Button>
      </div>
      {relationshipQuery.isLoading ? (
        <p className="px-4 py-6 text-sm text-[var(--ui-ink-soft)]">
          Loading connections…
        </p>
      ) : relationshipQuery.error ? (
        <p className="px-4 py-6 text-sm text-[var(--danger)]">
          {relationshipQuery.error.message}
        </p>
      ) : records.length ? (
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
            const summary = summaryByTarget.get(
              relationshipValue(otherType, otherId)
            );
            const href = relationshipHref(otherType, otherId);
            const title = summary?.title || `Linked ${readable(otherType)}`;
            return (
              <li
                key={`${link.sourceEntityType}-${link.sourceEntityId}-${link.targetEntityType}-${link.targetEntityId}-${index}`}
                className="px-4 py-3"
              >
                <div className="text-xs font-medium text-[var(--ui-ink-soft)]">
                  {readable(link.relationship, "Related")} ·{" "}
                  {isOutgoing ? "added here" : "linked from another record"}
                </div>
                {href ? (
                  <Link
                    to={href}
                    className="mt-1 block truncate text-sm font-medium text-[var(--primary)]"
                  >
                    {title}
                  </Link>
                ) : (
                  <div className="mt-1 truncate text-sm font-medium text-[var(--ui-ink-strong)]">
                    {title}
                  </div>
                )}
                {summary?.detail ? (
                  <p className="mt-1 line-clamp-2 text-xs text-[var(--ui-ink-soft)]">
                    {summary.detail}
                  </p>
                ) : null}
                <details className="mt-2 text-[10px] text-[var(--ui-ink-faint)]">
                  <summary className="cursor-pointer">
                    Technical details
                  </summary>
                  <div className="mt-1 break-all font-mono">
                    {otherType}:{otherId}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="px-4 py-6">
          <p className="text-sm font-medium text-[var(--ui-ink-strong)]">
            Nothing is connected yet
          </p>
          <p className="mt-1 text-sm text-[var(--ui-ink-soft)]">
            Add only the goals, people, projects, evidence, or other records
            that help explain this work.
          </p>
        </div>
      )}
      {editing ? (
        <div className="grid gap-3 border-t border-[var(--ui-border-subtle)] p-4">
          <EntityLinkMultiSelect
            options={allOptions}
            selectedValues={draft.map((link) =>
              relationshipValue(link.targetEntityType, link.targetEntityId)
            )}
            onChange={updateSelection}
            onSearch={searchOptions}
            placeholder="Search Forge by name…"
            emptyMessage="No matching Forge record was found."
          />
          {draft.map((link) => {
            const value = relationshipValue(
              link.targetEntityType,
              link.targetEntityId
            );
            const title =
              allOptions.find((option) => option.value === value)?.label ||
              `Linked ${readable(link.targetEntityType)}`;
            const knownRelationship = RELATIONSHIP_CHOICES.some(
              ([id]) => id === link.relationship
            );
            return (
              <label
                key={value}
                className="grid gap-1 rounded-[14px] bg-[var(--ui-surface-2)] p-3 text-xs font-medium text-[var(--ui-ink-soft)] sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-center"
              >
                <span className="truncate text-sm text-[var(--ui-ink-strong)]">
                  {title}
                </span>
                <select
                  aria-label={`How ${title} is connected`}
                  value={link.relationship}
                  onChange={(event) =>
                    setDraft((current) =>
                      current.map((candidate) =>
                        candidate.targetEntityType === link.targetEntityType &&
                        candidate.targetEntityId === link.targetEntityId
                          ? {
                              ...candidate,
                              relationship: event.target.value
                            }
                          : candidate
                      )
                    )
                  }
                  className="min-h-11 rounded-[12px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 text-sm text-[var(--ui-ink-strong)]"
                >
                  {!knownRelationship ? (
                    <option value={link.relationship}>
                      {readable(link.relationship)}
                    </option>
                  ) : null}
                  {RELATIONSHIP_CHOICES.map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
          <Button pending={save.isPending} onClick={() => save.mutate()}>
            <Save className="size-4" />
            Save connections
          </Button>
          {save.error ? (
            <p className="text-sm text-[var(--danger)]">{save.error.message}</p>
          ) : null}
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
  if (records.length === 0) return null;
  return (
    <Card className="p-0">
      <details>
        <summary className="flex cursor-pointer items-center gap-2 px-4 py-3">
          <Clock3 className="size-4 text-[var(--primary)]" />
          <span className="font-semibold text-[var(--ui-ink-strong)]">
            Previous versions ({records.length})
          </span>
        </summary>
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
      </details>
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
              : readable(fact.value)}
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
          See where important role facts came from, when they were checked, and
          how confident the source was. Private details stay hidden unless you
          have access.
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
                                  <details>
                                    <summary className="cursor-pointer">
                                      Technical details
                                    </summary>
                                    <span className="font-mono">
                                      Stored value reference{" "}
                                      {String(claim.valueFingerprint).slice(
                                        0,
                                        12
                                      )}
                                    </span>
                                  </details>
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
          No source evidence has been recorded for this role.
        </p>
      )}
    </Card>
  );
}

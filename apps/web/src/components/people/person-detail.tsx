import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Ban,
  BookOpen,
  CalendarDays,
  ChevronRight,
  Clock3,
  ExternalLink,
  FileText,
  History,
  Link2,
  LockKeyhole,
  MessageCircleQuestion,
  Pencil,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  Unplug,
  UserRound,
  UsersRound,
  Wifi,
  WifiOff
} from "lucide-react";
import { AskPersonFlow } from "@/components/people/ask-person-flow";
import { PairingFlow } from "@/components/people/pairing-flow";
import {
  PeopleConsequenceFlow,
  type PeopleConsequenceAction
} from "@/components/people/people-consequence-flow";
import { PersonEditorFlow } from "@/components/people/person-editor-flow";
import { PeopleProgressiveList } from "@/components/people/people-progressive-list";
import { ShareGrantFlow } from "@/components/people/share-grant-flow";
import {
  ConnectionBanner,
  FreshnessBadge,
  InlineEmpty,
  PeopleSection,
  PeopleStateBanner,
  formatPeopleDateTime
} from "@/components/people/people-status";
import { WikiAssociationFlow } from "@/components/people/wiki-association-flow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { usePeopleGateway } from "@/components/people/people-gateway";
import { useDelayedFlag } from "@/components/people/use-delayed-flag";
import { cn } from "@/lib/utils";
import type {
  PeopleFreshnessState,
  PersonContext,
  PersonLinkedRecord,
  RemoteValue,
  SharedProjection
} from "@/components/people/people-types";

type DetailTab = "overview" | "sharing" | "connection";
type DetailFlow = "edit" | "wiki" | "pair" | "share" | "ask" | null;

function sharedInformationLabel(projectionId: string) {
  const knownLabels: Record<string, string> = {
    "calendar.availability.v1": "Calendar availability",
    "goals.horizon_summary.v1": "Goal summaries",
    "health.cycling.aggregate.v1": "Cycling totals",
    "movement.aggregate.v1": "Movement totals",
    "person.profile.v1": "Profile details",
    "custom.selected_entities.v1": "Selected records"
  };
  if (knownLabels[projectionId]) {
    return knownLabels[projectionId];
  }
  const words = projectionId
    .replace(/\.v\d+$/, "")
    .split(".")
    .flatMap((part) => part.split("_"))
    .filter(Boolean);
  const label = words.join(" ");
  return label
    ? `${label[0]!.toUpperCase()}${label.slice(1)}`
    : "Shared information";
}

function fieldLabel(field: string) {
  const words = field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .trim();
  return words ? `${words[0]!.toUpperCase()}${words.slice(1)}` : "Field";
}

function formatBirthday(context: PersonContext) {
  const birthday = context.person.birthday;
  if (birthday.precision === "unknown") {
    return "Not recorded";
  }
  if (birthday.precision === "year") {
    return birthday.year ? String(birthday.year) : "Year unknown";
  }
  const monthDay = [birthday.month, birthday.day]
    .filter((value): value is number => value !== null)
    .join("/");
  if (birthday.precision === "month_day") {
    return monthDay || "Month and day unknown";
  }
  return (
    [birthday.year, monthDay].filter(Boolean).join(" · ") || "Not recorded"
  );
}

function DetailField({
  label,
  value,
  privateValue = false
}: {
  label: string;
  value: string | number | null | undefined;
  privateValue?: boolean;
}) {
  return (
    <div className="min-w-0 border-b border-[var(--ui-border-subtle)] py-3 last:border-b-0">
      <dt className="flex items-center gap-1.5 text-xs font-medium text-[var(--ui-ink-muted)]">
        {privateValue ? (
          <LockKeyhole
            className="size-3"
            aria-label="Private value saved in this Forge"
          />
        ) : null}
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm leading-6 text-[var(--ui-ink-strong)]">
        {value === null || value === undefined || value === ""
          ? "Not recorded"
          : value}
      </dd>
    </div>
  );
}

function RemoteValueRow({ value }: { value: RemoteValue<string> }) {
  const hidden = value.freshness === "revoked" || value.value === null;
  const source = [value.sourceLabel, value.sourceDeviceLabel]
    .filter((part): part is string => Boolean(part))
    .join(" - ");
  return (
    <li className="rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[var(--ui-ink-strong)]">
            {value.label}
          </div>
          <div className="mt-1 text-xs text-[var(--ui-ink-muted)]">
            {source ? `Source: ${source}` : "Source details unavailable"}
          </div>
        </div>
        <FreshnessBadge state={value.freshness} />
      </div>
      <p
        className={cn(
          "mt-3 text-sm leading-6",
          hidden ? "text-[var(--ui-ink-muted)]" : "text-[var(--ui-ink-strong)]"
        )}
      >
        {value.freshness === "revoked"
          ? "The shared value is hidden because access was withdrawn."
          : value.value === null
            ? "Forge knows this item is shared, but its value is unavailable in this view."
            : value.value}
      </p>
      <dl className="mt-3 grid gap-2 border-t border-[var(--ui-border-subtle)] pt-3 text-xs text-[var(--ui-ink-muted)] sm:grid-cols-2">
        <div>
          <dt>As of</dt>
          <dd className="mt-1 text-[var(--ui-ink-medium)]">
            {formatPeopleDateTime(value.asOf)}
          </dd>
        </div>
        <div>
          <dt>Received</dt>
          <dd className="mt-1 text-[var(--ui-ink-medium)]">
            {formatPeopleDateTime(value.receivedAt)}
          </dd>
        </div>
        <div>
          <dt>Level of detail</dt>
          <dd className="mt-1 text-[var(--ui-ink-medium)]">
            {value.precision.replaceAll("_", " ")}
          </dd>
        </div>
        <div>
          <dt>How complete</dt>
          <dd className="mt-1 text-[var(--ui-ink-medium)]">
            {value.completeness.replaceAll("_", " ")}
          </dd>
        </div>
      </dl>
      {value.redactions && value.redactions.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {value.redactions.map((redaction) => (
            <Badge key={redaction} size="xs" tone="meta" wrap>
              Hidden: {redaction}
            </Badge>
          ))}
        </div>
      ) : value.redactions === null ? (
        <p className="mt-3 text-xs text-[var(--ui-ink-muted)]">
          Forge did not receive details about which parts were hidden.
        </p>
      ) : null}
      {value.freshness === "stale" || value.freshness === "offline" ? (
        <p className="mt-3 text-xs font-medium text-[var(--warning)]">
          Cached value, not current.
        </p>
      ) : null}
    </li>
  );
}

function ShareRow({
  share,
  onRevoke
}: {
  share: SharedProjection;
  onRevoke?: () => void;
}) {
  const freshness: PeopleFreshnessState =
    share.state === "revoked"
      ? "revoked"
      : share.state === "expired"
        ? "stale"
        : share.state === "conflicted" ||
            share.state === "rejected" ||
            share.state === "superseded"
          ? "unavailable"
          : share.state === "draft" ||
              share.state === "proposed" ||
              share.state === "countered"
            ? "cached"
            : "live";
  return (
    <li className="rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-[var(--ui-ink-strong)]">
            {share.label}
          </div>
          <div className="mt-1 text-xs text-[var(--ui-ink-muted)]">
            {share.direction === "outgoing" ? "You share" : "Shared with you"} ·
            sharing version {share.grantVersion}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FreshnessBadge state={freshness} label={share.state} />
          {onRevoke && share.state !== "revoked" ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="min-h-11 text-[var(--danger)]"
              onClick={onRevoke}
            >
              <Ban className="size-4" aria-hidden="true" />
              Revoke
            </Button>
          ) : null}
        </div>
      </div>
      <dl className="mt-4 grid gap-3 text-sm text-[var(--ui-ink-medium)] md:grid-cols-2">
        <div>
          <dt className="text-[var(--ui-ink-muted)]">Shared information</dt>
          <dd className="mt-1 grid gap-2">
            {share.projectionIds.map((projectionId) => (
              <span key={projectionId} className="block">
                <span className="block">
                  {sharedInformationLabel(projectionId)}
                </span>
                <span className="block break-all font-mono text-xs">
                  Exact ID: {projectionId}
                </span>
              </span>
            ))}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--ui-ink-muted)]">Level of detail</dt>
          <dd className="mt-1">
            {share.precisions
              .map((precision) => precision.replaceAll("_", " "))
              .join(", ")}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--ui-ink-muted)]">Access ends</dt>
          <dd className="mt-1">{formatPeopleDateTime(share.expiresAt)}</dd>
        </div>
        <div>
          <dt className="text-[var(--ui-ink-muted)]">
            Offline copies kept for
          </dt>
          <dd className="mt-1">{share.retentionLabel}</dd>
        </div>
      </dl>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div>
          <div className="text-xs text-[var(--ui-ink-muted)]">
            Included fields
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {share.fields.map((field) => (
              <Badge key={field} size="xs" wrap>
                {fieldLabel(field)} · Exact field: {field}
              </Badge>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs text-[var(--ui-ink-muted)]">
            Always hidden
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {share.exclusions.map((field) => (
              <Badge key={field} size="xs" tone="meta" wrap>
                {fieldLabel(field)} · Exact field: {field}
              </Badge>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-4 text-xs text-[var(--ui-ink-muted)]">
        Approved recipient device IDs:{" "}
        {share.recipientDeviceIds.join(", ") || "None"}
      </p>
    </li>
  );
}

function LinkedRecordRow({ record }: { record: PersonLinkedRecord }) {
  const details = (
    <>
      <Link2
        className="size-4 shrink-0 text-[var(--primary)]"
        aria-hidden="true"
      />
      <span className="min-w-0">
        <span className="block truncate font-medium text-[var(--ui-ink-strong)]">
          {record.title ?? `${record.entityType}: ${record.entityId}`}
        </span>
        <span className="mt-1 block truncate text-xs text-[var(--ui-ink-muted)]">
          {fieldLabel(record.entityType)} ·{" "}
          {record.relationship.replaceAll("_", " ")}
        </span>
      </span>
    </>
  );
  const href = record.state === "active" ? record.href : null;

  return (
    <li>
      {href ? (
        <Link
          to={href}
          className="grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-ring)]"
        >
          {details}
          <ChevronRight
            className="size-4 text-[var(--ui-ink-faint)]"
            aria-hidden="true"
          />
        </Link>
      ) : (
        <div
          aria-disabled="true"
          className="grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-3 text-sm opacity-70"
        >
          {details}
          <Badge size="xs" tone="meta">
            {record.state.replaceAll("_", " ")}
          </Badge>
        </div>
      )}
    </li>
  );
}

function DetailTabs({
  value,
  onChange
}: {
  value: DetailTab;
  onChange: (value: DetailTab) => void;
}) {
  const tabs: Array<{
    value: DetailTab;
    label: string;
    compactLabel?: string;
    Icon: typeof UserRound;
  }> = [
    { value: "overview", label: "Overview", Icon: UserRound },
    { value: "sharing", label: "Sharing", Icon: ShieldCheck },
    {
      value: "connection",
      label: "Connection & history",
      compactLabel: "Connection",
      Icon: History
    }
  ];
  return (
    <div
      role="tablist"
      aria-label="Person detail views"
      aria-orientation="horizontal"
      className="grid w-full grid-cols-3 border-b border-[var(--ui-border-subtle)] px-2 sm:flex sm:gap-1 sm:px-4"
    >
      {tabs.map((tab, index) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          aria-controls={`person-tabpanel-${tab.value}`}
          aria-label={tab.label}
          id={`person-tab-${tab.value}`}
          tabIndex={value === tab.value ? 0 : -1}
          onClick={() => onChange(tab.value)}
          onKeyDown={(event) => {
            let nextIndex: number | null = null;
            if (event.key === "ArrowRight") {
              nextIndex = (index + 1) % tabs.length;
            } else if (event.key === "ArrowLeft") {
              nextIndex = (index - 1 + tabs.length) % tabs.length;
            } else if (event.key === "Home") {
              nextIndex = 0;
            } else if (event.key === "End") {
              nextIndex = tabs.length - 1;
            }
            if (nextIndex === null) {
              return;
            }
            event.preventDefault();
            onChange(tabs[nextIndex]!.value);
            const tabElements =
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                '[role="tab"]'
              );
            tabElements?.[nextIndex]?.focus();
          }}
          className={cn(
            "flex min-h-11 min-w-0 items-center justify-center gap-1.5 border-b-2 px-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-ring)] sm:shrink-0 sm:justify-start sm:gap-2 sm:px-3",
            value === tab.value
              ? "border-[var(--primary)] text-[var(--ui-ink-strong)]"
              : "border-transparent text-[var(--ui-ink-muted)] hover:text-[var(--ui-ink-strong)]"
          )}
        >
          <tab.Icon
            className="hidden size-4 shrink-0 sm:block"
            aria-hidden="true"
          />
          <span className="sm:hidden">{tab.compactLabel ?? tab.label}</span>
          <span className="hidden sm:inline">{tab.label}</span>
        </button>
      ))}
    </div>
  );
}

function DetailLoading({ slow }: { slow: boolean }) {
  return (
    <div
      role="status"
      aria-busy="true"
      className="grid min-h-[30rem] place-items-center bg-[var(--ui-bg)]"
    >
      <div className="grid justify-items-center gap-3 px-5 text-center text-sm text-[var(--ui-ink-muted)]">
        <span className="flex items-center gap-3">
          <Spinner className="size-4" tone="subtle" />
          {slow
            ? "This person's details are taking longer than expected to load."
            : "Loading person details..."}
        </span>
        {slow ? (
          <span className="max-w-md text-xs leading-5 text-[var(--ui-ink-faint)]">
            Forge is waiting for the saved profile and sharing details. Older
            shared information will stay marked with its date.
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function PersonDetail({
  personId,
  onBack,
  onNavigatePerson,
  headingLevel = 1
}: {
  personId: string;
  onBack?: () => void;
  onNavigatePerson?: (personId: string) => void;
  headingLevel?: 1 | 2;
}) {
  const gateway = usePeopleGateway();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<DetailTab>("overview");
  const [flow, setFlow] = useState<DetailFlow>(null);
  const [consequenceAction, setConsequenceAction] =
    useState<PeopleConsequenceAction | null>(null);

  useEffect(() => {
    setTab("overview");
    setFlow(null);
    setConsequenceAction(null);
  }, [personId]);

  const contextQuery = useQuery({
    queryKey: ["people", "context", personId],
    queryFn: () => gateway.getPersonContext(personId),
    retry: false
  });
  const slowContextLoad = useDelayedFlag(contextQuery.isLoading);
  const context = contextQuery.data;
  const DetailHeading = headingLevel === 2 ? "h2" : "h1";
  const ErrorHeading = headingLevel === 2 ? "h2" : "h1";
  const sectionHeadingLevel = headingLevel === 2 ? 3 : 2;

  const updateContext = (nextContext: PersonContext) => {
    queryClient.setQueryData(
      ["people", "context", nextContext.person.id],
      nextContext
    );
  };

  if (contextQuery.isLoading) {
    return <DetailLoading slow={slowContextLoad} />;
  }

  if (!context) {
    return (
      <div
        role="alert"
        className="grid min-h-[30rem] place-items-center bg-[var(--ui-bg)] p-6 text-center"
      >
        <div className="max-w-md">
          <Unplug
            className="mx-auto size-8 text-[var(--danger)]"
            aria-hidden="true"
          />
          <ErrorHeading className="mt-3 text-lg font-semibold text-[var(--ui-ink-strong)]">
            Person details could not be loaded
          </ErrorHeading>
          <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-muted)]">
            {contextQuery.error instanceof Error
              ? contextQuery.error.message
              : "Forge could not read this person's details."}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            {onBack ? (
              <Button type="button" variant="secondary" onClick={onBack}>
                <ArrowLeft className="size-4" aria-hidden="true" />
                Back to People
              </Button>
            ) : null}
            <Button type="button" onClick={() => void contextQuery.refetch()}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const peerRevoked = context.peer?.status === "revoked";
  const peerReady = context.peer?.status === "paired";
  const approvedRecipientDevices =
    context.peer?.devices.filter(
      (device) => device.trustState === "approved"
    ) ?? [];
  const shareReady =
    peerReady &&
    context.coverage.peerDevices === "complete" &&
    approvedRecipientDevices.length > 0;

  return (
    <article
      data-testid="person-detail"
      className="min-w-0 bg-[var(--ui-bg)] text-[var(--ui-ink-strong)]"
      aria-labelledby="person-detail-heading"
    >
      <header className="border-b border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-4">
        {onBack ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mb-3 min-h-11 lg:hidden"
            onClick={onBack}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            People
          </Button>
        ) : null}
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge size="sm" tone="meta">
                Saved here
              </Badge>
              <Badge size="sm" tone="meta">
                {context.person.relationshipLabel ??
                  context.person.relationshipCategory.replaceAll("_", " ")}
              </Badge>
              {context.peer ? (
                <FreshnessBadge
                  state={context.peer.freshness}
                  label={context.peer.status.replaceAll("_", " ")}
                />
              ) : (
                <Badge size="sm" tone="meta">
                  Not connected
                </Badge>
              )}
            </div>
            <DetailHeading
              id="person-detail-heading"
              className="mt-3 break-words text-2xl font-semibold text-[var(--ui-ink-strong)]"
            >
              {context.person.displayName}
            </DetailHeading>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ui-ink-muted)]">
              {context.person.shortDescription ?? "No description yet."}
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setFlow("edit")}
            >
              <Pencil className="size-4" aria-hidden="true" />
              Edit
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!gateway.capabilities.wikiAssociation}
              title={
                gateway.capabilities.wikiAssociation
                  ? undefined
                  : "Wiki links are unavailable in this Forge."
              }
              onClick={() => setFlow("wiki")}
            >
              <BookOpen className="size-4" aria-hidden="true" />
              Wiki
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={
                !context.peer && !gateway.capabilities.pairingInvitation
              }
              title={
                !context.peer && !gateway.capabilities.pairingInvitation
                  ? "Pairing invitations are not available yet. Try again after Forge finishes connecting."
                  : undefined
              }
              onClick={() =>
                context.peer ? setTab("connection") : setFlow("pair")
              }
            >
              {context.peer ? (
                <ShieldCheck className="size-4" aria-hidden="true" />
              ) : (
                <Wifi className="size-4" aria-hidden="true" />
              )}
              {context.peer ? "Connection" : "Pair"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!shareReady}
              title={
                !peerReady
                  ? "A verified paired Forge is required before sharing."
                  : context.coverage.peerDevices !== "complete"
                    ? "Refresh the device list before sharing."
                    : approvedRecipientDevices.length === 0
                      ? "Approve at least one recipient device before sharing."
                      : undefined
              }
              onClick={() => setFlow("share")}
            >
              <UsersRound className="size-4" aria-hidden="true" />
              Share
            </Button>
            <Button
              type="button"
              disabled={!peerReady}
              title={
                peerReady
                  ? undefined
                  : "A verified paired Forge is required before asking."
              }
              onClick={() => setFlow("ask")}
            >
              <MessageCircleQuestion className="size-4" aria-hidden="true" />
              Ask
            </Button>
          </div>
        </div>
      </header>

      <DetailTabs value={tab} onChange={setTab} />

      <div className="grid gap-3 px-4 py-4">
        <ConnectionBanner
          connection={context.connection}
          partial={context.partial}
          onRetry={() => void contextQuery.refetch()}
        />
        {contextQuery.error ? (
          <PeopleStateBanner state="warning" title="Showing saved details">
            Forge could not refresh this person. Saved details remain visible;
            shared information may be out of date or unavailable.
          </PeopleStateBanner>
        ) : null}
        {context.conflictMessage ? (
          <PeopleStateBanner state="warning" title="Sharing conflict">
            {context.conflictMessage}
          </PeopleStateBanner>
        ) : null}
        {context.revocationMessage ? (
          <PeopleStateBanner state="danger" title="Access revoked">
            {context.revocationMessage}
          </PeopleStateBanner>
        ) : null}
      </div>

      {tab === "overview" ? (
        <div
          id="person-tabpanel-overview"
          role="tabpanel"
          tabIndex={0}
          aria-labelledby="person-tab-overview"
          className="px-4 pb-8 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ui-ring)]"
        >
          <PeopleSection
            headingLevel={sectionHeadingLevel}
            title="What you remember"
            description="Details you saved about this person. Lock-marked fields stay private to this Forge."
          >
            <div className="grid gap-x-6 lg:grid-cols-2">
              <dl>
                <DetailField
                  label="Preferred name"
                  value={context.person.preferredName}
                />
                <DetailField label="Pronouns" value={context.person.pronouns} />
                <DetailField
                  label="Aliases"
                  value={context.person.aliases.join(", ")}
                />
                <DetailField
                  label="Importance"
                  value={
                    context.person.importanceScore === null
                      ? null
                      : context.person.importance.replaceAll("_", " ")
                  }
                />
                <DetailField
                  label="Closeness"
                  value={context.person.closeness}
                />
                <DetailField
                  label="Birthday"
                  value={formatBirthday(context)}
                  privateValue
                />
                <DetailField label="Timezone" value={context.person.timezone} />
                <DetailField
                  label="Home place"
                  value={context.person.homePlaceLabel}
                  privateValue
                />
              </dl>
              <dl>
                <DetailField
                  label="Relationship context"
                  value={context.person.description}
                  privateValue
                />
                <DetailField
                  label="Private notes"
                  value={context.person.privateNotes}
                  privateValue
                />
                <DetailField
                  label="How you met"
                  value={context.person.howWeMet}
                  privateValue
                />
                <DetailField
                  label="When you met"
                  value={context.person.metAt}
                  privateValue
                />
              </dl>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <LockKeyhole
                    className="size-4 text-[var(--primary)]"
                    aria-hidden="true"
                  />
                  Contact methods
                </div>
                {context.person.contactMethods.length > 0 ? (
                  <PeopleProgressiveList
                    items={context.person.contactMethods}
                    getKey={(method) => method.id}
                    resetKey={personId}
                    label="contact methods"
                    className="mt-3 grid gap-2 text-sm text-[var(--ui-ink-medium)]"
                    renderItem={(method) => (
                      <li key={method.id} className="break-words">
                        <span className="text-[var(--ui-ink-muted)]">
                          {method.label}:
                        </span>{" "}
                        {method.value}
                      </li>
                    )}
                  />
                ) : (
                  <p className="mt-3 text-sm text-[var(--ui-ink-muted)]">
                    None recorded.
                  </p>
                )}
              </div>
              <div className="rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <FileText
                    className="size-4 text-[var(--primary)]"
                    aria-hidden="true"
                  />
                  Things to remember
                </div>
                {context.person.facts.length > 0 ? (
                  <PeopleProgressiveList
                    items={context.person.facts}
                    getKey={(fact) => fact.id}
                    resetKey={personId}
                    label="local facts"
                    className="mt-3 grid gap-3 text-sm text-[var(--ui-ink-medium)]"
                    renderItem={(fact) => (
                      <li key={fact.id}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-[var(--ui-ink-strong)]">
                            {fact.label}
                          </span>
                          <Badge size="xs" tone="meta">
                            {fact.sensitivity.replaceAll("_", " ")}
                          </Badge>
                        </div>
                        <p className="mt-1 leading-6">{fact.value}</p>
                      </li>
                    )}
                  />
                ) : (
                  <p className="mt-3 text-sm text-[var(--ui-ink-muted)]">
                    None recorded.
                  </p>
                )}
              </div>
            </div>
          </PeopleSection>

          <PeopleSection
            headingLevel={sectionHeadingLevel}
            title="Shared by this person"
            description="Information they chose to share. Each item shows its source, date, level of detail, completeness, and anything hidden."
          >
            {context.incomingValues.length > 0 ? (
              <PeopleProgressiveList
                items={context.incomingValues}
                getKey={(value) => value.id}
                resetKey={personId}
                label="shared values"
                className="grid gap-3 xl:grid-cols-2"
                renderItem={(value) => (
                  <RemoteValueRow key={value.id} value={value} />
                )}
              />
            ) : (
              <InlineEmpty>
                {context.coverage.sharedValues === "metadata_only"
                  ? "Forge knows this person shares information with you, but the values are unavailable in this view."
                  : "This person is not sharing any information with you."}
              </InlineEmpty>
            )}
          </PeopleSection>

          <PeopleSection
            headingLevel={sectionHeadingLevel}
            title="Upcoming together"
          >
            {context.upcomingTogether.length > 0 ? (
              <PeopleProgressiveList
                items={context.upcomingTogether}
                getKey={(item) => item.id}
                resetKey={personId}
                label="upcoming records"
                className="grid gap-3 md:grid-cols-2"
                renderItem={(item) => (
                  <li
                    key={item.id}
                    className="rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <CalendarDays
                          className="size-4 shrink-0 text-[var(--primary)]"
                          aria-hidden="true"
                        />
                        <span className="font-medium text-[var(--ui-ink-strong)]">
                          {item.title}
                        </span>
                      </div>
                      <FreshnessBadge state={item.freshness} />
                    </div>
                    <p className="mt-3 text-sm text-[var(--ui-ink-medium)]">
                      {formatPeopleDateTime(item.startsAt)}
                    </p>
                    <p className="mt-1 text-xs text-[var(--ui-ink-muted)]">
                      Source: {item.sourceLabel} ·{" "}
                      {item.precision.replaceAll("_", " ")}
                    </p>
                  </li>
                )}
              />
            ) : (
              <InlineEmpty>
                {context.coverage.upcomingTogether === "unavailable"
                  ? "Forge could not load upcoming plans shared with you."
                  : "No upcoming plans are linked to this person."}
              </InlineEmpty>
            )}
          </PeopleSection>

          <PeopleSection
            headingLevel={sectionHeadingLevel}
            title="Linked Forge records"
          >
            {context.linkedRecords.length > 0 ? (
              <div className="grid gap-3">
                <PeopleProgressiveList
                  items={context.linkedRecords}
                  getKey={(record) => record.id}
                  resetKey={personId}
                  label="linked records"
                  className="divide-y divide-[var(--ui-border-subtle)] border-y border-[var(--ui-border-subtle)]"
                  renderItem={(record) => (
                    <LinkedRecordRow key={record.id} record={record} />
                  )}
                />
                {context.coverage.linkedRecords === "bounded" ? (
                  <PeopleStateBanner
                    state="info"
                    title="More linked records are available"
                  >
                    This page shows the first 100 linked records. Use search or
                    the knowledge graph to find the rest.
                  </PeopleStateBanner>
                ) : null}
              </div>
            ) : (
              <InlineEmpty>
                No Forge records are linked to this Person.
              </InlineEmpty>
            )}
          </PeopleSection>

          <PeopleSection
            headingLevel={sectionHeadingLevel}
            title="Profile Wiki page"
            actions={
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="min-h-11"
                disabled={!gateway.capabilities.wikiAssociation}
                title={
                  gateway.capabilities.wikiAssociation
                    ? undefined
                    : "Wiki links are unavailable in this Forge."
                }
                onClick={() => setFlow("wiki")}
              >
                <BookOpen className="size-4" aria-hidden="true" />
                Review Wiki link
              </Button>
            }
          >
            {context.wikiProfile ? (
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
                <div className="min-w-0">
                  <div className="font-medium text-[var(--ui-ink-strong)]">
                    {context.wikiProfile.title ?? "Associated Wiki profile"}
                  </div>
                  <p className="mt-1 text-xs text-[var(--ui-ink-muted)]">
                    {context.wikiProfile.spaceLabel
                      ? `${context.wikiProfile.spaceLabel} · `
                      : ""}
                    associated{" "}
                    {formatPeopleDateTime(context.wikiProfile.associatedAt)}
                  </p>
                  {context.wikiProfile.completeness === "metadata_only" ? (
                    <p className="mt-2 break-all text-xs text-[var(--ui-ink-muted)]">
                      Wiki page ID: {context.wikiProfile.pageId}. The title and
                      link are unavailable.
                    </p>
                  ) : null}
                  {context.wikiProfile.excerpt ? (
                    <p className="mt-3 text-sm leading-6 text-[var(--ui-ink-medium)]">
                      {context.wikiProfile.excerpt}
                    </p>
                  ) : null}
                </div>
                {context.wikiProfile.href ? (
                  <Link
                    to={context.wikiProfile.href}
                    className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-sm text-[var(--ui-ink-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-ring)]"
                  >
                    Open page
                    <ExternalLink className="size-4" aria-hidden="true" />
                  </Link>
                ) : (
                  <Badge size="sm" tone="meta">
                    Page cannot be opened
                  </Badge>
                )}
              </div>
            ) : (
              <InlineEmpty>No Wiki page is linked to this person.</InlineEmpty>
            )}
          </PeopleSection>
        </div>
      ) : null}

      {tab === "sharing" ? (
        <div
          id="person-tabpanel-sharing"
          role="tabpanel"
          tabIndex={0}
          aria-labelledby="person-tab-sharing"
          className="px-4 pb-8 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ui-ring)]"
        >
          {context.coverage.grants === "unavailable" ? (
            <PeopleStateBanner
              state="warning"
              title="Sharing details could not be loaded"
            >
              Saved person and connection details are available. The lists of
              information shared in either direction may be incomplete, so
              refresh before changing access.
            </PeopleStateBanner>
          ) : null}
          <PeopleSection
            headingLevel={sectionHeadingLevel}
            title="Shared with this person"
            description={`What you currently share with ${context.person.displayName}.`}
            actions={
              <Button
                type="button"
                size="sm"
                className="min-h-11"
                disabled={!shareReady}
                title={
                  !peerReady
                    ? "A verified paired Forge is required before sharing."
                    : context.coverage.peerDevices !== "complete"
                      ? "Refresh the device list before sharing."
                      : approvedRecipientDevices.length === 0
                        ? "Approve at least one recipient device before sharing."
                        : undefined
                }
                onClick={() => setFlow("share")}
              >
                <UsersRound className="size-4" aria-hidden="true" />
                New share
              </Button>
            }
          >
            {context.outgoingShares.length > 0 ? (
              <PeopleProgressiveList
                items={context.outgoingShares}
                getKey={(share) => share.versionKey}
                resetKey={personId}
                label="information you share"
                className="grid gap-3"
                renderItem={(share) => (
                  <ShareRow
                    key={share.versionKey}
                    share={share}
                    onRevoke={() =>
                      setConsequenceAction({
                        kind: "grant",
                        grantId: share.grantId,
                        label: share.label
                      })
                    }
                  />
                )}
              />
            ) : (
              <InlineEmpty>
                {context.coverage.grants === "unavailable"
                  ? `Forge could not load what you share with ${context.person.displayName}.`
                  : `No active share with ${context.person.displayName}.`}
              </InlineEmpty>
            )}
          </PeopleSection>

          <PeopleSection
            headingLevel={sectionHeadingLevel}
            title="Shared by this person"
            description={`What ${context.person.displayName} currently shares with you.`}
          >
            {context.incomingShares.length > 0 ? (
              <PeopleProgressiveList
                items={context.incomingShares}
                getKey={(share) => share.versionKey}
                resetKey={personId}
                label="information shared with you"
                className="grid gap-3"
                renderItem={(share) => (
                  <ShareRow key={share.versionKey} share={share} />
                )}
              />
            ) : (
              <InlineEmpty>
                {context.coverage.grants === "unavailable"
                  ? `Forge could not load what ${context.person.displayName} shares with you.`
                  : `${context.person.displayName} has no active share with you.`}
              </InlineEmpty>
            )}
          </PeopleSection>
        </div>
      ) : null}

      {tab === "connection" ? (
        <div
          id="person-tabpanel-connection"
          role="tabpanel"
          tabIndex={0}
          aria-labelledby="person-tab-connection"
          className="px-4 pb-8 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ui-ring)]"
        >
          <PeopleSection
            headingLevel={sectionHeadingLevel}
            title="Connection and devices"
            description={`Pairing verifies ${context.person.displayName}'s Forge and its devices. Pairing alone shares no information.`}
            actions={
              context.peer && !peerRevoked ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="min-h-11 text-[var(--danger)]"
                  onClick={() =>
                    setConsequenceAction({
                      kind: "relationship",
                      relationshipId: context.peer!.id,
                      label: context.peer!.displayLabel
                    })
                  }
                >
                  <ShieldOff className="size-4" aria-hidden="true" />
                  Revoke connection
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  className="min-h-11"
                  onClick={() => setFlow("pair")}
                >
                  <Wifi className="size-4" aria-hidden="true" />
                  Pair Forge
                </Button>
              )
            }
          >
            {context.peer ? (
              <div className="grid gap-4">
                <dl className="grid gap-x-6 rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 md:grid-cols-2">
                  <DetailField
                    label="Connected Forge"
                    value={context.peer.displayLabel}
                  />
                  <DetailField
                    label="Status"
                    value={context.peer.status.replaceAll("_", " ")}
                  />
                  <DetailField
                    label="Connection privacy"
                    value={context.peer.transportPrivacyMode.replaceAll(
                      "_",
                      " "
                    )}
                  />
                  <DetailField
                    label="Verified"
                    value={formatPeopleDateTime(context.peer.verifiedAt)}
                  />
                  <DetailField
                    label="Last reachable"
                    value={formatPeopleDateTime(context.peer.lastReachableAt)}
                  />
                  <DetailField
                    label="Verification phrase"
                    value={context.peer.verificationLabel}
                    privateValue
                  />
                </dl>
                {context.coverage.peerDevices === "unavailable" ? (
                  <PeopleStateBanner
                    state="warning"
                    title="Device list could not be loaded"
                  >
                    The connection is visible, but its current device list is
                    unavailable. An empty list here does not mean there are no
                    devices.
                  </PeopleStateBanner>
                ) : context.peer.devices.length > 0 ? (
                  <PeopleProgressiveList
                    items={context.peer.devices}
                    getKey={(device) => device.id}
                    resetKey={personId}
                    label="connected devices"
                    className="grid gap-3 md:grid-cols-2"
                    renderItem={(device) => (
                      <li
                        key={device.id}
                        className="rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4"
                      >
                        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                          <div className="flex min-w-0 items-start gap-3">
                            <Smartphone
                              className="mt-0.5 size-4 shrink-0 text-[var(--primary)]"
                              aria-hidden="true"
                            />
                            <div className="min-w-0">
                              <div className="font-medium text-[var(--ui-ink-strong)]">
                                {device.label}
                              </div>
                              <p className="mt-1 text-xs text-[var(--ui-ink-muted)]">
                                {device.deviceType.replaceAll("_", " ")} ·{" "}
                                {device.transportLabel ??
                                  "Connection method unavailable"}
                              </p>
                            </div>
                          </div>
                          <FreshnessBadge
                            state={device.freshness}
                            label={device.trustState.replaceAll("_", " ")}
                          />
                        </div>
                        <p className="mt-3 text-xs text-[var(--ui-ink-muted)]">
                          Last seen: {formatPeopleDateTime(device.lastSeenAt)}
                        </p>
                        {device.trustState !== "removed" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="mt-3 min-h-11 text-[var(--danger)]"
                            onClick={() =>
                              setConsequenceAction({
                                kind: "device",
                                relationshipId: context.peer!.id,
                                deviceId: device.id,
                                label: device.label
                              })
                            }
                          >
                            <WifiOff className="size-4" aria-hidden="true" />
                            Remove device
                          </Button>
                        ) : null}
                      </li>
                    )}
                  />
                ) : (
                  <InlineEmpty>No connected devices are listed.</InlineEmpty>
                )}
              </div>
            ) : (
              <InlineEmpty>
                This person is not connected to another Forge.
              </InlineEmpty>
            )}
          </PeopleSection>

          <PeopleSection
            headingLevel={sectionHeadingLevel}
            title="Security history"
            description="Saved evidence for changes to this person, sharing decisions, received information, and questions."
          >
            {context.audit.length > 0 ? (
              <PeopleProgressiveList
                items={context.audit}
                getKey={(event) => event.id}
                resetKey={personId}
                label="security history"
                ordered
                className="divide-y divide-[var(--ui-border-subtle)] border-y border-[var(--ui-border-subtle)]"
                renderItem={(event) => (
                  <li
                    key={event.id}
                    className="grid gap-2 py-3 md:grid-cols-[minmax(0,1fr)_auto]"
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-[var(--ui-ink-muted)]">
                          Event: {event.eventType}
                        </span>
                        <Badge size="xs" tone="meta">
                          Source: {event.source}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm leading-6 text-[var(--ui-ink-medium)]">
                        {event.summary}
                      </p>
                    </div>
                    <div className="text-xs text-[var(--ui-ink-muted)] md:text-right">
                      <span className="inline-flex items-center gap-1">
                        <Clock3 className="size-3" aria-hidden="true" />
                        {formatPeopleDateTime(event.occurredAt)}
                      </span>
                      <div className="mt-1">{event.actorLabel}</div>
                    </div>
                  </li>
                )}
              />
            ) : (
              <InlineEmpty>
                {context.coverage.audit === "unavailable"
                  ? "Security history is unavailable for this person."
                  : "No security history is recorded for this person."}
              </InlineEmpty>
            )}
          </PeopleSection>
        </div>
      ) : null}

      <PersonEditorFlow
        open={flow === "edit"}
        context={context}
        onOpenChange={(open) => setFlow(open ? "edit" : null)}
        onSaved={updateContext}
      />
      <WikiAssociationFlow
        open={flow === "wiki"}
        context={context}
        onOpenChange={(open) => setFlow(open ? "wiki" : null)}
        onApplied={(nextContext) => {
          updateContext(nextContext);
          if (nextContext.person.id !== context.person.id) {
            onNavigatePerson?.(nextContext.person.id);
          }
        }}
      />
      <PairingFlow
        open={flow === "pair"}
        context={context}
        onOpenChange={(open) => setFlow(open ? "pair" : null)}
        onPaired={updateContext}
      />
      <ShareGrantFlow
        open={flow === "share"}
        context={context}
        onOpenChange={(open) => setFlow(open ? "share" : null)}
        onUpdated={updateContext}
      />
      <AskPersonFlow
        open={flow === "ask"}
        context={context}
        onOpenChange={(open) => setFlow(open ? "ask" : null)}
        onReviewIncomingAccess={() => {
          setFlow(null);
          setTab("connection");
        }}
      />
      <PeopleConsequenceFlow
        open={Boolean(consequenceAction)}
        action={consequenceAction}
        context={context}
        onOpenChange={(open) => {
          if (!open) {
            setConsequenceAction(null);
          }
        }}
        onUpdated={updateContext}
      />
    </article>
  );
}

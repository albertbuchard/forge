import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, Save } from "lucide-react";
import { PageHero } from "@/components/shell/page-hero";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  EvidenceList,
  WorkStatusBadge,
  formatDate,
  readable
} from "@/components/work/work-components";
import {
  InterviewDialog,
  OfferDialog,
  OutreachDialog
} from "@/components/work/work-operational-dialogs";
import { acceptWorkOffer, updateWorkOrganization } from "@/lib/work-api";
import type {
  JobApplication,
  OpportunityCampaign,
  WorkRecord
} from "@/lib/work-api";
import {
  details,
  EventTimeline,
  RelationshipEditor,
  SupportingRevisionHistory,
  WorkDetailSections,
  FactsGrid,
  record
} from "./work-detail-shared";

export function OrganizationOperationalDetail({
  organization,
  userIds,
  onRefresh
}: {
  organization: WorkRecord;
  userIds: string[];
  onRefresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(String(organization.name ?? ""));
  const [domain, setDomain] = useState(String(organization.domain ?? ""));
  const [websiteUrl, setWebsiteUrl] = useState(
    String(organization.websiteUrl ?? "")
  );
  const [location, setLocation] = useState(
    String(record(organization.location).label ?? "")
  );
  const [status, setStatus] = useState(String(organization.status ?? "active"));
  const [description, setDescription] = useState(
    String(organization.description ?? "")
  );
  useEffect(() => {
    setName(String(organization.name ?? ""));
    setDomain(String(organization.domain ?? ""));
    setWebsiteUrl(String(organization.websiteUrl ?? ""));
    setLocation(String(record(organization.location).label ?? ""));
    setStatus(String(organization.status ?? "active"));
    setDescription(String(organization.description ?? ""));
  }, [organization]);
  const save = useMutation({
    mutationFn: () =>
      updateWorkOrganization(userIds, organization.id, {
        expectedRevision: Number(organization.revision),
        name,
        domain,
        websiteUrl,
        location: { ...record(organization.location), label: location },
        status,
        description,
        provenance: {
          sourceKind: "user",
          sourceLabel: "Forge Work organization editor"
        }
      }),
    onSuccess: async () => {
      setEditing(false);
      await onRefresh();
    }
  });
  return (
    <div className="grid gap-5">
      <PageHero
        entityKind="work_organization"
        title={String(organization.name ?? "Work organization")}
        description={String(
          organization.description ??
            organization.domain ??
            "Employer, client, or target organization."
        )}
        badge={<WorkStatusBadge status={organization.status} />}
        actions={
          <Button onClick={() => setEditing((current) => !current)}>
            {editing ? "Cancel edit" : "Edit organization"}
          </Button>
        }
      />
      <div className="grid gap-5 px-4 sm:px-6">
        <Link
          to="/work?tab=current"
          className="inline-flex items-center gap-2 text-sm text-[var(--primary)]"
        >
          <ArrowLeft className="size-4" />
          Back to Work
        </Link>
        <WorkDetailSections
          defaultSection="summary"
          options={[
            { id: "summary", label: "Summary" },
            { id: "activity", label: "Activity" },
            { id: "connections", label: "Connections" }
          ]}
        >
          {(section) => (
            <>
              {section === "summary" ? (
                <>
                  {editing ? (
                    <Card className="grid gap-4 md:grid-cols-2">
                      <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                        Name
                        <Input
                          value={name}
                          onChange={(event) => setName(event.target.value)}
                        />
                      </label>
                      <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                        Domain or sector
                        <Input
                          value={domain}
                          onChange={(event) => setDomain(event.target.value)}
                        />
                      </label>
                      <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                        Website
                        <Input
                          type="url"
                          value={websiteUrl}
                          onChange={(event) =>
                            setWebsiteUrl(event.target.value)
                          }
                        />
                      </label>
                      <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                        Location
                        <Input
                          value={location}
                          onChange={(event) => setLocation(event.target.value)}
                        />
                      </label>
                      <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                        Status
                        <select
                          value={status}
                          onChange={(event) => setStatus(event.target.value)}
                          className="min-h-11 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-sm"
                        >
                          {[
                            "active",
                            "target",
                            "excluded",
                            "past",
                            "archived"
                          ].map((value) => (
                            <option key={value} value={value}>
                              {readable(value)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)] md:col-span-2">
                        Description
                        <Textarea
                          rows={5}
                          value={description}
                          onChange={(event) =>
                            setDescription(event.target.value)
                          }
                        />
                      </label>
                      <div className="md:col-span-2">
                        <Button
                          disabled={!name.trim()}
                          pending={save.isPending}
                          onClick={() => save.mutate()}
                        >
                          <Save className="size-4" />
                          Save organization
                        </Button>
                        {save.error ? (
                          <p className="mt-2 text-sm text-[var(--danger)]">
                            {save.error.message}
                          </p>
                        ) : null}
                      </div>
                    </Card>
                  ) : null}
                  <FactsGrid
                    facts={[
                      { label: "Domain", value: organization.domain },
                      { label: "Website", value: organization.websiteUrl },
                      { label: "Status", value: organization.status },
                      ...details(organization.location)
                        .slice(0, 3)
                        .map(([label, value]) => ({ label, value }))
                    ]}
                  />
                </>
              ) : null}
              {section === "activity" ? (
                <EventTimeline
                  events={organization.history}
                  empty="No organization history has been recorded."
                />
              ) : null}
              {section === "connections" ? (
                <RelationshipEditor
                  links={organization.links}
                  entityType="work_organization"
                  entityId={String(organization.id)}
                  revision={Number(organization.revision)}
                  userIds={userIds}
                  onRefresh={onRefresh}
                />
              ) : null}
            </>
          )}
        </WorkDetailSections>
      </div>
    </div>
  );
}

export function SupportingOperationalDetail({
  kind,
  item,
  userIds,
  campaigns,
  organizations,
  applications,
  onRefresh
}: {
  kind: "interviews" | "offers" | "outreach";
  item: WorkRecord;
  userIds: string[];
  campaigns: OpportunityCampaign[];
  organizations: WorkRecord[];
  applications: JobApplication[];
  onRefresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmAccept, setConfirmAccept] = useState(false);
  const entityKind =
    kind === "interviews"
      ? "job_interview"
      : kind === "offers"
        ? "job_offer"
        : "work_outreach";
  const title =
    kind === "interviews"
      ? `Interview · ${readable(item.stage)}`
      : kind === "offers"
        ? String(record(item.terms).title ?? "Job offer")
        : "Work outreach";
  const privateKeys = new Set([
    "privateLocationOrLink",
    "privateCompensation",
    "terms",
    "notes",
    "response",
    "revisionHistory",
    "offerRevisions"
  ]);
  const facts = Object.entries(item)
    .filter(
      ([key, value]) =>
        !privateKeys.has(key) &&
        ![
          "id",
          "ownerUserId",
          "revision",
          "createdAt",
          "updatedAt",
          "provenance"
        ].includes(key) &&
        !/(?:id|ids)$/iu.test(key) &&
        value !== null &&
        value !== "" &&
        typeof value !== "object"
    )
    .slice(0, 18)
    .map(([label, value]) => ({
      label: label.replaceAll(/([A-Z])/gu, " $1"),
      value
    }));
  const application = applications.find(
    (candidate) => candidate.id === item.applicationId
  );
  const campaign = campaigns.find(
    (candidate) => candidate.id === application?.primaryCampaignId
  );
  const accept = useMutation({
    mutationFn: () =>
      acceptWorkOffer(userIds, item.id, {
        expectedRevision: Number(item.revision),
        idempotencyKey: `work-offer-accept-${Date.now()}-${crypto.randomUUID()}`
      }),
    onSuccess: async () => {
      setConfirmAccept(false);
      await onRefresh();
    }
  });
  const terms = record(item.terms);
  const compensation = record(item.privateCompensation);
  const base = record(compensation.base);
  const participants = Array.isArray(item.participantLinks)
    ? item.participantLinks.map((entry) => record(entry))
    : [];
  const questionBank = Array.isArray(item.questionBank)
    ? item.questionBank.map((entry) => record(entry))
    : [];
  return (
    <div className="grid gap-5">
      <PageHero
        entityKind={entityKind}
        title={title}
        description="Application context, history, and connections in focused sections."
        badge={<WorkStatusBadge status={item.status ?? item.stage} />}
        actions={<Button onClick={() => setEditing(true)}>Edit</Button>}
      />
      <div className="grid gap-5 px-4 sm:px-6">
        <Link
          to={
            item.applicationId
              ? `/work/applications/${item.applicationId}`
              : "/work"
          }
          className="inline-flex items-center gap-2 text-sm text-[var(--primary)]"
        >
          <ArrowLeft className="size-4" />
          Back to application
        </Link>
        <WorkDetailSections
          defaultSection="summary"
          options={[
            { id: "summary", label: "Summary" },
            ...(kind === "outreach"
              ? []
              : [
                  {
                    id: "details",
                    label:
                      kind === "interviews"
                        ? "Interview details"
                        : "Offer details"
                  }
                ]),
            { id: "activity", label: "Activity" },
            { id: "connections", label: "Connections" }
          ]}
        >
          {(section) => (
            <>
              {section === "summary" ? <FactsGrid facts={facts} /> : null}
              {section === "details" && kind === "interviews" ? (
                <div className="grid gap-5 lg:grid-cols-2">
                  <Card>
                    <h2 className="font-semibold text-[var(--ui-ink-strong)]">
                      Schedule and participants
                    </h2>
                    <dl className="mt-3 grid gap-3 text-sm">
                      <div>
                        <dt className="text-xs text-[var(--ui-ink-faint)]">
                          Private location or call link
                        </dt>
                        <dd className="mt-1 break-all text-[var(--ui-ink-strong)]">
                          {String(item.privateLocationOrLink || "Not recorded")}
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-4 grid gap-2">
                      {participants.map((participant, index) => (
                        <Link
                          key={`${String(participant.personId)}-${index}`}
                          to={`/people/${encodeURIComponent(String(participant.personId))}`}
                          className="rounded-[15px] bg-[var(--ui-surface-2)] p-3"
                        >
                          <div className="text-sm font-medium text-[var(--ui-ink-strong)]">
                            {String(participant.label || participant.personId)}
                          </div>
                          <div className="mt-1 text-xs text-[var(--ui-ink-soft)]">
                            {String(participant.role || "Participant")}
                          </div>
                        </Link>
                      ))}
                    </div>
                  </Card>
                  <Card>
                    <h2 className="font-semibold text-[var(--ui-ink-strong)]">
                      Preparation
                    </h2>
                    <div className="mt-3">
                      <EvidenceList
                        title="Focus areas"
                        items={item.focusAreas}
                      />
                    </div>
                    {item.preparationArtifactId ? (
                      <Link
                        to={`/artifacts/${encodeURIComponent(String(item.preparationArtifactId))}`}
                        className="mt-4 inline-flex text-sm font-medium text-[var(--primary)]"
                      >
                        Open preparation file
                      </Link>
                    ) : null}
                    <div className="mt-4">
                      <EvidenceList
                        title="Question bank"
                        items={questionBank
                          .map((question) =>
                            String(question.question ?? question.prompt ?? "")
                          )
                          .filter(Boolean)}
                      />
                    </div>
                  </Card>
                  <Card className="lg:col-span-2">
                    <div className="grid gap-5 md:grid-cols-3">
                      <div>
                        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
                          Private notes
                        </h3>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--ui-ink-medium)]">
                          {String(item.notes || "No notes recorded.")}
                        </p>
                      </div>
                      <div>
                        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
                          Factual outcome
                        </h3>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--ui-ink-medium)]">
                          {String(item.outcome || "No outcome recorded.")}
                        </p>
                      </div>
                      <div>
                        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
                          Follow-up
                        </h3>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--ui-ink-medium)]">
                          {String(item.followUp || "No follow-up recorded.")}
                        </p>
                      </div>
                    </div>
                  </Card>
                </div>
              ) : null}
              {section === "details" && kind === "offers" ? (
                <div className="grid gap-5 lg:grid-cols-2">
                  <Card>
                    <h2 className="font-semibold text-[var(--ui-ink-strong)]">
                      Offer terms
                    </h2>
                    <FactsGrid
                      facts={[
                        { label: "Title", value: terms.title },
                        { label: "Level", value: terms.level },
                        { label: "Work model", value: terms.workModel },
                        {
                          label: "Engagement type",
                          value: terms.employmentType
                        },
                        {
                          label: "Start date",
                          value: formatDate(terms.startDate)
                        },
                        {
                          label: "Location",
                          value: record(terms.location).label
                        }
                      ]}
                    />
                  </Card>
                  <Card>
                    <h2 className="font-semibold text-[var(--ui-ink-strong)]">
                      Private compensation
                    </h2>
                    <p className="mt-3 text-sm text-[var(--ui-ink-medium)]">
                      {base.amount == null
                        ? "Unknown or not stored"
                        : `${String(base.amount)} ${String(base.currency ?? "")} per ${String(base.period ?? "period")}`}
                    </p>
                    <p className="mt-3 text-xs leading-5 text-[var(--ui-ink-faint)]">
                      This section requires the separate Work compensation
                      permission.
                    </p>
                  </Card>
                </div>
              ) : null}
              {section === "details" && kind === "offers" ? (
                <div className="grid gap-5 lg:grid-cols-2">
                  <Card>
                    <EvidenceList
                      title="Contingencies"
                      items={
                        Array.isArray(item.contingencies)
                          ? item.contingencies
                              .map((entry) =>
                                String(
                                  record(entry).label ??
                                    record(entry).description ??
                                    ""
                                )
                              )
                              .filter(Boolean)
                          : []
                      }
                    />
                    <div className="mt-5">
                      <EvidenceList
                        title="Negotiation asks"
                        items={
                          Array.isArray(item.negotiationAsks)
                            ? item.negotiationAsks
                                .map((entry) =>
                                  String(
                                    record(entry).label ??
                                      record(entry).description ??
                                      ""
                                  )
                                )
                                .filter(Boolean)
                            : []
                        }
                      />
                    </div>
                  </Card>
                  <Card>
                    <h2 className="font-semibold text-[var(--ui-ink-strong)]">
                      Decision record
                    </h2>
                    <div className="mt-3 grid gap-4">
                      <div>
                        <h3 className="text-xs uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
                          Response
                        </h3>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--ui-ink-medium)]">
                          {String(item.response || "No response recorded.")}
                        </p>
                      </div>
                      <div>
                        <h3 className="text-xs uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
                          Decision
                        </h3>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--ui-ink-medium)]">
                          {String(item.decision || "No decision recorded.")}
                        </p>
                      </div>
                      <div>
                        <h3 className="text-xs uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
                          Rationale
                        </h3>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--ui-ink-medium)]">
                          {String(item.rationale || "No rationale recorded.")}
                        </p>
                      </div>
                    </div>
                  </Card>
                  {Array.isArray(item.artifactIds) &&
                  item.artifactIds.length ? (
                    <Card className="lg:col-span-2">
                      <h2 className="font-semibold text-[var(--ui-ink-strong)]">
                        Offer documents
                      </h2>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {Array.isArray(item.artifactIds)
                          ? item.artifactIds.map((artifactId) => (
                              <Link
                                key={String(artifactId)}
                                to={`/artifacts/${encodeURIComponent(String(artifactId))}`}
                                className="rounded-[14px] bg-[var(--ui-surface-2)] px-3 py-2 text-sm text-[var(--primary)]"
                              >
                                Open offer file
                              </Link>
                            ))
                          : null}
                      </div>
                    </Card>
                  ) : null}
                </div>
              ) : null}
              {section === "summary" ? (
                <Card>
                  <h2 className="font-semibold text-[var(--ui-ink-strong)]">
                    Next action
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-medium)]">
                    {String(
                      item.nextAction ??
                        item.decision ??
                        "No next action recorded."
                    )}
                  </p>
                </Card>
              ) : null}
              {section === "summary" &&
              kind === "offers" &&
              ["received", "negotiating", "revised"].includes(
                String(item.status)
              ) &&
              !item.plannedEngagementId ? (
                <Card>
                  <h2 className="font-semibold text-[var(--ui-ink-strong)]">
                    Accept and create planned work
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
                    Acceptance creates planned work from this offer, marks the
                    application accepted, and keeps both histories.
                  </p>
                  {confirmAccept ? (
                    <div className="mt-4 rounded-[18px] border border-[color-mix(in_srgb,var(--warning)_35%,var(--ui-border-subtle))] p-4">
                      <p className="text-sm font-medium text-[var(--ui-ink-strong)]">
                        Confirm that this offer was accepted.
                      </p>
                      <p className="mt-1 text-xs leading-5 text-[var(--ui-ink-soft)]">
                        Forge will not infer acceptance from receipt or
                        negotiation alone.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          pending={accept.isPending}
                          onClick={() => accept.mutate()}
                        >
                          Confirm acceptance
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => setConfirmAccept(false)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      className="mt-4"
                      onClick={() => setConfirmAccept(true)}
                    >
                      Accept offer and create planned work
                    </Button>
                  )}
                  {accept.error ? (
                    <p className="mt-3 text-sm text-[var(--danger)]">
                      {accept.error.message}
                    </p>
                  ) : null}
                </Card>
              ) : null}
              {section === "summary" && item.plannedEngagementId ? (
                <Card>
                  <h2 className="font-semibold text-[var(--ui-ink-strong)]">
                    Planned work
                  </h2>
                  <Link
                    className="mt-3 inline-flex text-sm font-medium text-[var(--primary)]"
                    to={`/work/engagements/${String(item.plannedEngagementId)}`}
                  >
                    Open planned work
                  </Link>
                </Card>
              ) : null}
              {section === "connections" ? (
                <RelationshipEditor
                  links={item.links}
                  entityType={entityKind}
                  entityId={String(item.id)}
                  revision={Number(item.revision)}
                  userIds={userIds}
                  onRefresh={onRefresh}
                />
              ) : null}
              {section === "activity" ? (
                <SupportingRevisionHistory revisions={item.revisionHistory} />
              ) : null}
            </>
          )}
        </WorkDetailSections>
      </div>
      {kind === "interviews" ? (
        <InterviewDialog
          open={editing}
          onOpenChange={setEditing}
          userIds={userIds}
          applicationId={String(item.applicationId)}
          interview={item}
          onSaved={onRefresh}
        />
      ) : null}
      {kind === "offers" ? (
        <OfferDialog
          open={editing}
          onOpenChange={setEditing}
          userIds={userIds}
          applicationId={String(item.applicationId)}
          offer={item}
          criteriaVersionId={String(campaign?.currentCriteria?.id ?? "")}
          onSaved={onRefresh}
        />
      ) : null}
      {kind === "outreach" ? (
        <OutreachDialog
          open={editing}
          onOpenChange={setEditing}
          userIds={userIds}
          campaigns={campaigns}
          organizations={organizations}
          outreach={item}
          onSaved={onRefresh}
        />
      ) : null}
    </div>
  );
}

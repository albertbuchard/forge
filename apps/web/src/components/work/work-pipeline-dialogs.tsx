import { useEffect, useState } from "react";
import {
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createJobApplication,
  recordWorkCheckIn,
  upsertJobOpportunity,
  type JobOpportunity,
  type OpportunityCampaign,
  type WorkEngagement,
  type WorkRecord
} from "@/lib/work-api";
import {
  errorMessage,
  idempotencyKey,
  lines,
  NativeSelect,
  workInterfaceProvenance as provenance
} from "@/components/work/work-dialog-helpers";

type OpportunityDraft = {
  title: string;
  employerName: string;
  canonicalUrl: string;
  sourceName: string;
  sourceIdentifier: string;
  roleFamily: string;
  seniority: string;
  description: string;
  workModel: string;
  employmentType: string;
  location: string;
  deadline: string;
  responsibilities: string;
  requirements: string;
  skills: string;
  unknowns: string;
  redFlags: string;
  nextAction: string;
};

const emptyOpportunity: OpportunityDraft = {
  title: "",
  employerName: "",
  canonicalUrl: "",
  sourceName: "Manual research",
  sourceIdentifier: "",
  roleFamily: "",
  seniority: "",
  description: "",
  workModel: "unknown",
  employmentType: "unknown",
  location: "",
  deadline: "",
  responsibilities: "",
  requirements: "",
  skills: "",
  unknowns: "",
  redFlags: "",
  nextAction: "Review fit against the current campaign criteria."
};

export function JobOpportunityDialog({
  open,
  onOpenChange,
  userIds,
  onSaved
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userIds: string[];
  onSaved: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState(emptyOpportunity);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const steps: Array<QuestionFlowStep<OpportunityDraft>> = [
    {
      id: "source",
      eyebrow: "Sourced opportunity",
      title: "Where did this role come from?",
      description:
        "Canonical source identity and provenance let Forge deduplicate the same role across campaigns and search runs.",
      render: (value, setValue) => (
        <div className="grid gap-4 md:grid-cols-2">
          <FlowField label="Role title" className="md:col-span-2">
            <Input
              value={value.title}
              onChange={(event) => setValue({ title: event.target.value })}
              autoFocus
            />
          </FlowField>
          <FlowField label="Employer">
            <Input
              value={value.employerName}
              onChange={(event) =>
                setValue({ employerName: event.target.value })
              }
            />
          </FlowField>
          <FlowField label="Canonical URL">
            <Input
              type="url"
              value={value.canonicalUrl}
              onChange={(event) =>
                setValue({ canonicalUrl: event.target.value })
              }
            />
          </FlowField>
          <FlowField label="Source">
            <Input
              value={value.sourceName}
              onChange={(event) => setValue({ sourceName: event.target.value })}
            />
          </FlowField>
          <FlowField label="Source identifier">
            <Input
              value={value.sourceIdentifier}
              onChange={(event) =>
                setValue({ sourceIdentifier: event.target.value })
              }
            />
          </FlowField>
        </div>
      )
    },
    {
      id: "facts",
      eyebrow: "Role facts",
      title: "What does the source actually say?",
      description:
        "Unknown values stay unknown. Material claims keep source provenance instead of being guessed.",
      render: (value, setValue) => (
        <div className="grid gap-4 md:grid-cols-2">
          <FlowField label="Role family">
            <Input
              value={value.roleFamily}
              onChange={(event) => setValue({ roleFamily: event.target.value })}
            />
          </FlowField>
          <FlowField label="Seniority">
            <Input
              value={value.seniority}
              onChange={(event) => setValue({ seniority: event.target.value })}
            />
          </FlowField>
          <NativeSelect
            label="Work model"
            value={value.workModel}
            onChange={(workModel) => setValue({ workModel })}
          >
            <option value="unknown">Unknown</option>
            <option value="remote">Remote</option>
            <option value="hybrid">Hybrid</option>
            <option value="on_site">On site</option>
            <option value="variable">Variable</option>
          </NativeSelect>
          <FlowField label="Employment type">
            <Input
              value={value.employmentType}
              onChange={(event) =>
                setValue({ employmentType: event.target.value })
              }
            />
          </FlowField>
          <FlowField label="Location">
            <Input
              value={value.location}
              onChange={(event) => setValue({ location: event.target.value })}
            />
          </FlowField>
          <FlowField label="Application deadline">
            <Input
              type="date"
              value={value.deadline}
              onChange={(event) => setValue({ deadline: event.target.value })}
            />
          </FlowField>
          <FlowField label="Source description" className="md:col-span-2">
            <Textarea
              rows={8}
              value={value.description}
              onChange={(event) =>
                setValue({ description: event.target.value })
              }
            />
          </FlowField>
        </div>
      )
    },
    {
      id: "evidence",
      eyebrow: "Evidence and gaps",
      title: "What is known, missing, or concerning?",
      description:
        "Keep factual requirements separate from unresolved facts and red flags.",
      render: (value, setValue) => (
        <div className="grid gap-4 md:grid-cols-2">
          <FlowField label="Responsibilities" hint="One per line">
            <Textarea
              rows={6}
              value={value.responsibilities}
              onChange={(event) =>
                setValue({ responsibilities: event.target.value })
              }
            />
          </FlowField>
          <FlowField label="Requirements" hint="One per line">
            <Textarea
              rows={6}
              value={value.requirements}
              onChange={(event) =>
                setValue({ requirements: event.target.value })
              }
            />
          </FlowField>
          <FlowField label="Skills and technologies" hint="One per line">
            <Textarea
              rows={5}
              value={value.skills}
              onChange={(event) => setValue({ skills: event.target.value })}
            />
          </FlowField>
          <FlowField label="Unknown facts" hint="One per line">
            <Textarea
              rows={5}
              value={value.unknowns}
              onChange={(event) => setValue({ unknowns: event.target.value })}
            />
          </FlowField>
          <FlowField label="Red flags" hint="One per line">
            <Textarea
              rows={5}
              value={value.redFlags}
              onChange={(event) => setValue({ redFlags: event.target.value })}
            />
          </FlowField>
          <FlowField label="Next action">
            <Textarea
              rows={5}
              value={value.nextAction}
              onChange={(event) => setValue({ nextAction: event.target.value })}
            />
          </FlowField>
        </div>
      )
    }
  ];
  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Work · Discovery"
      title="Add job opportunity"
      description="Upsert one sourced role with deduplication and explicit unknowns."
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel="Add opportunity"
      pending={pending}
      error={error}
      resolveContinueBlocker={(step) =>
        step === "source" && !draft.title.trim()
          ? "Enter the source role title."
          : null
      }
      draftPersistenceKey="job-opportunity-new"
      onSubmit={async () => {
        setPending(true);
        setError(null);
        try {
          await upsertJobOpportunity(userIds, {
            organizationId: null,
            canonicalUrl: draft.canonicalUrl,
            sourceName: draft.sourceName,
            sourceIdentifier: draft.sourceIdentifier,
            title: draft.title,
            employerName: draft.employerName,
            roleFamily: draft.roleFamily,
            seniority: draft.seniority,
            description: draft.description,
            responsibilities: lines(draft.responsibilities),
            requirements: lines(draft.requirements),
            preferredQualifications: [],
            skills: lines(draft.skills),
            technologies: [],
            sector: "",
            location: draft.location ? { label: draft.location } : {},
            workModel: draft.workModel,
            travel: {},
            sponsorship: {},
            employmentType: draft.employmentType,
            weeklyHours: {},
            duration: {},
            startDate: null,
            compensation: {},
            benefits: [],
            applicationRoute: {},
            publishedAt: null,
            applicationDeadline: draft.deadline || null,
            availabilityStatus: "unknown",
            disposition: "discovered",
            confidence: null,
            unknowns: lines(draft.unknowns),
            redFlags: lines(draft.redFlags),
            eligibilityUncertainties: [],
            excitement: null,
            decision: "",
            decisionRationale: "",
            nextAction: draft.nextAction,
            scope: { projectIds: [], tagIds: [] },
            sourceSnapshotArtifactId: null,
            provenance: {
              ...provenance,
              sourceKind: "external_source",
              sourceLabel: draft.sourceName,
              sourceUrl: draft.canonicalUrl
            },
            idempotencyKey: idempotencyKey("opportunity")
          });
          setDraft(emptyOpportunity);
          onOpenChange(false);
          await onSaved();
        } catch (caught) {
          setError(errorMessage(caught));
        } finally {
          setPending(false);
        }
      }}
    />
  );
}

type CheckInValue = number | string | null;
type CheckInDraft = {
  engagementId: string;
  note: string;
  values: Record<string, CheckInValue>;
};

function metricScale(definition: WorkRecord) {
  const scale =
    definition.scale && typeof definition.scale === "object"
      ? (definition.scale as Record<string, unknown>)
      : {};
  const minimum = typeof scale.minimum === "number" ? scale.minimum : 1;
  const maximum =
    typeof scale.maximum === "number" && scale.maximum > minimum
      ? scale.maximum
      : 5;
  const anchors = Array.isArray(scale.anchors)
    ? scale.anchors.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const anchor = entry as Record<string, unknown>;
        return typeof anchor.value === "number"
          ? [
              {
                value: anchor.value,
                label: String(anchor.label ?? anchor.value)
              }
            ]
          : [];
      })
    : [];
  const options = Array.isArray(scale.options)
    ? scale.options.filter(
        (entry): entry is string => typeof entry === "string"
      )
    : [];
  const precision = String(scale.precision ?? "ordinal");
  const integerRange =
    Number.isInteger(minimum) &&
    Number.isInteger(maximum) &&
    maximum - minimum <= 8
      ? Array.from(
          { length: maximum - minimum + 1 },
          (_entry, index) => minimum + index
        )
      : [];
  return { minimum, maximum, anchors, options, precision, integerRange };
}

export function WorkCheckInDialog({
  open,
  onOpenChange,
  userIds,
  engagements,
  definitions,
  initialEngagementId,
  onSaved
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userIds: string[];
  engagements: WorkEngagement[];
  definitions: WorkRecord[];
  initialEngagementId?: string;
  onSaved: () => Promise<void> | void;
}) {
  const enabledDefinitions = definitions.filter(
    (definition) => definition.enabled !== false
  );
  const [draft, setDraft] = useState<CheckInDraft>({
    engagementId: initialEngagementId ?? engagements[0]?.id ?? "",
    note: "",
    values: {}
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open && initialEngagementId)
      setDraft((current) => ({
        ...current,
        engagementId: initialEngagementId
      }));
  }, [initialEngagementId, open]);
  const selectedCount = Object.values(draft.values).filter(
    (value) => value !== null
  ).length;
  const steps: Array<QuestionFlowStep<CheckInDraft>> = [
    {
      id: "engagement",
      eyebrow: "Fast check-in",
      title: "Which work arrangement are you checking in on?",
      description:
        "Each observation remains attached to one engagement, timestamp, timezone, metric definition, and provenance source.",
      render: (value, setValue) => (
        <NativeSelect
          label="Work engagement"
          value={value.engagementId}
          onChange={(engagementId) => setValue({ engagementId })}
        >
          <option value="">Choose work</option>
          {engagements.map((engagement) => (
            <option key={engagement.id} value={engagement.id}>
              {engagement.title}
            </option>
          ))}
        </NativeSelect>
      )
    },
    {
      id: "metrics",
      eyebrow: "How is it going?",
      title: "Answer only what is useful today",
      description:
        "Use each metric’s own anchored scale. A higher value means more of the named quality; it is not automatically better or worse. Skipped metrics remain missing, not neutral.",
      render: (value, setValue) => (
        <div className="grid gap-3">
          {enabledDefinitions.map((definition) => {
            const key = definition.id;
            const current = value.values[key] ?? null;
            const scale = metricScale(definition);
            const categorical = definition.valueKind === "categorical";
            const choices = categorical ? scale.options : scale.integerRange;
            return (
              <fieldset
                key={key}
                className="rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4"
              >
                <legend className="px-1 text-sm font-semibold text-[var(--ui-ink-strong)]">
                  {String(definition.displayName ?? definition.canonicalKey)}
                </legend>
                <div className="mt-1 text-xs leading-5 text-[var(--ui-ink-soft)]">
                  {String(definition.description ?? "")}
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  <button
                    type="button"
                    aria-pressed={current === null}
                    onClick={() =>
                      setValue({ values: { ...value.values, [key]: null } })
                    }
                    className={`min-h-10 rounded-xl border text-xs ${current === null ? "border-[var(--primary)] bg-[var(--ui-accent-soft)]" : "border-[var(--ui-border-subtle)]"}`}
                  >
                    Skip
                  </button>
                  {choices.map((choice) => {
                    const anchor =
                      typeof choice === "number"
                        ? scale.anchors.find((entry) => entry.value === choice)
                        : null;
                    const label = anchor?.label ?? String(choice);
                    return (
                      <button
                        key={String(choice)}
                        type="button"
                        aria-label={`${String(definition.displayName)}: ${label}`}
                        title={label}
                        aria-pressed={current === choice}
                        onClick={() =>
                          setValue({
                            values: { ...value.values, [key]: choice }
                          })
                        }
                        className={`min-h-10 rounded-xl border px-2 text-sm font-semibold ${current === choice ? "border-[var(--primary)] bg-[var(--ui-accent-soft)] text-[var(--ui-ink-strong)]" : "border-[var(--ui-border-subtle)] text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-hover)]"}`}
                      >
                        <span className="block">{choice}</span>
                        {anchor ? (
                          <span className="block truncate text-[10px] font-normal text-[var(--ui-ink-soft)]">
                            {anchor.label}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                {!categorical && choices.length === 0 ? (
                  <label className="mt-3 grid max-w-xs gap-1 text-xs text-[var(--ui-ink-soft)]">
                    Value from {scale.minimum} to {scale.maximum}
                    <Input
                      type="number"
                      min={scale.minimum}
                      max={scale.maximum}
                      step={
                        scale.precision === "integer" ||
                        scale.precision === "ordinal"
                          ? 1
                          : 0.1
                      }
                      value={typeof current === "number" ? current : ""}
                      onChange={(event) =>
                        setValue({
                          values: {
                            ...value.values,
                            [key]:
                              event.target.value === ""
                                ? null
                                : Number(event.target.value)
                          }
                        })
                      }
                    />
                  </label>
                ) : null}
                {categorical && choices.length === 0 ? (
                  <p className="mt-3 text-xs text-[var(--danger)]">
                    This categorical metric has no defined response options.
                    Edit its definition before recording it.
                  </p>
                ) : null}
              </fieldset>
            );
          })}
        </div>
      )
    },
    {
      id: "context",
      eyebrow: "Context",
      title: "What explains today’s answers?",
      description:
        "A short note helps distinguish a durable change from a single incident. It is optional.",
      render: (value, setValue) => (
        <FlowField label="Context note">
          <Textarea
            rows={9}
            value={value.note}
            onChange={(event) => setValue({ note: event.target.value })}
            autoFocus
          />
        </FlowField>
      )
    }
  ];
  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Work · Check-in"
      title="Work check-in"
      description="Record user-reported work experience over time."
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel={`Save ${selectedCount || ""} check-in${selectedCount === 1 ? "" : ""}`}
      pending={pending}
      error={error}
      resolveContinueBlocker={(step) =>
        step === "engagement" && !draft.engagementId
          ? "Choose a work engagement."
          : step === "metrics" && selectedCount === 0
            ? "Answer at least one metric. Skipped metrics remain missing."
            : null
      }
      onSubmit={async () => {
        setPending(true);
        setError(null);
        try {
          await recordWorkCheckIn(userIds, {
            engagementId: draft.engagementId,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
            note: draft.note,
            tags: [],
            context: {},
            sourceKind: "user_entered",
            confirmationState: "confirmed",
            userConfirmation: null,
            observations: enabledDefinitions.flatMap((definition) => {
              const observedValue = draft.values[definition.id];
              return observedValue === undefined || observedValue === null
                ? []
                : [
                    {
                      metricDefinitionId: definition.id,
                      numericValue:
                        typeof observedValue === "number"
                          ? observedValue
                          : null,
                      categoricalValue:
                        typeof observedValue === "string"
                          ? observedValue
                          : null,
                      missingState: "observed",
                      confidence: null,
                      note: "",
                      tags: [],
                      context: {}
                    }
                  ];
            }),
            provenance,
            idempotencyKey: idempotencyKey("check-in")
          });
          setDraft({
            engagementId: initialEngagementId ?? engagements[0]?.id ?? "",
            note: "",
            values: {}
          });
          onOpenChange(false);
          await onSaved();
        } catch (caught) {
          setError(errorMessage(caught));
        } finally {
          setPending(false);
        }
      }}
    />
  );
}

export function JobApplicationDialog({
  open,
  onOpenChange,
  userIds,
  campaigns,
  opportunities,
  initialOpportunityId,
  onSaved
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userIds: string[];
  campaigns: OpportunityCampaign[];
  opportunities: JobOpportunity[];
  initialOpportunityId?: string;
  onSaved: () => Promise<void> | void;
}) {
  const [opportunityId, setOpportunityId] = useState(
    initialOpportunityId ?? opportunities[0]?.id ?? ""
  );
  const [campaignId, setCampaignId] = useState(
    campaigns.find((campaign) => campaign.status === "active")?.id ??
      campaigns[0]?.id ??
      ""
  );
  const [nextAction, setNextAction] = useState(
    "Prepare an exact application package and resolve missing user facts."
  );
  const [reapplicationReason, setReapplicationReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open && initialOpportunityId) setOpportunityId(initialOpportunityId);
  }, [initialOpportunityId, open]);
  const value = { opportunityId, campaignId, nextAction, reapplicationReason };
  const steps: Array<QuestionFlowStep<typeof value>> = [
    {
      id: "application",
      eyebrow: "Application workspace",
      title: "Which opportunity and campaign?",
      description:
        "One application has one primary campaign and retains duplicate-submission protection. It can still link to other goals and campaigns.",
      render: (current, setValue) => (
        <div className="grid gap-4">
          <NativeSelect
            label="Opportunity"
            value={current.opportunityId}
            onChange={(next) => setValue({ opportunityId: next })}
          >
            <option value="">Choose an opportunity</option>
            {opportunities.map((opportunity) => (
              <option key={opportunity.id} value={opportunity.id}>
                {opportunity.title} ·{" "}
                {opportunity.employerName || "Employer unknown"}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            label="Primary campaign"
            value={current.campaignId}
            onChange={(next) => setValue({ campaignId: next })}
          >
            <option value="">Choose a campaign</option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.title}
              </option>
            ))}
          </NativeSelect>
          <FlowField label="First next action">
            <Textarea
              rows={5}
              value={current.nextAction}
              onChange={(event) => setValue({ nextAction: event.target.value })}
            />
          </FlowField>
          <FlowField
            label="Reviewed reapplication reason"
            hint="Leave blank for a first application. Required when a terminal application already exists for the same role and account route."
          >
            <Textarea
              rows={4}
              value={current.reapplicationReason}
              onChange={(event) =>
                setValue({ reapplicationReason: event.target.value })
              }
            />
          </FlowField>
        </div>
      )
    }
  ];
  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Work · Applications"
      title="Start application"
      description="Create a truthful preparation workspace without claiming submission."
      value={value}
      onChange={(next) => {
        setOpportunityId(next.opportunityId);
        setCampaignId(next.campaignId);
        setNextAction(next.nextAction);
        setReapplicationReason(next.reapplicationReason);
      }}
      steps={steps}
      submitLabel="Create application workspace"
      pending={pending}
      error={error}
      resolveContinueBlocker={() =>
        !opportunityId || !campaignId
          ? "Choose both an opportunity and a primary campaign."
          : null
      }
      onSubmit={async () => {
        setPending(true);
        setError(null);
        try {
          await createJobApplication(userIds, {
            opportunityId,
            primaryCampaignId: campaignId,
            criteriaVersionId:
              campaigns.find((campaign) => campaign.id === campaignId)
                ?.currentCriteria?.id ?? null,
            applicationRoute: {},
            accountReference: "",
            status: "planned",
            nextAction,
            ownerLabel: "",
            blocker: "",
            priority: "normal",
            referralState: "none",
            privateContacts: [],
            positioningProfileId: null,
            documentSetId: null,
            representations: {},
            unresolvedUserFacts: [],
            scope: { projectIds: [], tagIds: [] },
            provenance,
            reapplicationReason
          });
          onOpenChange(false);
          await onSaved();
        } catch (caught) {
          setError(errorMessage(caught));
        } finally {
          setPending(false);
        }
      }}
    />
  );
}

import { useEffect, useMemo, useState } from "react";
import {
  FlowChoiceGrid,
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { readable } from "@/components/work/work-components";
import {
  createCriteriaVersion,
  createOpportunityCampaign,
  type OpportunityCampaign,
  type WorkEngagement,
  type WorkRecord
} from "@/lib/work-api";
import {
  errorMessage,
  lines,
  NativeSelect,
  workInterfaceProvenance as provenance
} from "@/components/work/work-dialog-helpers";
import {
  criteriaDocument,
  criteriaDraftFromDocument,
  emptyCriteria,
  type CriteriaDraft
} from "@/components/work/work-campaign-criteria-model";
import {
  AdvancedCriteriaFields,
  CriteriaFields
} from "@/components/work/work-campaign-criteria-fields";

type CampaignDraft = {
  title: string;
  sourceEngagementId: string;
  searchIntent: string;
  status: "active" | "planned" | "draft";
  purpose: string;
  description: string;
  activeFrom: string;
  searchDeadline: string;
  targetStartDate: string;
  longTermDestination: string;
  intermediateRoles: string;
  capabilities: string;
  nextAction: string;
  criteria: CriteriaDraft;
};

const emptyCampaign: CampaignDraft = {
  title: "",
  sourceEngagementId: "",
  searchIntent: "full_time_employment",
  status: "active",
  purpose: "",
  description: "",
  activeFrom: new Date().toISOString().slice(0, 10),
  searchDeadline: "",
  targetStartDate: "",
  longTermDestination: "",
  intermediateRoles: "",
  capabilities: "",
  nextAction: "Define role targets and review the first job sources.",
  criteria: emptyCriteria
};

function campaignCreatePayload(
  draft: CampaignDraft,
  timezone: string
): Record<string, unknown> {
  return {
    sourceEngagementId: draft.sourceEngagementId || null,
    title: draft.title,
    purpose: draft.purpose,
    description: draft.description,
    status: draft.status,
    priority: "normal",
    searchIntent: draft.searchIntent,
    activeFrom: draft.activeFrom || null,
    activeUntil: null,
    targetStartDate: draft.targetStartDate || null,
    searchDeadline: draft.searchDeadline || null,
    urgency: "normal",
    reviewCadence: "weekly",
    timezone,
    completionCriteria: [],
    longTermDestination: draft.longTermDestination,
    intermediateRoles: lines(draft.intermediateRoles),
    capabilitiesToAcquire: lines(draft.capabilities),
    steppingStoneAssessment: "unknown",
    currentStage: "defining",
    health: "unknown",
    nextAction: draft.nextAction,
    blockers: [],
    primaryGoalId: null,
    visibility: "private",
    scope: { projectIds: [], tagIds: [] },
    initialCriteria: criteriaDocument(draft.criteria),
    provenance
  };
}

export function OpportunityCampaignDialog({
  open,
  onOpenChange,
  userIds,
  engagements,
  onSaved
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userIds: string[];
  engagements: WorkEngagement[];
  onSaved: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState(emptyCampaign);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const steps = useMemo<Array<QuestionFlowStep<CampaignDraft>>>(
    () => [
      {
        id: "intent",
        eyebrow: "Job search",
        title: "What kind of work are you looking for?",
        description:
          "Use a separate job search when the goal or constraints are meaningfully different. For example, a research-career search and a part-time shift search can run at the same time.",
        render: (value, setValue) => (
          <div className="grid gap-4 md:grid-cols-2">
            <FlowField label="Job search name" className="md:col-span-2">
              <Input
                value={value.title}
                onChange={(event) => setValue({ title: event.target.value })}
                autoFocus
                placeholder="Worldwide ML research roles"
              />
            </FlowField>
            <NativeSelect
              label="Search intent"
              value={value.searchIntent}
              onChange={(searchIntent) => setValue({ searchIntent })}
            >
              {[
                "full_time_employment",
                "part_time_employment",
                "contract",
                "freelance",
                "fractional",
                "internship",
                "shift_work",
                "seasonal",
                "board_advisory",
                "other"
              ].map((option) => (
                <option key={option} value={option}>
                  {readable(option)}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              label="Related current role"
              value={value.sourceEngagementId}
              onChange={(sourceEngagementId) =>
                setValue({ sourceEngagementId })
              }
            >
              <option value="">Not tied to one current role</option>
              {engagements.map((engagement) => (
                <option key={engagement.id} value={engagement.id}>
                  {engagement.title}
                </option>
              ))}
            </NativeSelect>
            <FlowChoiceGrid
              value={value.status}
              onChange={(status) =>
                setValue({ status: status as CampaignDraft["status"] })
              }
              options={[
                {
                  value: "active",
                  label: "Active now",
                  description: "Start reviewing and recording roles."
                },
                {
                  value: "planned",
                  label: "Planned",
                  description: "Define it now and activate later."
                },
                {
                  value: "draft",
                  label: "Draft",
                  description: "Keep the intention incomplete for now."
                }
              ]}
              columns={3}
            />
          </div>
        )
      },
      {
        id: "direction",
        eyebrow: "Direction",
        title: "What should this search achieve?",
        description:
          "This keeps short-term applications linked to the longer-term destination and makes stepping-stone trade-offs explicit.",
        render: (value, setValue) => (
          <div className="grid gap-4 md:grid-cols-2">
            <FlowField label="Purpose" className="md:col-span-2">
              <Textarea
                rows={4}
                value={value.purpose}
                onChange={(event) => setValue({ purpose: event.target.value })}
              />
            </FlowField>
            <FlowField label="Desired long-term destination">
              <Textarea
                rows={5}
                value={value.longTermDestination}
                onChange={(event) =>
                  setValue({ longTermDestination: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Useful intermediate roles" hint="One per line">
              <Textarea
                rows={5}
                value={value.intermediateRoles}
                onChange={(event) =>
                  setValue({ intermediateRoles: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Capabilities to acquire" hint="One per line">
              <Textarea
                rows={5}
                value={value.capabilities}
                onChange={(event) =>
                  setValue({ capabilities: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Description">
              <Textarea
                rows={5}
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
        id: "dates",
        eyebrow: "Window",
        title: "When do you want to search and start?",
        description:
          "Dates and cadence make deadlines visible without pretending unknown availability is settled.",
        render: (value, setValue) => (
          <div className="grid gap-4 md:grid-cols-3">
            <FlowField label="Active from">
              <Input
                type="date"
                value={value.activeFrom}
                onChange={(event) =>
                  setValue({ activeFrom: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Search deadline">
              <Input
                type="date"
                value={value.searchDeadline}
                onChange={(event) =>
                  setValue({ searchDeadline: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Target start">
              <Input
                type="date"
                value={value.targetStartDate}
                onChange={(event) =>
                  setValue({ targetStartDate: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="First next action" className="md:col-span-3">
              <Input
                value={value.nextAction}
                onChange={(event) =>
                  setValue({ nextAction: event.target.value })
                }
              />
            </FlowField>
          </div>
        )
      },
      {
        id: "criteria",
        eyebrow: "Version 1 criteria",
        title: "What are the core role constraints?",
        description:
          "Forge keeps the criteria used for each earlier role, so later changes do not alter past evaluations.",
        render: (value, setValue) => (
          <CriteriaFields
            value={value.criteria}
            setValue={(criteriaPatch) =>
              setValue({ criteria: { ...value.criteria, ...criteriaPatch } })
            }
          />
        )
      },
      {
        id: "advanced-criteria",
        eyebrow: "Version 1 criteria · Advanced",
        title: "What else must the search understand?",
        description:
          "Add responsibility balance, schedule, geography, authorization, availability, benefits, organization, growth, and evidence rules when they materially affect decisions.",
        render: (value, setValue) => (
          <AdvancedCriteriaFields
            value={value.criteria}
            setValue={(criteriaPatch) =>
              setValue({ criteria: { ...value.criteria, ...criteriaPatch } })
            }
          />
        )
      }
    ],
    [engagements]
  );
  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Work · Job searches"
      title="Create job search"
      description="Create a focused search for one work goal."
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel="Create job search"
      pending={pending}
      pendingLabel="Creating job search…"
      error={error}
      resolveContinueBlocker={(step) =>
        step === "intent" && !draft.title.trim()
          ? "Name this search intention."
          : null
      }
      draftPersistenceKey="opportunity-campaign-new"
      onSubmit={async () => {
        setPending(true);
        setError(null);
        try {
          await createOpportunityCampaign(
            userIds,
            campaignCreatePayload(draft, timezone)
          );
          setDraft(emptyCampaign);
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

export function CampaignCriteriaDialog({
  open,
  onOpenChange,
  userIds,
  campaign,
  onSaved
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userIds: string[];
  campaign: OpportunityCampaign;
  onSaved: () => Promise<void> | void;
}) {
  const currentVersion = ((campaign.criteriaVersions as
    | WorkRecord[]
    | undefined) ?? [])[0];
  const currentDocument = useMemo(
    () =>
      currentVersion?.criteria && typeof currentVersion.criteria === "object"
        ? (currentVersion.criteria as WorkRecord)
        : undefined,
    [currentVersion?.criteria]
  );
  const [draft, setDraft] = useState(() =>
    criteriaDraftFromDocument(currentDocument)
  );
  const [rationale, setRationale] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setDraft(criteriaDraftFromDocument(currentDocument));
      setRationale("");
      setError(null);
    }
  }, [currentDocument, open]);
  const value = { criteria: draft, rationale };
  const steps: Array<QuestionFlowStep<typeof value>> = [
    {
      id: "criteria",
      eyebrow: `Job search · ${campaign.title}`,
      title: "Create a new criteria version",
      description:
        "The current version remains in history and existing evaluations continue to cite it.",
      render: (current, setValue) => (
        <CriteriaFields
          value={current.criteria}
          setValue={(patch) =>
            setValue({ criteria: { ...current.criteria, ...patch } })
          }
        />
      )
    },
    {
      id: "advanced-criteria",
      eyebrow: `Job search · ${campaign.title}`,
      title: "Review advanced constraints and evidence rules",
      description:
        "Unchanged criteria that do not have a dedicated control are carried forward exactly; clearing a managed field intentionally removes it from the new version.",
      render: (current, setValue) => (
        <AdvancedCriteriaFields
          value={current.criteria}
          setValue={(patch) =>
            setValue({ criteria: { ...current.criteria, ...patch } })
          }
        />
      )
    },
    {
      id: "rationale",
      eyebrow: "Version rationale",
      title: "Why did the criteria change?",
      description:
        "A short factual reason makes future re-evaluation understandable.",
      render: (current, setValue) => (
        <FlowField label="Reason for this version">
          <Textarea
            rows={8}
            value={current.rationale}
            onChange={(event) => setValue({ rationale: event.target.value })}
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
      eyebrow="Work · Criteria"
      title="New criteria version"
      description="Save updated criteria without changing earlier evaluations."
      value={value}
      onChange={(next) => {
        setDraft(next.criteria);
        setRationale(next.rationale);
      }}
      steps={steps}
      submitLabel="Save criteria version"
      pending={pending}
      error={error}
      resolveContinueBlocker={(step) =>
        step === "criteria" &&
        criteriaDocument(draft, currentDocument).criteria.length === 0
          ? "Add at least one structured criterion before continuing."
          : null
      }
      onSubmit={async () => {
        setPending(true);
        setError(null);
        try {
          await createCriteriaVersion(userIds, campaign.id, {
            criteria: criteriaDocument(draft, currentDocument),
            rationale,
            provenance
          });
          setDraft(emptyCriteria);
          setRationale("");
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

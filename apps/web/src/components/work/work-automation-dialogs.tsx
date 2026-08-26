import { useEffect, useMemo, useState } from "react";
import {
  FlowField,
  QuestionFlowDialog
} from "@/components/flows/question-flow-dialog";
import type { QuestionFlowStep } from "@/components/flows/question-flow-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { readable } from "@/components/work/work-components";
import {
  createWorkSupportingRecord,
  updateWorkSupportingRecord
} from "@/lib/work-api";
import type { OpportunityCampaign, WorkRecord } from "@/lib/work-api";
import {
  provenance,
  lines,
  keyValue,
  message,
  recordValue,
  Select,
  Check
} from "./work-operational-dialog-shared";
export type AutomationDialogKind =
  | "searchSource"
  | "savedQuery"
  | "automationPolicy";

type AutomationDraft = {
  name: string;
  sourceType: string;
  canonicalUrl: string;
  reliability: string;
  costBillingModel: string;
  costMaximumPerRun: string;
  costCurrency: string;
  costNotes: string;
  rateMaximumRequests: string;
  rateWindowMinutes: string;
  rateNotes: string;
  enabled: boolean;
  sourceId: string;
  criteriaVersionId: string;
  title: string;
  queryText: string;
  geography: string;
  filters: string;
  cadence: string;
  freshnessHours: string;
  researchAuthority: string;
  preparationAuthority: string;
  uploadAuthority: string;
  submissionAuthority: string;
  reviewRequiredClasses: string;
  automaticEligibilityEnabled: boolean;
  minimumScore: string;
  minimumConfidencePercent: string;
  requireHardGatePass: boolean;
  requireNoUnresolvedFacts: boolean;
  allowedRoleClasses: string;
  excludedEmployerClasses: string;
  compensationGates: string;
  legalAnswerGates: string;
  defaultProfileId: string;
  defaultDocumentSetId: string;
  maximumApplications: string;
  duplicatePrevention: boolean;
};

function formatCompensationGates(value: unknown) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => {
      const gate = recordValue(entry);
      return [
        gate.kind,
        gate.operator,
        gate.amount,
        gate.currency,
        gate.period,
        gate.notes
      ]
        .map((part) => String(part ?? ""))
        .join(" | ");
    })
    .join("\n");
}

function parseCompensationGates(value: string) {
  return lines(value).map((entry, index) => {
    const [kind, operator, amount = "", currency = "", period = "", ...notes] =
      entry.split("|").map((part) => part.trim());
    if (!kind || !operator) {
      throw new Error(
        `Compensation gate ${index + 1} needs at least a kind and operator.`
      );
    }
    return {
      kind,
      operator,
      amount: amount ? Number(amount) : null,
      currency: currency ? currency.toUpperCase() : null,
      period: period || null,
      notes: notes.join(" | ")
    };
  });
}

function formatLegalAnswerGates(value: unknown) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => {
      const gate = recordValue(entry);
      return [gate.category, gate.requirement, gate.notes]
        .map((part) => String(part ?? ""))
        .join(" | ");
    })
    .join("\n");
}

function parseLegalAnswerGates(value: string) {
  return lines(value).map((entry, index) => {
    const [category, requirement, ...notes] = entry
      .split("|")
      .map((part) => part.trim());
    if (!category || !requirement) {
      throw new Error(
        `Legal-answer gate ${index + 1} needs a category and requirement.`
      );
    }
    return { category, requirement, notes: notes.join(" | ") };
  });
}

function automationDraft(
  kind: AutomationDialogKind,
  value?: WorkRecord,
  criteriaVersionId = ""
): AutomationDraft {
  const cost = recordValue(value?.costConstraints);
  const rate = recordValue(value?.rateConstraints);
  const eligibility = recordValue(value?.automaticEligibility);
  return {
    name: String(value?.name ?? ""),
    sourceType: String(value?.sourceType ?? "website"),
    canonicalUrl: String(value?.canonicalUrl ?? ""),
    reliability: value?.reliability == null ? "" : String(value.reliability),
    costBillingModel: String(cost.billingModel ?? "unknown"),
    costMaximumPerRun:
      cost.maximumPerRun == null ? "" : String(cost.maximumPerRun),
    costCurrency: String(cost.currency ?? ""),
    costNotes: String(cost.notes ?? ""),
    rateMaximumRequests:
      rate.maximumRequests == null ? "" : String(rate.maximumRequests),
    rateWindowMinutes:
      rate.windowSeconds == null ? "" : String(Number(rate.windowSeconds) / 60),
    rateNotes: String(rate.notes ?? ""),
    enabled: value?.enabled !== false,
    sourceId: String(value?.sourceId ?? ""),
    criteriaVersionId: String(value?.criteriaVersionId ?? criteriaVersionId),
    title: String(value?.title ?? ""),
    queryText: String(value?.queryText ?? ""),
    geography: String(recordValue(value?.geography).label ?? ""),
    filters: Object.entries(recordValue(value?.filters))
      .map(([key, entry]) => `${key}=${String(entry)}`)
      .join("\n"),
    cadence: String(value?.cadence ?? "weekly"),
    freshnessHours: String(value?.freshnessHours ?? "168"),
    researchAuthority: String(value?.researchAuthority ?? "allowed"),
    preparationAuthority: String(
      value?.preparationAuthority ?? "review_required"
    ),
    uploadAuthority: String(value?.uploadAuthority ?? "review_required"),
    submissionAuthority: String(
      value?.submissionAuthority ?? "review_required"
    ),
    reviewRequiredClasses: Array.isArray(value?.reviewRequiredClasses)
      ? value.reviewRequiredClasses.map(String).join("\n")
      : "",
    automaticEligibilityEnabled: eligibility.enabled === true,
    minimumScore:
      eligibility.minimumScore == null ? "" : String(eligibility.minimumScore),
    minimumConfidencePercent:
      eligibility.minimumConfidence == null
        ? ""
        : String(Number(eligibility.minimumConfidence) * 100),
    requireHardGatePass: eligibility.requireHardGatePass !== false,
    requireNoUnresolvedFacts: eligibility.requireNoUnresolvedFacts !== false,
    allowedRoleClasses: Array.isArray(eligibility.allowedRoleClasses)
      ? eligibility.allowedRoleClasses.map(String).join("\n")
      : "",
    excludedEmployerClasses: Array.isArray(eligibility.excludedEmployerClasses)
      ? eligibility.excludedEmployerClasses.map(String).join("\n")
      : "",
    compensationGates: formatCompensationGates(value?.compensationGates),
    legalAnswerGates: formatLegalAnswerGates(value?.legalAnswerGates),
    defaultProfileId: String(value?.defaultProfileId ?? ""),
    defaultDocumentSetId: String(value?.defaultDocumentSetId ?? ""),
    maximumApplications:
      value?.maximumApplications == null
        ? ""
        : String(value.maximumApplications),
    duplicatePrevention: value?.duplicatePrevention !== false
  };
}

export function SearchAutomationDialog({
  open,
  onOpenChange,
  kind,
  userIds,
  campaign,
  record,
  sources,
  profiles,
  documentSets,
  onSaved
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: AutomationDialogKind;
  userIds: string[];
  campaign: OpportunityCampaign;
  record?: WorkRecord;
  sources: WorkRecord[];
  profiles: WorkRecord[];
  documentSets: WorkRecord[];
  onSaved: () => Promise<void> | void;
}) {
  const criteriaVersionId = String(
    campaign.currentCriteria?.id ?? campaign.currentCriteriaVersionId ?? ""
  );
  const [draft, setDraft] = useState(() =>
    automationDraft(kind, record, criteriaVersionId)
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) setDraft(automationDraft(kind, record, criteriaVersionId));
  }, [criteriaVersionId, kind, open, record]);
  const label =
    kind === "searchSource"
      ? "search source"
      : kind === "savedQuery"
        ? "saved query"
        : "agent permissions";
  const steps = useMemo<Array<QuestionFlowStep<AutomationDraft>>>(
    () => [
      {
        id: "details",
        eyebrow: "Job search settings",
        title: `${record ? "Update" : "Add"} ${label}`,
        description:
          "Choose what an agent may do for this job search. Sending an application always requires your review.",
        render: (value, setValue) => {
          if (kind === "searchSource") {
            return (
              <div className="grid gap-4 md:grid-cols-2">
                <FlowField label="Source name">
                  <Input
                    value={value.name}
                    onChange={(event) => setValue({ name: event.target.value })}
                    autoFocus
                  />
                </FlowField>
                <Select
                  label="Source type"
                  value={value.sourceType}
                  onChange={(sourceType) => setValue({ sourceType })}
                >
                  {[
                    "website",
                    "job_board",
                    "ats",
                    "organization_careers",
                    "agency",
                    "network",
                    "feed",
                    "manual",
                    "other"
                  ].map((option) => (
                    <option key={option} value={option}>
                      {readable(option)}
                    </option>
                  ))}
                </Select>
                <FlowField label="Source URL" className="md:col-span-2">
                  <Input
                    type="url"
                    value={value.canonicalUrl}
                    onChange={(event) =>
                      setValue({ canonicalUrl: event.target.value })
                    }
                  />
                </FlowField>
                <FlowField label="Reliability (0 to 1)">
                  <Input
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    value={value.reliability}
                    onChange={(event) =>
                      setValue({ reliability: event.target.value })
                    }
                  />
                </FlowField>
                <Select
                  label="Billing model"
                  value={value.costBillingModel}
                  onChange={(costBillingModel) =>
                    setValue({ costBillingModel })
                  }
                >
                  {[
                    "unknown",
                    "free",
                    "subscription",
                    "per_request",
                    "per_result",
                    "other"
                  ].map((option) => (
                    <option key={option} value={option}>
                      {readable(option)}
                    </option>
                  ))}
                </Select>
                <FlowField label="Maximum cost per run">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={value.costMaximumPerRun}
                    onChange={(event) =>
                      setValue({ costMaximumPerRun: event.target.value })
                    }
                  />
                </FlowField>
                <FlowField label="Cost currency">
                  <Input
                    maxLength={3}
                    value={value.costCurrency}
                    onChange={(event) =>
                      setValue({
                        costCurrency: event.target.value.toUpperCase()
                      })
                    }
                    placeholder="CHF"
                  />
                </FlowField>
                <FlowField label="Maximum requests">
                  <Input
                    type="number"
                    min="1"
                    value={value.rateMaximumRequests}
                    onChange={(event) =>
                      setValue({ rateMaximumRequests: event.target.value })
                    }
                  />
                </FlowField>
                <FlowField label="Rate window in minutes">
                  <Input
                    type="number"
                    min="0.0167"
                    step="0.1"
                    value={value.rateWindowMinutes}
                    onChange={(event) =>
                      setValue({ rateWindowMinutes: event.target.value })
                    }
                  />
                </FlowField>
                <FlowField label="Cost notes">
                  <Textarea
                    rows={3}
                    value={value.costNotes}
                    onChange={(event) =>
                      setValue({ costNotes: event.target.value })
                    }
                  />
                </FlowField>
                <FlowField label="Rate-limit notes">
                  <Textarea
                    rows={3}
                    value={value.rateNotes}
                    onChange={(event) =>
                      setValue({ rateNotes: event.target.value })
                    }
                  />
                </FlowField>
                <Check
                  checked={value.enabled}
                  onChange={(enabled) => setValue({ enabled })}
                >
                  This source is enabled.
                </Check>
              </div>
            );
          }
          if (kind === "savedQuery") {
            return (
              <div className="grid gap-4 md:grid-cols-2">
                <FlowField label="Query title">
                  <Input
                    value={value.title}
                    onChange={(event) =>
                      setValue({ title: event.target.value })
                    }
                    autoFocus
                  />
                </FlowField>
                <Select
                  label="Source"
                  value={value.sourceId}
                  onChange={(sourceId) => setValue({ sourceId })}
                >
                  <option value="">Any source in this job search</option>
                  {sources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {String(source.name ?? source.id)}
                    </option>
                  ))}
                </Select>
                <FlowField label="Exact query" className="md:col-span-2">
                  <Textarea
                    rows={5}
                    value={value.queryText}
                    onChange={(event) =>
                      setValue({ queryText: event.target.value })
                    }
                  />
                </FlowField>
                <FlowField label="Geography">
                  <Input
                    value={value.geography}
                    onChange={(event) =>
                      setValue({ geography: event.target.value })
                    }
                  />
                </FlowField>
                <FlowField label="Cadence">
                  <Input
                    value={value.cadence}
                    onChange={(event) =>
                      setValue({ cadence: event.target.value })
                    }
                  />
                </FlowField>
                <FlowField label="Freshness hours">
                  <Input
                    type="number"
                    min="1"
                    max="8760"
                    value={value.freshnessHours}
                    onChange={(event) =>
                      setValue({ freshnessHours: event.target.value })
                    }
                  />
                </FlowField>
                <Check
                  checked={value.enabled}
                  onChange={(enabled) => setValue({ enabled })}
                >
                  This query is enabled.
                </Check>
                <FlowField
                  label="Filters"
                  hint="key=value, one per line"
                  className="md:col-span-2"
                >
                  <Textarea
                    rows={4}
                    value={value.filters}
                    onChange={(event) =>
                      setValue({ filters: event.target.value })
                    }
                  />
                </FlowField>
              </div>
            );
          }
          return (
            <div className="grid gap-4 md:grid-cols-2">
              <Select
                label="Finding roles"
                value={value.researchAuthority}
                onChange={(researchAuthority) =>
                  setValue({ researchAuthority })
                }
              >
                <option value="disabled">Not allowed</option>
                <option value="allowed">Allowed</option>
                <option value="review_required">Ask first</option>
              </Select>
              <Select
                label="Preparing materials"
                value={value.preparationAuthority}
                onChange={(preparationAuthority) =>
                  setValue({ preparationAuthority })
                }
              >
                <option value="disabled">Not allowed</option>
                <option value="allowed">Allowed</option>
                <option value="review_required">Ask first</option>
              </Select>
              <Select
                label="Uploading files"
                value={value.uploadAuthority}
                onChange={(uploadAuthority) => setValue({ uploadAuthority })}
              >
                <option value="disabled">Not allowed</option>
                <option value="allowed">Allowed</option>
                <option value="review_required">Ask first</option>
              </Select>
              <Select
                label="Sending applications"
                value={value.submissionAuthority}
                onChange={(submissionAuthority) =>
                  setValue({ submissionAuthority })
                }
              >
                <option value="disabled">Not allowed</option>
                <option value="review_required">Always ask first</option>
              </Select>
              <Select
                label="Default positioning profile"
                value={value.defaultProfileId}
                onChange={(defaultProfileId) => setValue({ defaultProfileId })}
              >
                <option value="">No default</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {String(profile.title ?? profile.id)}
                  </option>
                ))}
              </Select>
              <Select
                label="Default document set"
                value={value.defaultDocumentSetId}
                onChange={(defaultDocumentSetId) =>
                  setValue({ defaultDocumentSetId })
                }
              >
                <option value="">No default</option>
                {documentSets.map((set) => (
                  <option key={set.id} value={set.id}>
                    {String(set.title ?? set.id)}
                  </option>
                ))}
              </Select>
              <FlowField label="Maximum applications">
                <Input
                  type="number"
                  min="1"
                  value={value.maximumApplications}
                  onChange={(event) =>
                    setValue({ maximumApplications: event.target.value })
                  }
                />
              </FlowField>
              <Check
                checked={value.duplicatePrevention}
                onChange={(duplicatePrevention) =>
                  setValue({ duplicatePrevention })
                }
              >
                Prevent duplicate applications.
              </Check>
              <FlowField
                label="Classes that require review"
                hint="One per line"
                className="md:col-span-2"
              >
                <Textarea
                  rows={4}
                  value={value.reviewRequiredClasses}
                  onChange={(event) =>
                    setValue({ reviewRequiredClasses: event.target.value })
                  }
                />
              </FlowField>
              <Check
                checked={value.automaticEligibilityEnabled}
                onChange={(automaticEligibilityEnabled) =>
                  setValue({ automaticEligibilityEnabled })
                }
              >
                Enable automatic eligibility checks. This never authorizes
                submission.
              </Check>
              <FlowField label="Minimum fit score (0 to 100)">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={value.minimumScore}
                  onChange={(event) =>
                    setValue({ minimumScore: event.target.value })
                  }
                />
              </FlowField>
              <FlowField label="Minimum evidence confidence (0 to 100%)">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={value.minimumConfidencePercent}
                  onChange={(event) =>
                    setValue({ minimumConfidencePercent: event.target.value })
                  }
                />
              </FlowField>
              <Check
                checked={value.requireHardGatePass}
                onChange={(requireHardGatePass) =>
                  setValue({ requireHardGatePass })
                }
              >
                Require every hard constraint to pass.
              </Check>
              <Check
                checked={value.requireNoUnresolvedFacts}
                onChange={(requireNoUnresolvedFacts) =>
                  setValue({ requireNoUnresolvedFacts })
                }
              >
                Require all user-only facts to be resolved.
              </Check>
              <FlowField
                label="Automatically eligible role classes"
                hint="One class per line"
              >
                <Textarea
                  rows={4}
                  value={value.allowedRoleClasses}
                  onChange={(event) =>
                    setValue({ allowedRoleClasses: event.target.value })
                  }
                />
              </FlowField>
              <FlowField
                label="Excluded employer classes"
                hint="One class per line"
              >
                <Textarea
                  rows={4}
                  value={value.excludedEmployerClasses}
                  onChange={(event) =>
                    setValue({ excludedEmployerClasses: event.target.value })
                  }
                />
              </FlowField>
              <FlowField
                label="Compensation gates"
                hint="kind | operator | amount | currency | period | notes"
                className="md:col-span-2"
              >
                <Textarea
                  rows={5}
                  value={value.compensationGates}
                  onChange={(event) =>
                    setValue({ compensationGates: event.target.value })
                  }
                  placeholder="minimum_base | greater_than_or_equal | 120000 | CHF | year | Confirm gross basis"
                />
              </FlowField>
              <FlowField
                label="Legal-answer gates"
                hint="category | requirement | notes"
                className="md:col-span-2"
              >
                <Textarea
                  rows={5}
                  value={value.legalAnswerGates}
                  onChange={(event) =>
                    setValue({ legalAnswerGates: event.target.value })
                  }
                  placeholder="work_authorization | user_confirmation_required | Never infer sponsorship status"
                />
              </FlowField>
            </div>
          );
        }
      }
    ],
    [documentSets, kind, label, profiles, record, sources]
  );
  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Work · Job searches"
      title={`${record ? "Edit" : "Add"} ${label}`}
      description="Set sources, saved searches, or agent permissions for this job search."
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel={record ? "Save changes" : `Add ${label}`}
      pending={pending}
      error={error}
      draftPersistenceKey={`work-${kind}-${record?.id ?? campaign.id}`}
      onSubmit={async () => {
        setPending(true);
        setError(null);
        try {
          let data: Record<string, unknown>;
          if (kind === "searchSource") {
            data = {
              name: draft.name,
              sourceType: draft.sourceType,
              canonicalUrl: draft.canonicalUrl,
              reliability: draft.reliability ? Number(draft.reliability) : null,
              costConstraints: {
                billingModel: draft.costBillingModel,
                maximumPerRun: draft.costMaximumPerRun
                  ? Number(draft.costMaximumPerRun)
                  : null,
                currency: draft.costCurrency || null,
                notes: draft.costNotes
              },
              rateConstraints: {
                maximumRequests: draft.rateMaximumRequests
                  ? Number(draft.rateMaximumRequests)
                  : null,
                windowSeconds: draft.rateWindowMinutes
                  ? Math.round(Number(draft.rateWindowMinutes) * 60)
                  : null,
                notes: draft.rateNotes
              },
              enabled: draft.enabled,
              provenance
            };
          } else if (kind === "savedQuery") {
            data = {
              sourceId: draft.sourceId || null,
              criteriaVersionId: draft.criteriaVersionId,
              title: draft.title,
              queryText: draft.queryText,
              geography: draft.geography ? { label: draft.geography } : {},
              filters: keyValue(draft.filters),
              cadence: draft.cadence,
              freshnessHours: Number(draft.freshnessHours),
              enabled: draft.enabled
            };
          } else {
            data = {
              criteriaVersionId: draft.criteriaVersionId,
              researchAuthority: draft.researchAuthority,
              preparationAuthority: draft.preparationAuthority,
              uploadAuthority: draft.uploadAuthority,
              submissionAuthority: draft.submissionAuthority,
              reviewRequiredClasses: lines(draft.reviewRequiredClasses),
              automaticEligibility: {
                enabled: draft.automaticEligibilityEnabled,
                minimumScore: draft.minimumScore
                  ? Number(draft.minimumScore)
                  : null,
                minimumConfidence: draft.minimumConfidencePercent
                  ? Number(draft.minimumConfidencePercent) / 100
                  : null,
                requireHardGatePass: draft.requireHardGatePass,
                requireNoUnresolvedFacts: draft.requireNoUnresolvedFacts,
                allowedRoleClasses: lines(draft.allowedRoleClasses),
                excludedEmployerClasses: lines(draft.excludedEmployerClasses)
              },
              defaultProfileId: draft.defaultProfileId || null,
              defaultDocumentSetId: draft.defaultDocumentSetId || null,
              compensationGates: parseCompensationGates(
                draft.compensationGates
              ),
              legalAnswerGates: parseLegalAnswerGates(draft.legalAnswerGates),
              maximumApplications: draft.maximumApplications
                ? Number(draft.maximumApplications)
                : null,
              duplicatePrevention: draft.duplicatePrevention
            };
          }
          if (record) {
            await updateWorkSupportingRecord(userIds, kind, record.id, {
              expectedRevision: Number(record.revision),
              data
            });
          } else {
            await createWorkSupportingRecord(
              userIds,
              kind,
              { data },
              campaign.id
            );
          }
          onOpenChange(false);
          await onSaved();
        } catch (caught) {
          setError(message(caught));
        } finally {
          setPending(false);
        }
      }}
    />
  );
}

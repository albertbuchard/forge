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
  EntityLinkMultiSelect,
  type EntityLinkOption
} from "@/components/psyche/entity-link-multiselect";
import { searchLocalRecords } from "@/lib/api";
import {
  createWorkSupportingRecord,
  updateWorkSupportingRecord
} from "@/lib/work-api";
import type { WorkRecord } from "@/lib/work-api";
import {
  provenance,
  lines,
  localDateTime,
  isoOrNull,
  message,
  recordValue,
  Select,
  Check
} from "./work-operational-dialog-shared";

type InterviewDraft = {
  stage: string;
  start: string;
  end: string;
  timezone: string;
  format: string;
  privateLocationOrLink: string;
  participants: string;
  focusAreas: string;
  preparationArtifactId: string;
  questionBank: string;
  notes: string;
  outcome: string;
  followUp: string;
  nextAction: string;
};

function interviewDraft(value?: WorkRecord): InterviewDraft {
  return {
    stage: String(value?.stage ?? "interview"),
    start: localDateTime(value?.scheduledStartAt),
    end: localDateTime(value?.scheduledEndAt),
    timezone: String(
      value?.timezone ??
        Intl.DateTimeFormat().resolvedOptions().timeZone ??
        "UTC"
    ),
    format: String(value?.format ?? "video"),
    privateLocationOrLink: String(value?.privateLocationOrLink ?? ""),
    participants: Array.isArray(value?.participantLinks)
      ? value.participantLinks
          .map((entry) => {
            const participant = entry as Record<string, unknown>;
            return [participant.personId, participant.role, participant.label]
              .map((part) => String(part ?? "").trim())
              .join(" | ");
          })
          .join("\n")
      : "",
    focusAreas: Array.isArray(value?.focusAreas)
      ? value.focusAreas.map(String).join("\n")
      : "",
    preparationArtifactId: String(value?.preparationArtifactId ?? ""),
    questionBank: Array.isArray(value?.questionBank)
      ? value.questionBank
          .map((entry) =>
            String(
              (entry as Record<string, unknown>).question ??
                (entry as Record<string, unknown>).prompt ??
                ""
            )
          )
          .filter(Boolean)
          .join("\n")
      : "",
    notes: String(value?.notes ?? ""),
    outcome: String(value?.outcome ?? ""),
    followUp: String(value?.followUp ?? ""),
    nextAction: String(value?.nextAction ?? "")
  };
}

export function InterviewDialog({
  open,
  onOpenChange,
  userIds,
  applicationId,
  interview,
  onSaved
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userIds: string[];
  applicationId: string;
  interview?: WorkRecord;
  onSaved: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState(() => interviewDraft(interview));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) setDraft(interviewDraft(interview));
  }, [interview, open]);
  const searchPeople = async (query: string): Promise<EntityLinkOption[]> => {
    const response = await searchLocalRecords({
      query,
      entityTypes: ["person"],
      userIds,
      limit: 20
    });
    return response.results.map((person) => ({
      value: `person:${person.entityId}`,
      label: person.title,
      description: person.detail || "Person"
    }));
  };
  const steps = useMemo<Array<QuestionFlowStep<InterviewDraft>>>(
    () => [
      {
        id: "details",
        eyebrow: "Application interview",
        title: interview ? "Update the interview" : "Record an interview",
        description:
          "Keep the schedule, preparation, factual outcome, and next action together. Private links and notes remain protected.",
        render: (value, setValue) => (
          <div className="grid gap-4 md:grid-cols-2">
            <FlowField label="Stage">
              <Input
                value={value.stage}
                onChange={(event) => setValue({ stage: event.target.value })}
                autoFocus
              />
            </FlowField>
            <Select
              label="Format"
              value={value.format}
              onChange={(format) => setValue({ format })}
            >
              {[
                "video",
                "phone",
                "on_site",
                "assessment",
                "presentation",
                "informal",
                "unknown"
              ].map((option) => (
                <option key={option} value={option}>
                  {readable(option)}
                </option>
              ))}
            </Select>
            <FlowField label="Starts">
              <Input
                type="datetime-local"
                value={value.start}
                onChange={(event) => setValue({ start: event.target.value })}
              />
            </FlowField>
            <FlowField label="Ends">
              <Input
                type="datetime-local"
                value={value.end}
                onChange={(event) => setValue({ end: event.target.value })}
              />
            </FlowField>
            <FlowField label="Timezone">
              <Input
                value={value.timezone}
                onChange={(event) => setValue({ timezone: event.target.value })}
              />
            </FlowField>
            <FlowField label="Private location or call link">
              <Input
                value={value.privateLocationOrLink}
                onChange={(event) =>
                  setValue({ privateLocationOrLink: event.target.value })
                }
              />
            </FlowField>
            <div className="grid gap-1 text-xs text-[var(--ui-ink-soft)] md:col-span-2">
              Participants
              <EntityLinkMultiSelect
                options={lines(value.participants).map((entry) => {
                  const [personId = "", , label = ""] = entry
                    .split("|")
                    .map((part) => part.trim());
                  return {
                    value: `person:${personId}`,
                    label: label || "Selected person"
                  };
                })}
                selectedValues={lines(value.participants).map(
                  (entry) => `person:${entry.split("|")[0]?.trim() ?? ""}`
                )}
                onSearch={searchPeople}
                onChange={(selected) =>
                  setValue({
                    participants: selected
                      .map(
                        (entry) =>
                          `${entry.replace(/^person:/u, "")} | interviewer |`
                      )
                      .join("\n")
                  })
                }
                placeholder="Search people…"
                emptyMessage="No matching person found."
              />
            </div>
            <FlowField
              label="Focus areas"
              hint="One per line"
              className="md:col-span-2"
            >
              <Textarea
                rows={4}
                value={value.focusAreas}
                onChange={(event) =>
                  setValue({ focusAreas: event.target.value })
                }
              />
            </FlowField>
            <details className="rounded-[16px] border border-[var(--ui-border-subtle)] p-3">
              <summary className="cursor-pointer text-sm font-medium text-[var(--ui-ink-medium)]">
                Technical details
              </summary>
              <FlowField label="Preparation file ID">
                <Input
                  value={value.preparationArtifactId}
                  onChange={(event) =>
                    setValue({ preparationArtifactId: event.target.value })
                  }
                />
              </FlowField>
            </details>
            <FlowField label="Next action">
              <Input
                value={value.nextAction}
                onChange={(event) =>
                  setValue({ nextAction: event.target.value })
                }
              />
            </FlowField>
            <FlowField
              label="Question bank"
              hint="One factual preparation question per line"
              className="md:col-span-2"
            >
              <Textarea
                rows={5}
                value={value.questionBank}
                onChange={(event) =>
                  setValue({ questionBank: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Private notes" className="md:col-span-2">
              <Textarea
                rows={5}
                value={value.notes}
                onChange={(event) => setValue({ notes: event.target.value })}
              />
            </FlowField>
            <FlowField label="Factual outcome" className="md:col-span-2">
              <Textarea
                rows={3}
                value={value.outcome}
                onChange={(event) => setValue({ outcome: event.target.value })}
              />
            </FlowField>
            <FlowField label="Follow-up" className="md:col-span-2">
              <Textarea
                rows={3}
                value={value.followUp}
                onChange={(event) => setValue({ followUp: event.target.value })}
              />
            </FlowField>
          </div>
        )
      }
    ],
    [interview, userIds]
  );
  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Work · Application"
      title={interview ? "Edit interview" : "Add interview"}
      description="Keep interview plans, preparation, outcomes, and follow-up together."
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel={interview ? "Save interview" : "Add interview"}
      pending={pending}
      error={error}
      draftPersistenceKey={`work-interview-${interview?.id ?? applicationId}`}
      onSubmit={async () => {
        setPending(true);
        setError(null);
        const participantLinks = lines(draft.participants).map((line) => {
          const [personId = "", role = "", label = ""] = line
            .split("|")
            .map((part) => part.trim());
          return { personId, role, label };
        });
        const data = {
          stage: draft.stage,
          scheduledStartAt: isoOrNull(draft.start),
          scheduledEndAt: isoOrNull(draft.end),
          timezone: draft.timezone,
          format: draft.format,
          privateLocationOrLink: draft.privateLocationOrLink,
          participantLinks,
          focusAreas: lines(draft.focusAreas),
          preparationArtifactId: draft.preparationArtifactId || null,
          questionBank: lines(draft.questionBank).map((question) => ({
            question,
            status: "planned"
          })),
          notes: draft.notes,
          outcome: draft.outcome,
          followUp: draft.followUp,
          nextAction: draft.nextAction
        };
        try {
          if (interview)
            await updateWorkSupportingRecord(
              userIds,
              "interview",
              interview.id,
              { expectedRevision: Number(interview.revision), data }
            );
          else
            await createWorkSupportingRecord(
              userIds,
              "interview",
              { data },
              applicationId
            );
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

type OfferDraft = {
  status: string;
  title: string;
  level: string;
  location: string;
  workModel: string;
  employmentType: string;
  startDate: string;
  expectedEndDate: string;
  weeklyHours: string;
  noticeUnknown: boolean;
  noticeValue: string;
  noticeUnit: "days" | "weeks" | "months";
  compensationUnknown: boolean;
  baseAmount: string;
  totalAmount: string;
  hourlyRate: string;
  dailyRate: string;
  bonus: string;
  commission: string;
  equity: string;
  pension: string;
  benefits: string;
  currency: string;
  period: string;
  expiresAt: string;
  contingencies: string;
  negotiationAsks: string;
  response: string;
  artifactIds: string;
  decision: string;
  rationale: string;
  criteriaVersionId: string;
};

function offerBenefitLabel(value: Record<string, unknown>) {
  const explicit = String(value.label ?? value.description ?? "").trim();
  if (explicit) return explicit;
  const name = String(value.type ?? "benefit").replaceAll("_", " ");
  if (value.days != null) return `${name}: ${String(value.days)} days`;
  if (value.amount != null) {
    return `${name}: ${String(value.amount)} ${String(value.currency ?? "")} ${String(value.period ?? "")}`.trim();
  }
  return name;
}

function offerDraft(value?: WorkRecord, criteriaVersionId = ""): OfferDraft {
  const terms = recordValue(value?.terms);
  const compensation = recordValue(value?.privateCompensation);
  const base = recordValue(compensation.base);
  const total = recordValue(compensation.total);
  const hourlyRate = recordValue(compensation.hourlyRate);
  const dailyRate = recordValue(compensation.dailyRate);
  const notice = recordValue(terms.noticeInteraction);
  const duration = recordValue(terms.duration);
  const benefitLabels = Array.isArray(compensation.benefits)
    ? compensation.benefits
        .map((benefit) => offerBenefitLabel(recordValue(benefit)))
        .filter(Boolean)
        .join("\n")
    : "";
  const compensationKnown =
    [base, total, hourlyRate, dailyRate].some(
      (money) => money.amount != null
    ) ||
    ["bonus", "commission", "equity", "pension"].some((key) =>
      String(recordValue(compensation[key]).description ?? "").trim()
    ) ||
    Boolean(benefitLabels);
  return {
    status: String(value?.status ?? "received"),
    title: String(terms.title ?? ""),
    level: String(terms.level ?? ""),
    location: String(recordValue(terms.location).label ?? ""),
    workModel: String(terms.workModel ?? "unknown"),
    employmentType: String(terms.employmentType ?? "employment"),
    startDate: String(terms.startDate ?? ""),
    expectedEndDate: String(duration.endDate ?? ""),
    weeklyHours: String(recordValue(terms.weeklyHours).value ?? ""),
    noticeUnknown: notice.unknown !== false,
    noticeValue: notice.value == null ? "" : String(notice.value),
    noticeUnit: (["days", "weeks", "months"].includes(String(notice.unit))
      ? notice.unit
      : "months") as OfferDraft["noticeUnit"],
    compensationUnknown: !compensationKnown,
    baseAmount: base.amount == null ? "" : String(base.amount),
    totalAmount: total.amount == null ? "" : String(total.amount),
    hourlyRate: hourlyRate.amount == null ? "" : String(hourlyRate.amount),
    dailyRate: dailyRate.amount == null ? "" : String(dailyRate.amount),
    bonus: String(recordValue(compensation.bonus).description ?? ""),
    commission: String(recordValue(compensation.commission).description ?? ""),
    equity: String(recordValue(compensation.equity).description ?? ""),
    pension: String(recordValue(compensation.pension).description ?? ""),
    benefits: benefitLabels,
    currency: String(base.currency ?? "CHF"),
    period: String(base.period ?? "year"),
    expiresAt: localDateTime(value?.expiresAt),
    contingencies: Array.isArray(value?.contingencies)
      ? value.contingencies
          .map((entry) =>
            String(
              recordValue(entry).label ?? recordValue(entry).description ?? ""
            )
          )
          .filter(Boolean)
          .join("\n")
      : "",
    negotiationAsks: Array.isArray(value?.negotiationAsks)
      ? value.negotiationAsks
          .map((entry) =>
            String(
              recordValue(entry).label ?? recordValue(entry).description ?? ""
            )
          )
          .filter(Boolean)
          .join("\n")
      : "",
    response: String(value?.response ?? ""),
    artifactIds: Array.isArray(value?.artifactIds)
      ? value.artifactIds.map(String).join("\n")
      : "",
    decision: String(value?.decision ?? ""),
    rationale: String(value?.rationale ?? ""),
    criteriaVersionId: String(value?.criteriaVersionId ?? criteriaVersionId)
  };
}

export function OfferDialog({
  open,
  onOpenChange,
  userIds,
  applicationId,
  offer,
  criteriaVersionId,
  onSaved
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userIds: string[];
  applicationId: string;
  offer?: WorkRecord;
  criteriaVersionId?: string;
  onSaved: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState(() =>
    offerDraft(offer, criteriaVersionId)
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) setDraft(offerDraft(offer, criteriaVersionId));
  }, [criteriaVersionId, offer, open]);
  const steps = useMemo<Array<QuestionFlowStep<OfferDraft>>>(
    () => [
      {
        id: "terms",
        eyebrow: "Offer terms",
        title: "Record the exact offer",
        description:
          "Keep factual terms and private compensation distinct. Unknown remains a valid value.",
        render: (value, setValue) => (
          <div className="grid gap-4 md:grid-cols-2">
            <Select
              label="Status"
              value={value.status}
              onChange={(status) => setValue({ status })}
            >
              {[
                "expected",
                "received",
                "negotiating",
                "revised",
                "accepted",
                "declined",
                "expired",
                "withdrawn"
              ].map((option) => (
                <option key={option} disabled={option === "accepted"}>
                  {option === "accepted"
                    ? "accepted · use Accept offer action"
                    : option}
                </option>
              ))}
            </Select>
            <FlowField label="Offer title">
              <Input
                value={value.title}
                onChange={(event) => setValue({ title: event.target.value })}
                autoFocus
              />
            </FlowField>
            <FlowField label="Level">
              <Input
                value={value.level}
                onChange={(event) => setValue({ level: event.target.value })}
              />
            </FlowField>
            <FlowField label="Location">
              <Input
                value={value.location}
                onChange={(event) => setValue({ location: event.target.value })}
              />
            </FlowField>
            <Select
              label="Work model"
              value={value.workModel}
              onChange={(workModel) => setValue({ workModel })}
            >
              {["unknown", "remote", "hybrid", "on_site", "variable"].map(
                (option) => (
                  <option key={option} value={option}>
                    {readable(option)}
                  </option>
                )
              )}
            </Select>
            <FlowField label="Engagement type">
              <Input
                value={value.employmentType}
                onChange={(event) =>
                  setValue({ employmentType: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Start date">
              <Input
                type="date"
                value={value.startDate}
                onChange={(event) =>
                  setValue({ startDate: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Expected or fixed-term end date">
              <Input
                type="date"
                value={value.expectedEndDate}
                onChange={(event) =>
                  setValue({ expectedEndDate: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Weekly hours">
              <Input
                type="number"
                min="0"
                max="168"
                value={value.weeklyHours}
                onChange={(event) =>
                  setValue({ weeklyHours: event.target.value })
                }
              />
            </FlowField>
            <Check
              checked={value.noticeUnknown}
              onChange={(noticeUnknown) => setValue({ noticeUnknown })}
            >
              Notice interaction is unknown.
            </Check>
            {!value.noticeUnknown ? (
              <div className="grid gap-4 md:grid-cols-2">
                <FlowField label="Notice value">
                  <Input
                    type="number"
                    min="0"
                    value={value.noticeValue}
                    onChange={(event) =>
                      setValue({ noticeValue: event.target.value })
                    }
                  />
                </FlowField>
                <Select
                  label="Notice unit"
                  value={value.noticeUnit}
                  onChange={(noticeUnit) =>
                    setValue({
                      noticeUnit: noticeUnit as OfferDraft["noticeUnit"]
                    })
                  }
                >
                  {(["days", "weeks", "months"] as const).map((unit) => (
                    <option key={unit}>{unit}</option>
                  ))}
                </Select>
              </div>
            ) : null}
            <FlowField label="Expires">
              <Input
                type="datetime-local"
                value={value.expiresAt}
                onChange={(event) =>
                  setValue({ expiresAt: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Criteria version ID">
              <Input
                value={value.criteriaVersionId}
                onChange={(event) =>
                  setValue({ criteriaVersionId: event.target.value })
                }
              />
            </FlowField>
          </div>
        )
      },
      {
        id: "compensation",
        eyebrow: "Private compensation",
        title: "What compensation was actually offered?",
        description:
          "Only the separate Work compensation permission can read or change this information.",
        render: (value, setValue) => (
          <div className="grid gap-4">
            <Check
              checked={value.compensationUnknown}
              onChange={(compensationUnknown) =>
                setValue({ compensationUnknown })
              }
            >
              Compensation is unknown or I do not want to store it.
            </Check>
            {!value.compensationUnknown ? (
              <div className="grid gap-4 md:grid-cols-3">
                <FlowField label="Gross base amount">
                  <Input
                    type="number"
                    min="0"
                    value={value.baseAmount}
                    onChange={(event) =>
                      setValue({ baseAmount: event.target.value })
                    }
                  />
                </FlowField>
                <FlowField label="Gross total compensation per year">
                  <Input
                    type="number"
                    min="0"
                    value={value.totalAmount}
                    onChange={(event) =>
                      setValue({ totalAmount: event.target.value })
                    }
                  />
                </FlowField>
                <FlowField label="Hourly rate">
                  <Input
                    type="number"
                    min="0"
                    value={value.hourlyRate}
                    onChange={(event) =>
                      setValue({ hourlyRate: event.target.value })
                    }
                  />
                </FlowField>
                <FlowField label="Daily rate">
                  <Input
                    type="number"
                    min="0"
                    value={value.dailyRate}
                    onChange={(event) =>
                      setValue({ dailyRate: event.target.value })
                    }
                  />
                </FlowField>
                <FlowField label="Currency">
                  <Input
                    maxLength={3}
                    value={value.currency}
                    onChange={(event) =>
                      setValue({ currency: event.target.value.toUpperCase() })
                    }
                  />
                </FlowField>
                <Select
                  label="Period"
                  value={value.period}
                  onChange={(period) => setValue({ period })}
                >
                  {["hour", "day", "week", "month", "year", "one_time"].map(
                    (option) => (
                      <option key={option} value={option}>
                        {readable(option)}
                      </option>
                    )
                  )}
                </Select>
                <FlowField label="Bonus">
                  <Input
                    value={value.bonus}
                    onChange={(event) =>
                      setValue({ bonus: event.target.value })
                    }
                    placeholder="Target, formula, or conditions"
                  />
                </FlowField>
                <FlowField label="Commission">
                  <Input
                    value={value.commission}
                    onChange={(event) =>
                      setValue({ commission: event.target.value })
                    }
                  />
                </FlowField>
                <FlowField label="Equity">
                  <Input
                    value={value.equity}
                    onChange={(event) =>
                      setValue({ equity: event.target.value })
                    }
                  />
                </FlowField>
                <FlowField label="Pension">
                  <Input
                    value={value.pension}
                    onChange={(event) =>
                      setValue({ pension: event.target.value })
                    }
                  />
                </FlowField>
                <FlowField
                  label="Benefits and perks"
                  hint="One exact offered benefit per line"
                  className="md:col-span-3"
                >
                  <Textarea
                    rows={5}
                    value={value.benefits}
                    onChange={(event) =>
                      setValue({ benefits: event.target.value })
                    }
                  />
                </FlowField>
              </div>
            ) : null}
          </div>
        )
      },
      {
        id: "decision",
        eyebrow: "Review and negotiation",
        title: "What needs attention?",
        description:
          "Preserve contingencies, asks, documents, and the reason for any decision.",
        render: (value, setValue) => (
          <div className="grid gap-4 md:grid-cols-2">
            <FlowField label="Contingencies" hint="One per line">
              <Textarea
                rows={4}
                value={value.contingencies}
                onChange={(event) =>
                  setValue({ contingencies: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Negotiation asks" hint="One per line">
              <Textarea
                rows={4}
                value={value.negotiationAsks}
                onChange={(event) =>
                  setValue({ negotiationAsks: event.target.value })
                }
              />
            </FlowField>
            <details className="rounded-[16px] border border-[var(--ui-border-subtle)] p-3 md:col-span-2">
              <summary className="cursor-pointer text-sm font-medium text-[var(--ui-ink-medium)]">
                Technical details
              </summary>
              <FlowField label="Offer file IDs" hint="One per line">
                <Textarea
                  rows={3}
                  value={value.artifactIds}
                  onChange={(event) =>
                    setValue({ artifactIds: event.target.value })
                  }
                />
              </FlowField>
            </details>
            <FlowField label="Response" className="md:col-span-2">
              <Textarea
                rows={3}
                value={value.response}
                onChange={(event) => setValue({ response: event.target.value })}
              />
            </FlowField>
            <FlowField label="Decision">
              <Textarea
                rows={3}
                value={value.decision}
                onChange={(event) => setValue({ decision: event.target.value })}
              />
            </FlowField>
            <FlowField label="Rationale">
              <Textarea
                rows={3}
                value={value.rationale}
                onChange={(event) =>
                  setValue({ rationale: event.target.value })
                }
              />
            </FlowField>
          </div>
        )
      }
    ],
    []
  );
  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Work · Application"
      title={offer ? "Edit offer" : "Add offer"}
      description="Save the exact offer terms and private compensation."
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel={offer ? "Save offer" : "Add offer"}
      pending={pending}
      error={error}
      draftPersistenceKey={`work-offer-${offer?.id ?? applicationId}`}
      resolveContinueBlocker={(step) =>
        step === "terms" && !draft.title.trim()
          ? "Enter the offer title."
          : null
      }
      onSubmit={async () => {
        setPending(true);
        setError(null);
        const amount = draft.baseAmount.trim()
          ? Number(draft.baseAmount)
          : null;
        const amountOrNull = (value: string) =>
          value.trim() ? Number(value) : null;
        const existingTerms = recordValue(offer?.terms);
        const existingCompensation = recordValue(offer?.privateCompensation);
        const existingBenefits = Array.isArray(existingCompensation.benefits)
          ? existingCompensation.benefits.map(recordValue)
          : [];
        const money = (
          key: "base" | "total" | "hourlyRate" | "dailyRate",
          value: string,
          period: string
        ) => {
          const parsedAmount = amountOrNull(value);
          if (parsedAmount === null) return null;
          return {
            ...recordValue(existingCompensation[key]),
            amount: parsedAmount,
            currency: draft.currency,
            basis: "gross",
            period,
            negotiable:
              recordValue(existingCompensation[key]).negotiable ?? null,
            unknown: false
          };
        };
        const component = (
          key: "bonus" | "commission" | "equity" | "pension",
          description: string
        ) => ({
          ...recordValue(existingCompensation[key]),
          description,
          unknown: false
        });
        const data = {
          status: draft.status,
          terms: {
            title: draft.title,
            level: draft.level,
            location: {
              ...recordValue(existingTerms.location),
              label: draft.location
            },
            workModel: draft.workModel,
            employmentType: draft.employmentType || "unknown",
            startDate: draft.startDate || null,
            weeklyHours: draft.weeklyHours
              ? {
                  ...recordValue(existingTerms.weeklyHours),
                  value: Number(draft.weeklyHours)
                }
              : { ...recordValue(existingTerms.weeklyHours), value: null },
            duration: {
              ...recordValue(existingTerms.duration),
              endDate: draft.expectedEndDate || null
            },
            noticeInteraction: {
              ...recordValue(existingTerms.noticeInteraction),
              value: draft.noticeUnknown
                ? null
                : amountOrNull(draft.noticeValue),
              unit: draft.noticeUnknown ? null : draft.noticeUnit,
              negotiable:
                recordValue(existingTerms.noticeInteraction).negotiable ?? null,
              conditions: String(
                recordValue(existingTerms.noticeInteraction).conditions ?? ""
              ),
              unknown: draft.noticeUnknown
            },
            otherTerms: recordValue(existingTerms.otherTerms)
          },
          privateCompensation: {
            base: draft.compensationUnknown
              ? null
              : money("base", String(amount ?? ""), draft.period),
            total: draft.compensationUnknown
              ? null
              : money("total", draft.totalAmount, "year"),
            hourlyRate: draft.compensationUnknown
              ? null
              : money("hourlyRate", draft.hourlyRate, "hour"),
            dailyRate: draft.compensationUnknown
              ? null
              : money("dailyRate", draft.dailyRate, "day"),
            bonus: draft.compensationUnknown
              ? {}
              : component("bonus", draft.bonus),
            commission: draft.compensationUnknown
              ? {}
              : component("commission", draft.commission),
            equity: draft.compensationUnknown
              ? {}
              : component("equity", draft.equity),
            pension: draft.compensationUnknown
              ? {}
              : component("pension", draft.pension),
            benefits: draft.compensationUnknown
              ? []
              : lines(draft.benefits).map(
                  (label) =>
                    existingBenefits.find(
                      (benefit) => offerBenefitLabel(benefit) === label
                    ) ?? {
                      type: "other",
                      label,
                      description: "",
                      amount: null,
                      currency: null,
                      period: "unknown",
                      days: null,
                      unknown: false
                    }
                ),
            other: recordValue(existingCompensation.other)
          },
          contingencies: lines(draft.contingencies).map((label) => ({ label })),
          negotiationAsks: lines(draft.negotiationAsks).map((label) => ({
            label
          })),
          response: draft.response,
          artifactIds: lines(draft.artifactIds),
          expiresAt: isoOrNull(draft.expiresAt),
          decision: draft.decision,
          rationale: draft.rationale,
          criteriaVersionId: draft.criteriaVersionId || null,
          plannedEngagementId: offer?.plannedEngagementId ?? null,
          provenance
        };
        try {
          if (offer)
            await updateWorkSupportingRecord(userIds, "offer", offer.id, {
              expectedRevision: Number(offer.revision),
              data
            });
          else
            await createWorkSupportingRecord(
              userIds,
              "offer",
              { data },
              applicationId
            );
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

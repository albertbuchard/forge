import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, Archive, Plus, Save, RotateCcw } from "lucide-react";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  EvidenceList,
  WorkStatusBadge,
  WorkTrendChart,
  formatDate,
  readable
} from "@/components/work/work-components";
import {
  workBenefitRecords,
  workCompensationRecord
} from "@/components/work/work-dialog-helpers";
import {
  archiveWorkRecord,
  restoreWorkRecord,
  updateWorkEngagement
} from "@/lib/work-api";
import type {
  WorkEngagement,
  WorkRecord,
  WorkTrendSeries
} from "@/lib/work-api";
import {
  workDays,
  record,
  RelationshipEditor,
  EventTimeline,
  FactsGrid
} from "./work-detail-shared";
import {
  editDraft,
  RoleFactsEditor,
  RoleFactsSummary,
  CompensationSummary
} from "./work-engagement-detail-support";
import type { EngagementEditDraft } from "./work-engagement-detail-support";

export function EngagementDetail({
  engagement,
  organizations,
  trends,
  userIds,
  onRefresh,
  onCheckIn
}: {
  engagement: WorkEngagement;
  organizations: WorkRecord[];
  trends: WorkTrendSeries[];
  userIds: string[];
  onRefresh: () => Promise<void>;
  onCheckIn: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => editDraft(engagement));
  useEffect(() => {
    setDraft(editDraft(engagement));
  }, [engagement]);
  const set = (patch: Partial<EngagementEditDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const lines = (value: string) =>
    value
      .split(/\r?\n/gu)
      .map((entry) => entry.trim())
      .filter(Boolean);
  const numberOrNull = (value: string) => (value.trim() ? Number(value) : null);
  const save = useMutation({
    mutationFn: () =>
      updateWorkEngagement(userIds, engagement.id, {
        expectedRevision: Number(engagement.revision),
        organizationId: draft.organizationId || null,
        title: draft.title,
        roleFunction: draft.roleFunction,
        description: draft.description,
        status: draft.status,
        priority: draft.priority,
        engagementType: draft.engagementType,
        startDate: draft.startDate || null,
        expectedEndDate: draft.expectedEndDate || null,
        actualEndDate: draft.actualEndDate || null,
        probationEndDate: draft.probationEndDate || null,
        renewalDate: draft.renewalDate || null,
        contractDeadline: draft.contractDeadline || null,
        earliestDepartureDate: draft.earliestDepartureDate || null,
        workModel: draft.workModel,
        workload: {
          contractedWeeklyHours: numberOrNull(draft.contractedHours),
          actualWeeklyHours: numberOrNull(draft.actualHours),
          fullTimeEquivalent: numberOrNull(draft.fullTimeEquivalent)
        },
        schedule: {
          ...record(engagement.schedule),
          summary: draft.schedule,
          shifts: lines(draft.shifts),
          workingDays: draft.workingDays,
          timezone: draft.timezone,
          officeDaysPerWeek: numberOrNull(draft.officeDays),
          travelPercent: numberOrNull(draft.travelPercent),
          onCallResponsibility: draft.onCallResponsibility,
          flexibility: draft.flexibility
        },
        location: {
          ...record(engagement.location),
          label: draft.location,
          commuteMinutesEachWay: numberOrNull(draft.commuteMinutes)
        },
        noticePeriod: {
          value: draft.noticeUnknown ? null : numberOrNull(draft.noticeValue),
          unit: draft.noticeUnknown ? null : draft.noticeUnit,
          negotiable: null,
          conditions: "",
          unknown: draft.noticeUnknown
        },
        roleFacts: {
          seniority: draft.seniority,
          roleFamily: draft.roleFamily,
          teamName: draft.teamName,
          managerRole: draft.managerRole,
          directReportCount: numberOrNull(draft.directReportCount),
          decisionAuthority: lines(draft.decisionAuthority),
          ownershipAreas: lines(draft.ownershipAreas),
          domains: lines(draft.domains),
          technologies: lines(draft.technologies),
          skillsUsed: lines(draft.skillsUsed),
          skillsDeveloping: lines(draft.skillsDeveloping),
          clinicalExposure: draft.clinicalExposure,
          customerExposure: draft.customerExposure,
          researchFreedom: draft.researchFreedom,
          publicationRights: draft.publicationRights,
          openSourceRights: draft.openSourceRights,
          deliverables: lines(draft.deliverables)
        },
        compensation: workCompensationRecord({
          unknown: draft.compensationUnknown,
          baseAmount: draft.compensationAmount,
          currency: draft.compensationCurrency,
          basePeriod: draft.compensationPeriod,
          totalAmount: draft.totalCompensation,
          hourlyRate: draft.hourlyRate,
          dailyRate: draft.dailyRate,
          bonus: draft.bonus,
          commission: draft.commission,
          equity: draft.equity,
          pension: draft.pension
        }),
        benefits: workBenefitRecords({
          paidLeaveDays: draft.paidLeaveDays,
          educationBudget: draft.educationBudget,
          currency: draft.compensationCurrency,
          otherBenefits: draft.benefits
        }),
        purpose: draft.purpose,
        responsibilities: lines(draft.responsibilities),
        successCriteria: lines(draft.successCriteria),
        desiredOutcomes: lines(draft.desiredOutcomes),
        risks: lines(draft.risks),
        constraints: lines(draft.constraints),
        transitionIntentions: draft.transitionIntentions,
        exitReason: draft.exitReason,
        exitOutcome: draft.exitOutcome,
        nextAction: draft.nextAction,
        provenance: { sourceKind: "user", sourceLabel: "Forge Work editor" }
      }),
    onSuccess: async () => {
      setEditing(false);
      await onRefresh();
    }
  });
  const archiveMutation = useMutation({
    mutationFn: () =>
      engagement.deletedAt
        ? restoreWorkRecord(
            userIds,
            "work_engagement",
            engagement.id,
            Number(engagement.revision)
          )
        : archiveWorkRecord(
            userIds,
            "work_engagement",
            engagement.id,
            Number(engagement.revision)
          ),
    onSuccess: async () => {
      setEditing(false);
      await onRefresh();
    }
  });
  const archived = Boolean(engagement.deletedAt);
  const selectClass =
    "min-h-10 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-sm";
  const field = "grid gap-1 text-xs text-[var(--ui-ink-soft)]";
  return (
    <div className="grid gap-5">
      <PageHero
        entityKind="work_engagement"
        title={engagement.title}
        description={
          engagement.purpose ||
          engagement.description ||
          "Current or planned work arrangement."
        }
        badge={
          <div className="flex flex-wrap gap-2">
            <WorkStatusBadge status={engagement.status} />
            {archived ? <Badge tone="meta">Archived</Badge> : null}
          </div>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {!archived ? (
              <>
                <Button variant="secondary" onClick={onCheckIn}>
                  <Plus className="size-4" />
                  Check in
                </Button>
                <Button onClick={() => setEditing((current) => !current)}>
                  {editing ? "Cancel edit" : "Edit work facts"}
                </Button>
              </>
            ) : null}
            <Button
              variant="secondary"
              pending={archiveMutation.isPending}
              pendingLabel={archived ? "Restoring…" : "Archiving…"}
              onClick={() => archiveMutation.mutate()}
            >
              {archived ? (
                <RotateCcw className="size-4" />
              ) : (
                <Archive className="size-4" />
              )}
              {archived ? "Restore work" : "Archive work"}
            </Button>
          </div>
        }
      />
      <div className="px-4 sm:px-6">
        <Link
          to="/work?tab=current"
          className="mb-4 inline-flex items-center gap-2 text-sm text-[var(--primary)]"
        >
          <ArrowLeft className="size-4" />
          Back to Current work
        </Link>
        {archiveMutation.error ? (
          <p className="mb-4 text-sm text-[var(--danger)]">
            {archiveMutation.error.message}
          </p>
        ) : null}
        {editing ? (
          <Card className="mb-5 grid gap-5">
            <div className="grid gap-4 md:grid-cols-2">
              <label className={field}>
                Title
                <Input
                  value={draft.title}
                  onChange={(event) => set({ title: event.target.value })}
                />
              </label>
              <label className={field}>
                Role or function
                <Input
                  value={draft.roleFunction}
                  onChange={(event) =>
                    set({ roleFunction: event.target.value })
                  }
                />
              </label>
              <label className={field}>
                Organization
                <select
                  value={draft.organizationId}
                  onChange={(event) =>
                    set({ organizationId: event.target.value })
                  }
                  className={selectClass}
                >
                  <option value="">No organization</option>
                  {organizations.map((organization) => (
                    <option key={organization.id} value={organization.id}>
                      {String(organization.name ?? organization.id)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={field}>
                Status
                <select
                  value={draft.status}
                  onChange={(event) =>
                    set({
                      status: event.target.value as WorkEngagement["status"]
                    })
                  }
                  className={selectClass}
                >
                  {[
                    "planned",
                    "current",
                    "on_leave",
                    "transitioning",
                    "ended",
                    "archived"
                  ].map((value) => (
                    <option key={value} value={value}>
                      {readable(value)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={field}>
                Arrangement
                <select
                  value={draft.engagementType}
                  onChange={(event) =>
                    set({ engagementType: event.target.value })
                  }
                  className={selectClass}
                >
                  {[
                    "employment",
                    "appointment",
                    "contract",
                    "freelance",
                    "fractional",
                    "shift",
                    "self_employment",
                    "advisory",
                    "internship",
                    "seasonal",
                    "other"
                  ].map((value) => (
                    <option key={value} value={value}>
                      {readable(value)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={field}>
                Priority
                <select
                  value={draft.priority}
                  onChange={(event) => set({ priority: event.target.value })}
                  className={selectClass}
                >
                  {["low", "normal", "high", "critical"].map((value) => (
                    <option key={value} value={value}>
                      {readable(value)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={`${field} md:col-span-2`}>
                Description
                <Textarea
                  rows={3}
                  value={draft.description}
                  onChange={(event) => set({ description: event.target.value })}
                />
              </label>
            </div>
            <div>
              <h2 className="mb-3 font-semibold text-[var(--ui-ink-strong)]">
                Dates, place, and workload
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {(
                  [
                    ["startDate", "Start date"],
                    ["expectedEndDate", "Expected end"],
                    ["actualEndDate", "Actual end"],
                    ["probationEndDate", "Probation end"],
                    ["renewalDate", "Renewal"],
                    ["contractDeadline", "Contract deadline"],
                    ["earliestDepartureDate", "Earliest departure"]
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className={field}>
                    {label}
                    <Input
                      type="date"
                      value={draft[key]}
                      onChange={(event) => set({ [key]: event.target.value })}
                    />
                  </label>
                ))}
                <label className={field}>
                  Work model
                  <select
                    value={draft.workModel}
                    onChange={(event) => set({ workModel: event.target.value })}
                    className={selectClass}
                  >
                    {["unknown", "remote", "hybrid", "on_site", "variable"].map(
                      (value) => (
                        <option key={value} value={value}>
                          {readable(value)}
                        </option>
                      )
                    )}
                  </select>
                </label>
                <label className={field}>
                  Location
                  <Input
                    value={draft.location}
                    onChange={(event) => set({ location: event.target.value })}
                  />
                </label>
                <label className={field}>
                  Contracted hours/week
                  <Input
                    type="number"
                    min="0"
                    max="168"
                    value={draft.contractedHours}
                    onChange={(event) =>
                      set({ contractedHours: event.target.value })
                    }
                  />
                </label>
                <label className={field}>
                  Actual hours/week
                  <Input
                    type="number"
                    min="0"
                    max="168"
                    value={draft.actualHours}
                    onChange={(event) =>
                      set({ actualHours: event.target.value })
                    }
                  />
                </label>
                <label className={field}>
                  Full-time equivalent
                  <Input
                    type="number"
                    min="0"
                    max="5"
                    step="0.1"
                    value={draft.fullTimeEquivalent}
                    onChange={(event) =>
                      set({ fullTimeEquivalent: event.target.value })
                    }
                  />
                </label>
                <label className={`${field} sm:col-span-2`}>
                  Schedule summary
                  <Textarea
                    rows={3}
                    value={draft.schedule}
                    onChange={(event) => set({ schedule: event.target.value })}
                  />
                </label>
                <label className={field}>
                  Timezone
                  <Input
                    value={draft.timezone}
                    onChange={(event) => set({ timezone: event.target.value })}
                  />
                </label>
                <div className="grid gap-1 sm:col-span-2 lg:col-span-3">
                  <span className="text-xs text-[var(--ui-ink-soft)]">
                    Working days
                  </span>
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                    {workDays.map(([day, label]) => {
                      const selected = draft.workingDays.includes(day);
                      return (
                        <button
                          key={day}
                          type="button"
                          aria-pressed={selected}
                          onClick={() =>
                            set({
                              workingDays: selected
                                ? draft.workingDays.filter(
                                    (entry) => entry !== day
                                  )
                                : [...draft.workingDays, day]
                            })
                          }
                          className={`min-h-11 rounded-[14px] border px-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${selected ? "border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] text-[var(--ui-ink-strong)]" : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)]"}`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <label className={field}>
                  Office days per week
                  <Input
                    type="number"
                    min="0"
                    max="7"
                    step="0.5"
                    value={draft.officeDays}
                    onChange={(event) =>
                      set({ officeDays: event.target.value })
                    }
                  />
                </label>
                <label className={field}>
                  Travel percent
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={draft.travelPercent}
                    onChange={(event) =>
                      set({ travelPercent: event.target.value })
                    }
                  />
                </label>
                <label className={field}>
                  Commute minutes each way
                  <Input
                    type="number"
                    min="0"
                    value={draft.commuteMinutes}
                    onChange={(event) =>
                      set({ commuteMinutes: event.target.value })
                    }
                  />
                </label>
                <label className={field}>
                  Shifts or working windows, one per line
                  <Textarea
                    rows={3}
                    value={draft.shifts}
                    onChange={(event) => set({ shifts: event.target.value })}
                  />
                </label>
                <label className={field}>
                  On-call responsibility
                  <Textarea
                    rows={3}
                    value={draft.onCallResponsibility}
                    onChange={(event) =>
                      set({ onCallResponsibility: event.target.value })
                    }
                  />
                </label>
                <label className={`${field} sm:col-span-2`}>
                  Flexibility and control over time
                  <Textarea
                    rows={3}
                    value={draft.flexibility}
                    onChange={(event) =>
                      set({ flexibility: event.target.value })
                    }
                  />
                </label>
              </div>
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <h2 className="mb-3 font-semibold text-[var(--ui-ink-strong)]">
                  Notice and transition
                </h2>
                <div className="grid gap-3">
                  <label className="flex min-h-10 items-center gap-3 text-sm text-[var(--ui-ink-strong)]">
                    <input
                      type="checkbox"
                      checked={draft.noticeUnknown}
                      onChange={(event) =>
                        set({ noticeUnknown: event.target.checked })
                      }
                    />
                    Notice period is unknown
                  </label>
                  {!draft.noticeUnknown ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className={field}>
                        Notice value
                        <Input
                          type="number"
                          min="0"
                          value={draft.noticeValue}
                          onChange={(event) =>
                            set({ noticeValue: event.target.value })
                          }
                        />
                      </label>
                      <label className={field}>
                        Unit
                        <select
                          value={draft.noticeUnit}
                          onChange={(event) =>
                            set({
                              noticeUnit: event.target
                                .value as EngagementEditDraft["noticeUnit"]
                            })
                          }
                          className={selectClass}
                        >
                          {["days", "weeks", "months"].map((value) => (
                            <option key={value}>{value}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  ) : null}
                  <label className={field}>
                    Transition intentions
                    <Textarea
                      rows={3}
                      value={draft.transitionIntentions}
                      onChange={(event) =>
                        set({ transitionIntentions: event.target.value })
                      }
                    />
                  </label>
                </div>
              </div>
              <div>
                <h2 className="mb-3 font-semibold text-[var(--ui-ink-strong)]">
                  Private compensation
                </h2>
                <div className="grid gap-3">
                  <label className="flex min-h-10 items-center gap-3 text-sm text-[var(--ui-ink-strong)]">
                    <input
                      type="checkbox"
                      checked={draft.compensationUnknown}
                      onChange={(event) =>
                        set({ compensationUnknown: event.target.checked })
                      }
                    />
                    Base compensation is unknown
                  </label>
                  {!draft.compensationUnknown ? (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <label className={field}>
                        Gross base amount
                        <Input
                          type="number"
                          min="0"
                          value={draft.compensationAmount}
                          onChange={(event) =>
                            set({ compensationAmount: event.target.value })
                          }
                        />
                      </label>
                      <label className={field}>
                        Currency
                        <Input
                          maxLength={3}
                          value={draft.compensationCurrency}
                          onChange={(event) =>
                            set({
                              compensationCurrency:
                                event.target.value.toUpperCase()
                            })
                          }
                        />
                      </label>
                      <label className={field}>
                        Period
                        <select
                          value={draft.compensationPeriod}
                          onChange={(event) =>
                            set({
                              compensationPeriod: event.target
                                .value as EngagementEditDraft["compensationPeriod"]
                            })
                          }
                          className={selectClass}
                        >
                          {[
                            "hour",
                            "day",
                            "week",
                            "month",
                            "year",
                            "one_time"
                          ].map((value) => (
                            <option key={value}>{value}</option>
                          ))}
                        </select>
                      </label>
                      <label className={field}>
                        Gross total compensation/year
                        <Input
                          type="number"
                          min="0"
                          value={draft.totalCompensation}
                          onChange={(event) =>
                            set({ totalCompensation: event.target.value })
                          }
                        />
                      </label>
                      <label className={field}>
                        Hourly rate
                        <Input
                          type="number"
                          min="0"
                          value={draft.hourlyRate}
                          onChange={(event) =>
                            set({ hourlyRate: event.target.value })
                          }
                        />
                      </label>
                      <label className={field}>
                        Daily rate
                        <Input
                          type="number"
                          min="0"
                          value={draft.dailyRate}
                          onChange={(event) =>
                            set({ dailyRate: event.target.value })
                          }
                        />
                      </label>
                      <label className={field}>
                        Bonus
                        <Input
                          value={draft.bonus}
                          onChange={(event) =>
                            set({ bonus: event.target.value })
                          }
                        />
                      </label>
                      <label className={field}>
                        Commission
                        <Input
                          value={draft.commission}
                          onChange={(event) =>
                            set({ commission: event.target.value })
                          }
                        />
                      </label>
                      <label className={field}>
                        Equity
                        <Input
                          value={draft.equity}
                          onChange={(event) =>
                            set({ equity: event.target.value })
                          }
                        />
                      </label>
                      <label className={field}>
                        Pension
                        <Input
                          value={draft.pension}
                          onChange={(event) =>
                            set({ pension: event.target.value })
                          }
                        />
                      </label>
                      <label className={field}>
                        Paid leave days
                        <Input
                          type="number"
                          min="0"
                          value={draft.paidLeaveDays}
                          onChange={(event) =>
                            set({ paidLeaveDays: event.target.value })
                          }
                        />
                      </label>
                      <label className={field}>
                        Annual education budget
                        <Input
                          type="number"
                          min="0"
                          value={draft.educationBudget}
                          onChange={(event) =>
                            set({ educationBudget: event.target.value })
                          }
                        />
                      </label>
                    </div>
                  ) : null}
                  <label className={field}>
                    Other benefits and perks, one per line
                    <Textarea
                      rows={3}
                      value={draft.benefits}
                      onChange={(event) =>
                        set({ benefits: event.target.value })
                      }
                    />
                  </label>
                </div>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className={`${field} md:col-span-2`}>
                Why this role matters
                <Textarea
                  rows={3}
                  value={draft.purpose}
                  onChange={(event) => set({ purpose: event.target.value })}
                />
              </label>
              {(
                [
                  ["responsibilities", "Responsibilities"],
                  ["successCriteria", "Success criteria"],
                  ["desiredOutcomes", "Desired outcomes"],
                  ["risks", "Risks"],
                  ["constraints", "Constraints"]
                ] as const
              ).map(([key, label]) => (
                <label key={key} className={field}>
                  {label}, one per line
                  <Textarea
                    rows={4}
                    value={draft[key]}
                    onChange={(event) => set({ [key]: event.target.value })}
                  />
                </label>
              ))}
              <label className={field}>
                Exit reason
                <Textarea
                  rows={3}
                  value={draft.exitReason}
                  onChange={(event) => set({ exitReason: event.target.value })}
                />
              </label>
              <label className={field}>
                Exit outcome
                <Textarea
                  rows={3}
                  value={draft.exitOutcome}
                  onChange={(event) => set({ exitOutcome: event.target.value })}
                />
              </label>
              <label className={`${field} md:col-span-2`}>
                Next action
                <Textarea
                  rows={3}
                  value={draft.nextAction}
                  onChange={(event) => set({ nextAction: event.target.value })}
                />
              </label>
            </div>
            <div>
              <Button
                disabled={!draft.title.trim()}
                pending={save.isPending}
                pendingLabel="Saving…"
                onClick={() => save.mutate()}
              >
                <Save className="size-4" />
                Save work facts
              </Button>
              {save.error ? (
                <p className="mt-2 text-sm text-[var(--danger)]">
                  {save.error.message}
                </p>
              ) : null}
            </div>
          </Card>
        ) : null}
        {editing ? <RoleFactsEditor draft={draft} onChange={set} /> : null}
        <FactsGrid
          facts={[
            { label: "Role or function", value: engagement.roleFunction },
            {
              label: "Seniority",
              value: record(engagement.roleFacts).seniority
            },
            {
              label: "Role family",
              value: record(engagement.roleFacts).roleFamily
            },
            { label: "Arrangement", value: engagement.engagementType },
            { label: "Work model", value: engagement.workModel },
            { label: "Location", value: record(engagement.location).label },
            {
              label: "Contracted hours",
              value:
                record(engagement.workload).contractedWeeklyHours == null
                  ? "Unknown"
                  : `${String(record(engagement.workload).contractedWeeklyHours)} / week`
            },
            {
              label: "Working days",
              value: Array.isArray(record(engagement.schedule).workingDays)
                ? (record(engagement.schedule).workingDays as unknown[])
                    .map((day) => readable(day))
                    .join(", ") || "Not set"
                : "Not set"
            },
            {
              label: "Timezone",
              value: record(engagement.schedule).timezone || "Not set"
            },
            {
              label: "Start",
              value: formatDate(engagement.startDate, "Unknown")
            },
            {
              label: "Expected end",
              value: formatDate(
                engagement.expectedEndDate,
                "Open-ended or unknown"
              )
            },
            {
              label: "Renewal",
              value: formatDate(engagement.renewalDate, "Not set")
            },
            {
              label: "Contract deadline",
              value: formatDate(engagement.contractDeadline, "Not set")
            },
            {
              label: "Earliest departure",
              value: formatDate(engagement.earliestDepartureDate, "Not known")
            },
            { label: "Priority", value: engagement.priority }
          ]}
        />
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
          <div className="grid gap-5">
            <Card className="grid gap-5">
              <EvidenceList
                title="Responsibilities"
                items={engagement.responsibilities}
              />
              <EvidenceList
                title="Success criteria"
                items={engagement.successCriteria}
                tone="positive"
              />
              <EvidenceList
                title="Desired outcomes"
                items={engagement.desiredOutcomes}
              />
              <EvidenceList
                title="Risks and constraints"
                items={[
                  ...(engagement.risks ?? []),
                  ...(engagement.constraints ?? [])
                ]}
                tone="warning"
              />
            </Card>
            <RoleFactsSummary value={engagement.roleFacts} />
            {engagement.compensation || engagement.benefits ? (
              <CompensationSummary engagement={engagement} />
            ) : null}
            <div className="grid gap-4 md:grid-cols-2">
              {trends.slice(0, 8).map((series) => (
                <WorkTrendChart
                  key={`${series.engagementId}-${series.metricKey}`}
                  series={series}
                />
              ))}
              {trends.length === 0 ? (
                <Card className="md:col-span-2">
                  <h2 className="font-semibold text-[var(--ui-ink-strong)]">
                    No check-in trends yet
                  </h2>
                  <p className="mt-2 text-sm text-[var(--ui-ink-soft)]">
                    Record one or more anchored 1–5 observations. Forge will
                    show actual points and meaningful changes without inventing
                    values between them.
                  </p>
                  <Button className="mt-4" onClick={onCheckIn}>
                    Record first check-in
                  </Button>
                </Card>
              ) : null}
            </div>
            <EventTimeline events={engagement.events} />
          </div>
          <div className="grid content-start gap-5">
            <Card>
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
                Next action
              </h2>
              <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-strong)]">
                {engagement.nextAction || "No next action recorded."}
              </p>
            </Card>
            <RelationshipEditor
              links={engagement.links}
              entityType="work_engagement"
              entityId={engagement.id}
              revision={Number(engagement.revision)}
              userIds={userIds}
              onRefresh={onRefresh}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

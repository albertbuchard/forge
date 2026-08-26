import {
  FlowChoiceGrid,
  FlowField,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { readable } from "@/components/work/work-components";
import {
  lines,
  NativeSelect,
  workBenefitRecords,
  workCompensationRecord,
  workInterfaceProvenance as provenance
} from "@/components/work/work-dialog-helpers";
import type { WorkRecord } from "@/lib/work-api";

const workDays = [
  ["monday", "Mon"],
  ["tuesday", "Tue"],
  ["wednesday", "Wed"],
  ["thursday", "Thu"],
  ["friday", "Fri"],
  ["saturday", "Sat"],
  ["sunday", "Sun"]
] as const;

type WorkDay = (typeof workDays)[number][0];

export type EngagementDraft = {
  title: string;
  roleFunction: string;
  organizationId: string;
  status: "planned" | "current" | "ended";
  engagementType: string;
  startDate: string;
  expectedEndDate: string;
  renewalDate: string;
  workModel: string;
  weeklyHours: string;
  actualWeeklyHours: string;
  fullTimeEquivalent: string;
  location: string;
  timezone: string;
  scheduleSummary: string;
  shifts: string;
  workingDays: WorkDay[];
  officeDays: string;
  travelPercent: string;
  commuteMinutes: string;
  onCallResponsibility: string;
  flexibility: string;
  noticeUnknown: boolean;
  noticeValue: string;
  noticeUnit: "days" | "weeks" | "months";
  compensationUnknown: boolean;
  compensationAmount: string;
  totalCompensation: string;
  hourlyRate: string;
  dailyRate: string;
  bonus: string;
  commission: string;
  equity: string;
  pension: string;
  paidLeaveDays: string;
  educationBudget: string;
  benefits: string;
  compensationCurrency: string;
  compensationPeriod: "hour" | "day" | "week" | "month" | "year" | "one_time";
  purpose: string;
  responsibilities: string;
  successCriteria: string;
  desiredOutcomes: string;
  risks: string;
  nextAction: string;
  seniority: string;
  roleFamily: string;
  teamName: string;
  directReportCount: string;
  decisionAuthority: string;
  ownershipAreas: string;
  domains: string;
  technologies: string;
  skillsUsed: string;
  skillsDeveloping: string;
  deliverables: string;
};

export const emptyEngagement: EngagementDraft = {
  title: "",
  roleFunction: "",
  organizationId: "",
  status: "current",
  engagementType: "employment",
  startDate: "",
  expectedEndDate: "",
  renewalDate: "",
  workModel: "unknown",
  weeklyHours: "",
  actualWeeklyHours: "",
  fullTimeEquivalent: "",
  location: "",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  scheduleSummary: "",
  shifts: "",
  workingDays: [],
  officeDays: "",
  travelPercent: "",
  commuteMinutes: "",
  onCallResponsibility: "",
  flexibility: "",
  noticeUnknown: true,
  noticeValue: "",
  noticeUnit: "months",
  compensationUnknown: true,
  compensationAmount: "",
  totalCompensation: "",
  hourlyRate: "",
  dailyRate: "",
  bonus: "",
  commission: "",
  equity: "",
  pension: "",
  paidLeaveDays: "",
  educationBudget: "",
  benefits: "",
  compensationCurrency: "CHF",
  compensationPeriod: "year",
  purpose: "",
  responsibilities: "",
  successCriteria: "",
  desiredOutcomes: "",
  risks: "",
  nextAction: "",
  seniority: "",
  roleFamily: "",
  teamName: "",
  directReportCount: "",
  decisionAuthority: "",
  ownershipAreas: "",
  domains: "",
  technologies: "",
  skillsUsed: "",
  skillsDeveloping: "",
  deliverables: ""
};

type SetEngagementDraft = (patch: Partial<EngagementDraft>) => void;

function RoleFields({
  value,
  setValue,
  organizations
}: {
  value: EngagementDraft;
  setValue: SetEngagementDraft;
  organizations: WorkRecord[];
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FlowField label="Job or engagement title" className="md:col-span-2">
        <Input
          value={value.title}
          onChange={(event) => setValue({ title: event.target.value })}
          autoFocus
          placeholder="Senior ML researcher"
        />
      </FlowField>
      <FlowField label="Role or function">
        <Input
          value={value.roleFunction}
          onChange={(event) => setValue({ roleFunction: event.target.value })}
          placeholder="Research, clinical work, operations…"
        />
      </FlowField>
      <NativeSelect
        label="Organization"
        value={value.organizationId}
        onChange={(organizationId) => setValue({ organizationId })}
      >
        <option value="">No linked organization yet</option>
        {organizations.map((organization) => (
          <option key={organization.id} value={organization.id}>
            {String(organization.name ?? organization.id)}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect
        label="Arrangement"
        value={value.engagementType}
        onChange={(engagementType) => setValue({ engagementType })}
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
        ].map((option) => (
          <option key={option} value={option}>
            {readable(option)}
          </option>
        ))}
      </NativeSelect>
      <FlowChoiceGrid
        value={value.status}
        onChange={(status) =>
          setValue({ status: status as EngagementDraft["status"] })
        }
        options={[
          {
            value: "current",
            label: "Current",
            description: "You are doing this work now."
          },
          {
            value: "planned",
            label: "Planned",
            description:
              "The arrangement is agreed or expected but not started."
          },
          {
            value: "ended",
            label: "Past",
            description:
              "Record a previous role while preserving its dates and outcome."
          }
        ]}
      />
    </div>
  );
}

function DatesAndScheduleFields({
  value,
  setValue
}: {
  value: EngagementDraft;
  setValue: SetEngagementDraft;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FlowField label="Start date">
        <Input
          type="date"
          value={value.startDate}
          onChange={(event) => setValue({ startDate: event.target.value })}
        />
      </FlowField>
      <FlowField label="Expected end date">
        <Input
          type="date"
          value={value.expectedEndDate}
          onChange={(event) =>
            setValue({ expectedEndDate: event.target.value })
          }
        />
      </FlowField>
      <FlowField label="Renewal or contract review">
        <Input
          type="date"
          value={value.renewalDate}
          onChange={(event) => setValue({ renewalDate: event.target.value })}
        />
      </FlowField>
      <NativeSelect
        label="Work model"
        value={value.workModel}
        onChange={(workModel) => setValue({ workModel })}
      >
        {[
          ["unknown", "Unknown"],
          ["remote", "Remote"],
          ["hybrid", "Hybrid"],
          ["on_site", "On site"],
          ["variable", "Variable"]
        ].map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </NativeSelect>
      <FlowField label="Contracted weekly hours">
        <Input
          type="number"
          min="0"
          max="168"
          inputMode="decimal"
          value={value.weeklyHours}
          onChange={(event) => setValue({ weeklyHours: event.target.value })}
          placeholder="40"
        />
      </FlowField>
      <FlowField label="Actual weekly hours">
        <Input
          type="number"
          min="0"
          max="168"
          inputMode="decimal"
          value={value.actualWeeklyHours}
          onChange={(event) =>
            setValue({ actualWeeklyHours: event.target.value })
          }
        />
      </FlowField>
      <FlowField label="Full-time equivalent">
        <Input
          type="number"
          min="0"
          max="5"
          step="0.1"
          inputMode="decimal"
          value={value.fullTimeEquivalent}
          onChange={(event) =>
            setValue({ fullTimeEquivalent: event.target.value })
          }
        />
      </FlowField>
      <FlowField label="Location">
        <Input
          value={value.location}
          onChange={(event) => setValue({ location: event.target.value })}
          placeholder="Geneva, remote, multiple sites…"
        />
      </FlowField>
      <FlowField label="Timezone">
        <Input
          value={value.timezone}
          onChange={(event) => setValue({ timezone: event.target.value })}
        />
      </FlowField>
      <FlowField label="Office days per week">
        <Input
          type="number"
          min="0"
          max="7"
          step="0.5"
          value={value.officeDays}
          onChange={(event) => setValue({ officeDays: event.target.value })}
        />
      </FlowField>
      <FlowField label="Travel percent">
        <Input
          type="number"
          min="0"
          max="100"
          value={value.travelPercent}
          onChange={(event) => setValue({ travelPercent: event.target.value })}
        />
      </FlowField>
      <FlowField label="Commute minutes each way">
        <Input
          type="number"
          min="0"
          value={value.commuteMinutes}
          onChange={(event) => setValue({ commuteMinutes: event.target.value })}
        />
      </FlowField>
      <FlowField label="Schedule summary" className="md:col-span-2">
        <Textarea
          rows={4}
          value={value.scheduleSummary}
          onChange={(event) =>
            setValue({ scheduleSummary: event.target.value })
          }
        />
      </FlowField>
      <FlowField
        label="Working days"
        hint="Choose every day that normally belongs to this engagement."
        className="md:col-span-2"
      >
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
          {workDays.map(([day, label]) => {
            const selected = value.workingDays.includes(day);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  setValue({
                    workingDays: selected
                      ? value.workingDays.filter((entry) => entry !== day)
                      : [...value.workingDays, day]
                  })
                }
                className={`min-h-11 rounded-[14px] border px-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${selected ? "border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] text-[var(--ui-ink-strong)]" : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)]"}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </FlowField>
      <FlowField label="Shifts or working windows" hint="One per line">
        <Textarea
          rows={4}
          value={value.shifts}
          onChange={(event) => setValue({ shifts: event.target.value })}
        />
      </FlowField>
      <FlowField label="On-call responsibility">
        <Textarea
          rows={4}
          value={value.onCallResponsibility}
          onChange={(event) =>
            setValue({ onCallResponsibility: event.target.value })
          }
        />
      </FlowField>
      <FlowField
        label="Flexibility and control over time"
        className="md:col-span-2"
      >
        <Textarea
          rows={4}
          value={value.flexibility}
          onChange={(event) => setValue({ flexibility: event.target.value })}
        />
      </FlowField>
    </div>
  );
}

function NoticeFields({
  value,
  setValue
}: {
  value: EngagementDraft;
  setValue: SetEngagementDraft;
}) {
  return (
    <div className="grid gap-4">
      <FlowChoiceGrid
        value={value.noticeUnknown ? "unknown" : "known"}
        onChange={(choice) => setValue({ noticeUnknown: choice === "unknown" })}
        options={[
          {
            value: "unknown",
            label: "Not known",
            description: "Record the gap and confirm it later."
          },
          {
            value: "known",
            label: "I know it",
            description: "Store the contractual duration."
          }
        ]}
      />
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
          <NativeSelect
            label="Unit"
            value={value.noticeUnit}
            onChange={(noticeUnit) =>
              setValue({
                noticeUnit: noticeUnit as EngagementDraft["noticeUnit"]
              })
            }
          >
            <option value="days">Days</option>
            <option value="weeks">Weeks</option>
            <option value="months">Months</option>
          </NativeSelect>
        </div>
      ) : null}
    </div>
  );
}

function CompensationFields({
  value,
  setValue
}: {
  value: EngagementDraft;
  setValue: SetEngagementDraft;
}) {
  return (
    <div className="grid gap-4">
      <FlowChoiceGrid
        value={value.compensationUnknown ? "unknown" : "known"}
        onChange={(choice) =>
          setValue({ compensationUnknown: choice === "unknown" })
        }
        options={[
          {
            value: "unknown",
            label: "Leave unknown",
            description: "Do not store an amount."
          },
          {
            value: "known",
            label: "Record it",
            description: "Store a private gross base amount."
          }
        ]}
      />
      {!value.compensationUnknown ? (
        <div className="grid gap-4 md:grid-cols-3">
          <FlowField label="Gross base amount">
            <Input
              type="number"
              min="0"
              inputMode="decimal"
              value={value.compensationAmount}
              onChange={(event) =>
                setValue({ compensationAmount: event.target.value })
              }
            />
          </FlowField>
          <FlowField label="Currency">
            <Input
              value={value.compensationCurrency}
              onChange={(event) =>
                setValue({
                  compensationCurrency: event.target.value
                    .toUpperCase()
                    .slice(0, 3)
                })
              }
              maxLength={3}
            />
          </FlowField>
          <NativeSelect
            label="Period"
            value={value.compensationPeriod}
            onChange={(compensationPeriod) =>
              setValue({
                compensationPeriod:
                  compensationPeriod as EngagementDraft["compensationPeriod"]
              })
            }
          >
            <option value="hour">Per hour</option>
            <option value="day">Per day</option>
            <option value="week">Per week</option>
            <option value="month">Per month</option>
            <option value="year">Per year</option>
            <option value="one_time">One-time amount</option>
          </NativeSelect>
          <FlowField label="Gross total compensation per year">
            <Input
              type="number"
              min="0"
              inputMode="decimal"
              value={value.totalCompensation}
              onChange={(event) =>
                setValue({ totalCompensation: event.target.value })
              }
            />
          </FlowField>
          <FlowField label="Hourly rate">
            <Input
              type="number"
              min="0"
              inputMode="decimal"
              value={value.hourlyRate}
              onChange={(event) => setValue({ hourlyRate: event.target.value })}
            />
          </FlowField>
          <FlowField label="Daily rate">
            <Input
              type="number"
              min="0"
              inputMode="decimal"
              value={value.dailyRate}
              onChange={(event) => setValue({ dailyRate: event.target.value })}
            />
          </FlowField>
          <FlowField label="Bonus" hint="Describe formula, target, or unknown">
            <Input
              value={value.bonus}
              onChange={(event) => setValue({ bonus: event.target.value })}
            />
          </FlowField>
          <FlowField
            label="Commission"
            hint="Describe formula, target, or unknown"
          >
            <Input
              value={value.commission}
              onChange={(event) => setValue({ commission: event.target.value })}
            />
          </FlowField>
          <FlowField label="Equity" hint="Describe grant or plan">
            <Input
              value={value.equity}
              onChange={(event) => setValue({ equity: event.target.value })}
            />
          </FlowField>
          <FlowField label="Pension">
            <Input
              value={value.pension}
              onChange={(event) => setValue({ pension: event.target.value })}
            />
          </FlowField>
          <FlowField label="Paid leave days">
            <Input
              type="number"
              min="0"
              inputMode="decimal"
              value={value.paidLeaveDays}
              onChange={(event) =>
                setValue({ paidLeaveDays: event.target.value })
              }
            />
          </FlowField>
          <FlowField label="Annual education budget">
            <Input
              type="number"
              min="0"
              inputMode="decimal"
              value={value.educationBudget}
              onChange={(event) =>
                setValue({ educationBudget: event.target.value })
              }
            />
          </FlowField>
          <FlowField
            label="Other benefits and perks"
            hint="One per line"
            className="md:col-span-3"
          >
            <Textarea
              rows={5}
              value={value.benefits}
              onChange={(event) => setValue({ benefits: event.target.value })}
            />
          </FlowField>
        </div>
      ) : null}
    </div>
  );
}

function MeaningFields({
  value,
  setValue
}: {
  value: EngagementDraft;
  setValue: SetEngagementDraft;
}) {
  const textAreas: Array<[keyof EngagementDraft, string, string]> = [
    ["responsibilities", "Responsibilities", "One per line"],
    ["successCriteria", "Success criteria", "One per line"],
    ["decisionAuthority", "Decision authority", "One area per line"],
    ["ownershipAreas", "Ownership areas", "One area per line"],
    ["domains", "Domains", "One per line"],
    ["technologies", "Technologies", "One per line"],
    ["skillsUsed", "Skills used", "One per line"],
    ["skillsDeveloping", "Skills being developed", "One per line"],
    ["deliverables", "Deliverables", "One per line"],
    ["desiredOutcomes", "Desired outcomes", "One per line"],
    ["risks", "Risks or constraints", "One per line"]
  ];
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FlowField label="Why this role matters" className="md:col-span-2">
        <Textarea
          rows={4}
          value={value.purpose}
          onChange={(event) => setValue({ purpose: event.target.value })}
        />
      </FlowField>
      <FlowField label="Seniority">
        <Input
          value={value.seniority}
          onChange={(event) => setValue({ seniority: event.target.value })}
        />
      </FlowField>
      <FlowField label="Role family">
        <Input
          value={value.roleFamily}
          onChange={(event) => setValue({ roleFamily: event.target.value })}
        />
      </FlowField>
      <FlowField label="Team name">
        <Input
          value={value.teamName}
          onChange={(event) => setValue({ teamName: event.target.value })}
        />
      </FlowField>
      <FlowField label="Direct reports">
        <Input
          type="number"
          min="0"
          value={value.directReportCount}
          onChange={(event) =>
            setValue({ directReportCount: event.target.value })
          }
        />
      </FlowField>
      {textAreas.map(([key, label, hint]) => (
        <FlowField key={key} label={label} hint={hint}>
          <Textarea
            rows={5}
            value={String(value[key])}
            onChange={(event) => setValue({ [key]: event.target.value })}
          />
        </FlowField>
      ))}
      <FlowField label="Next action" className="md:col-span-2">
        <Input
          value={value.nextAction}
          onChange={(event) => setValue({ nextAction: event.target.value })}
        />
      </FlowField>
    </div>
  );
}

export function engagementFlowSteps(
  organizations: WorkRecord[]
): Array<QuestionFlowStep<EngagementDraft>> {
  return [
    {
      id: "role",
      eyebrow: "Current work",
      title: "What work arrangement is this?",
      description:
        "Employment, appointments, contracts, freelance work, shifts, advisory work, and overlapping roles all belong here.",
      render: (value, setValue) => (
        <RoleFields
          value={value}
          setValue={setValue}
          organizations={organizations}
        />
      )
    },
    {
      id: "dates",
      eyebrow: "Dates and availability",
      title: "When does it run?",
      description:
        "These dates let Forge reason about overlapping work, renewals, transitions, and realistic start availability.",
      render: (value, setValue) => (
        <DatesAndScheduleFields value={value} setValue={setValue} />
      )
    },
    {
      id: "notice",
      eyebrow: "Transition facts",
      title: "What is the notice period?",
      description:
        "Unknown is an explicit, valid answer. Forge never invents availability.",
      render: (value, setValue) => (
        <NoticeFields value={value} setValue={setValue} />
      )
    },
    {
      id: "compensation",
      eyebrow: "Private compensation",
      title: "Do you want to record compensation and benefits?",
      description:
        "These fields are private and require the separate Work compensation permission. Leave them unknown if you do not want them in Forge.",
      render: (value, setValue) => (
        <CompensationFields value={value} setValue={setValue} />
      )
    },
    {
      id: "meaning",
      eyebrow: "Role direction",
      title: "What matters in this role?",
      description:
        "Capture why you took it, what good work means, and what you want it to enable.",
      render: (value, setValue) => (
        <MeaningFields value={value} setValue={setValue} />
      )
    }
  ];
}

export function engagementCreatePayload(
  draft: EngagementDraft
): Record<string, unknown> {
  return {
    organizationId: draft.organizationId || null,
    title: draft.title,
    roleFunction: draft.roleFunction,
    description: "",
    status: draft.status,
    priority: "normal",
    engagementType: draft.engagementType,
    startDate: draft.startDate || null,
    expectedEndDate: draft.expectedEndDate || null,
    actualEndDate: null,
    probationEndDate: null,
    renewalDate: draft.renewalDate || null,
    contractDeadline: null,
    noticePeriod: {
      value: draft.noticeUnknown ? null : Number(draft.noticeValue || 0),
      unit: draft.noticeUnknown ? null : draft.noticeUnit,
      negotiable: null,
      conditions: "",
      unknown: draft.noticeUnknown
    },
    earliestDepartureDate: null,
    workload: {
      contractedWeeklyHours: draft.weeklyHours
        ? Number(draft.weeklyHours)
        : null,
      actualWeeklyHours: draft.actualWeeklyHours
        ? Number(draft.actualWeeklyHours)
        : null,
      fullTimeEquivalent: draft.fullTimeEquivalent
        ? Number(draft.fullTimeEquivalent)
        : null
    },
    schedule: {
      summary: draft.scheduleSummary,
      shifts: lines(draft.shifts),
      workingDays: draft.workingDays,
      timezone: draft.timezone,
      officeDaysPerWeek: draft.officeDays ? Number(draft.officeDays) : null,
      travelPercent: draft.travelPercent ? Number(draft.travelPercent) : null,
      onCallResponsibility: draft.onCallResponsibility,
      flexibility: draft.flexibility
    },
    location: draft.location
      ? {
          label: draft.location,
          commuteMinutesEachWay: draft.commuteMinutes
            ? Number(draft.commuteMinutes)
            : null
        }
      : {
          commuteMinutesEachWay: draft.commuteMinutes
            ? Number(draft.commuteMinutes)
            : null
        },
    workModel: draft.workModel,
    roleFacts: {
      seniority: draft.seniority,
      roleFamily: draft.roleFamily,
      teamName: draft.teamName,
      managerRole: "",
      directReportCount: draft.directReportCount
        ? Number(draft.directReportCount)
        : null,
      decisionAuthority: lines(draft.decisionAuthority),
      ownershipAreas: lines(draft.ownershipAreas),
      domains: lines(draft.domains),
      technologies: lines(draft.technologies),
      skillsUsed: lines(draft.skillsUsed),
      skillsDeveloping: lines(draft.skillsDeveloping),
      clinicalExposure: "",
      customerExposure: "",
      researchFreedom: "",
      publicationRights: "",
      openSourceRights: "",
      deliverables: lines(draft.deliverables)
    },
    responsibilities: lines(draft.responsibilities),
    successCriteria: lines(draft.successCriteria),
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
    desiredOutcomes: lines(draft.desiredOutcomes),
    risks: lines(draft.risks),
    constraints: [],
    transitionIntentions: "",
    exitReason: "",
    exitOutcome: "",
    nextAction: draft.nextAction,
    visibility: "private",
    scope: { projectIds: [], tagIds: [] },
    provenance
  };
}

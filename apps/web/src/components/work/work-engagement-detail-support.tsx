import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EvidenceList, readable } from "@/components/work/work-components";
import type { WorkEngagement } from "@/lib/work-api";
import { workDays, FactsGrid, record } from "./work-detail-shared";
import type { WorkDay } from "./work-detail-shared";

export type EngagementEditDraft = {
  title: string;
  roleFunction: string;
  description: string;
  organizationId: string;
  status: WorkEngagement["status"];
  priority: string;
  engagementType: string;
  startDate: string;
  expectedEndDate: string;
  actualEndDate: string;
  probationEndDate: string;
  renewalDate: string;
  contractDeadline: string;
  earliestDepartureDate: string;
  workModel: string;
  location: string;
  contractedHours: string;
  actualHours: string;
  fullTimeEquivalent: string;
  schedule: string;
  shifts: string;
  workingDays: WorkDay[];
  timezone: string;
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
  compensationCurrency: string;
  compensationPeriod: "hour" | "day" | "week" | "month" | "year" | "one_time";
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
  purpose: string;
  responsibilities: string;
  successCriteria: string;
  desiredOutcomes: string;
  risks: string;
  constraints: string;
  transitionIntentions: string;
  exitReason: string;
  exitOutcome: string;
  nextAction: string;
  seniority: string;
  roleFamily: string;
  teamName: string;
  managerRole: string;
  directReportCount: string;
  decisionAuthority: string;
  ownershipAreas: string;
  domains: string;
  technologies: string;
  skillsUsed: string;
  skillsDeveloping: string;
  clinicalExposure: string;
  customerExposure: string;
  researchFreedom: string;
  publicationRights: string;
  openSourceRights: string;
  deliverables: string;
};

function listText(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((entry) =>
          typeof entry === "object"
            ? String(record(entry).label ?? "")
            : String(entry)
        )
        .filter(Boolean)
        .join("\n")
    : "";
}

function benefitRecord(value: unknown, type: string) {
  return Array.isArray(value)
    ? record(value.find((entry) => record(entry).type === type))
    : {};
}

function otherBenefitText(value: unknown) {
  return Array.isArray(value)
    ? value
        .flatMap((entry) => {
          const item = record(entry);
          return item.type === "other" &&
            typeof item.label === "string" &&
            item.label.trim()
            ? [item.label]
            : [];
        })
        .join("\n")
    : "";
}

export function workBenefitLabel(value: Record<string, unknown>) {
  const explicit = String(value.label ?? value.description ?? "").trim();
  if (explicit) return explicit;
  const name = readable(value.type, "Benefit");
  if (value.days != null) return `${name}: ${String(value.days)} days`;
  if (value.amount != null) {
    return `${name}: ${String(value.amount)} ${String(value.currency ?? "")} ${String(value.period ?? "")}`.trim();
  }
  return name;
}

export function editDraft(engagement: WorkEngagement): EngagementEditDraft {
  const workload = record(engagement.workload);
  const notice = record(engagement.noticePeriod);
  const compensation = record(engagement.compensation);
  const base = record(compensation.base);
  const total = record(compensation.total);
  const hourlyRate = record(compensation.hourlyRate);
  const dailyRate = record(compensation.dailyRate);
  const bonus = record(compensation.bonus);
  const commission = record(compensation.commission);
  const equity = record(compensation.equity);
  const pension = record(compensation.pension);
  const paidLeave = benefitRecord(engagement.benefits, "paid_leave");
  const educationBudget = benefitRecord(
    engagement.benefits,
    "education_budget"
  );
  const location = record(engagement.location);
  const schedule = record(engagement.schedule);
  const roleFacts = record(engagement.roleFacts);
  return {
    title: engagement.title,
    roleFunction: engagement.roleFunction ?? "",
    description: engagement.description ?? "",
    organizationId: engagement.organizationId ?? "",
    status: engagement.status,
    priority: String(engagement.priority ?? "normal"),
    engagementType: String(engagement.engagementType ?? "employment"),
    startDate: engagement.startDate ?? "",
    expectedEndDate: engagement.expectedEndDate ?? "",
    actualEndDate: String(engagement.actualEndDate ?? ""),
    probationEndDate: String(engagement.probationEndDate ?? ""),
    renewalDate: engagement.renewalDate ?? "",
    contractDeadline: engagement.contractDeadline ?? "",
    earliestDepartureDate: engagement.earliestDepartureDate ?? "",
    workModel: String(engagement.workModel ?? "unknown"),
    location: String(location.label ?? ""),
    contractedHours:
      workload.contractedWeeklyHours == null
        ? ""
        : String(workload.contractedWeeklyHours),
    actualHours:
      workload.actualWeeklyHours == null
        ? ""
        : String(workload.actualWeeklyHours),
    fullTimeEquivalent:
      workload.fullTimeEquivalent == null
        ? ""
        : String(workload.fullTimeEquivalent),
    schedule: String(schedule.summary ?? ""),
    shifts: listText(schedule.shifts),
    workingDays: Array.isArray(schedule.workingDays)
      ? schedule.workingDays.filter((day): day is WorkDay =>
          workDays.some(([candidate]) => candidate === day)
        )
      : [],
    timezone: String(
      schedule.timezone ??
        Intl.DateTimeFormat().resolvedOptions().timeZone ??
        "UTC"
    ),
    officeDays:
      schedule.officeDaysPerWeek == null
        ? ""
        : String(schedule.officeDaysPerWeek),
    travelPercent:
      schedule.travelPercent == null ? "" : String(schedule.travelPercent),
    commuteMinutes:
      location.commuteMinutesEachWay == null
        ? ""
        : String(location.commuteMinutesEachWay),
    onCallResponsibility: String(schedule.onCallResponsibility ?? ""),
    flexibility: String(schedule.flexibility ?? ""),
    noticeUnknown: notice.unknown !== false,
    noticeValue: notice.value == null ? "" : String(notice.value),
    noticeUnit: (["days", "weeks", "months"].includes(String(notice.unit))
      ? notice.unit
      : "months") as EngagementEditDraft["noticeUnit"],
    compensationUnknown: base.unknown !== false,
    compensationAmount: base.amount == null ? "" : String(base.amount),
    compensationCurrency: String(base.currency ?? "CHF"),
    compensationPeriod: ([
      "hour",
      "day",
      "week",
      "month",
      "year",
      "one_time"
    ].includes(String(base.period))
      ? base.period
      : "year") as EngagementEditDraft["compensationPeriod"],
    totalCompensation: total.amount == null ? "" : String(total.amount),
    hourlyRate: hourlyRate.amount == null ? "" : String(hourlyRate.amount),
    dailyRate: dailyRate.amount == null ? "" : String(dailyRate.amount),
    bonus: String(bonus.description ?? ""),
    commission: String(commission.description ?? ""),
    equity: String(equity.description ?? ""),
    pension: String(pension.description ?? ""),
    paidLeaveDays: paidLeave.days == null ? "" : String(paidLeave.days),
    educationBudget:
      educationBudget.amount == null ? "" : String(educationBudget.amount),
    benefits: otherBenefitText(engagement.benefits),
    purpose: engagement.purpose ?? "",
    responsibilities: listText(engagement.responsibilities),
    successCriteria: listText(engagement.successCriteria),
    desiredOutcomes: listText(engagement.desiredOutcomes),
    risks: listText(engagement.risks),
    constraints: listText(engagement.constraints),
    transitionIntentions: String(engagement.transitionIntentions ?? ""),
    exitReason: String(engagement.exitReason ?? ""),
    exitOutcome: String(engagement.exitOutcome ?? ""),
    nextAction: engagement.nextAction ?? "",
    seniority: String(roleFacts.seniority ?? ""),
    roleFamily: String(roleFacts.roleFamily ?? ""),
    teamName: String(roleFacts.teamName ?? ""),
    managerRole: String(roleFacts.managerRole ?? ""),
    directReportCount:
      roleFacts.directReportCount == null
        ? ""
        : String(roleFacts.directReportCount),
    decisionAuthority: listText(roleFacts.decisionAuthority),
    ownershipAreas: listText(roleFacts.ownershipAreas),
    domains: listText(roleFacts.domains),
    technologies: listText(roleFacts.technologies),
    skillsUsed: listText(roleFacts.skillsUsed),
    skillsDeveloping: listText(roleFacts.skillsDeveloping),
    clinicalExposure: String(roleFacts.clinicalExposure ?? ""),
    customerExposure: String(roleFacts.customerExposure ?? ""),
    researchFreedom: String(roleFacts.researchFreedom ?? ""),
    publicationRights: String(roleFacts.publicationRights ?? ""),
    openSourceRights: String(roleFacts.openSourceRights ?? ""),
    deliverables: listText(roleFacts.deliverables)
  };
}

export function RoleFactsEditor({
  draft,
  onChange
}: {
  draft: EngagementEditDraft;
  onChange: (patch: Partial<EngagementEditDraft>) => void;
}) {
  const field = "grid gap-1 text-xs text-[var(--ui-ink-soft)]";
  return (
    <Card className="mb-5 grid gap-4">
      <div>
        <h2 className="font-semibold text-[var(--ui-ink-strong)]">
          Role scope and development
        </h2>
        <p className="mt-1 text-xs leading-5 text-[var(--ui-ink-soft)]">
          Link actual managers, teammates, mentors, clients, and collaborators
          below as typed Person relationships. These fields describe the role
          itself and save with the main work-facts form.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <label className={field}>
          Seniority
          <Input
            value={draft.seniority}
            onChange={(event) => onChange({ seniority: event.target.value })}
          />
        </label>
        <label className={field}>
          Role family
          <Input
            value={draft.roleFamily}
            onChange={(event) => onChange({ roleFamily: event.target.value })}
          />
        </label>
        <label className={field}>
          Team name
          <Input
            value={draft.teamName}
            onChange={(event) => onChange({ teamName: event.target.value })}
          />
        </label>
        <label className={field}>
          Manager role
          <Input
            value={draft.managerRole}
            onChange={(event) => onChange({ managerRole: event.target.value })}
          />
        </label>
        <label className={field}>
          Direct reports
          <Input
            type="number"
            min="0"
            value={draft.directReportCount}
            onChange={(event) =>
              onChange({ directReportCount: event.target.value })
            }
          />
        </label>
        {(
          [
            ["decisionAuthority", "Decision authority"],
            ["ownershipAreas", "Ownership areas"],
            ["domains", "Domains"],
            ["technologies", "Technologies"],
            ["skillsUsed", "Skills used"],
            ["skillsDeveloping", "Skills being developed"],
            ["deliverables", "Deliverables"]
          ] as const
        ).map(([key, label]) => (
          <label key={key} className={field}>
            {label}, one per line
            <Textarea
              rows={4}
              value={draft[key]}
              onChange={(event) => onChange({ [key]: event.target.value })}
            />
          </label>
        ))}
        {(
          [
            ["clinicalExposure", "Clinical accountability or exposure"],
            ["customerExposure", "Customer exposure"],
            ["researchFreedom", "Research freedom"],
            ["publicationRights", "Publication rights"],
            ["openSourceRights", "Open-source rights"]
          ] as const
        ).map(([key, label]) => (
          <label key={key} className={field}>
            {label}
            <Textarea
              rows={3}
              value={draft[key]}
              onChange={(event) => onChange({ [key]: event.target.value })}
            />
          </label>
        ))}
      </div>
    </Card>
  );
}

export function RoleFactsSummary({ value }: { value: unknown }) {
  const facts = record(value);
  const strings = (key: string) =>
    Array.isArray(facts[key]) ? (facts[key] as unknown[]).map(String) : [];
  return (
    <Card className="grid gap-5">
      <div>
        <h2 className="font-semibold text-[var(--ui-ink-strong)]">
          Role scope and development
        </h2>
        <p className="mt-1 text-xs text-[var(--ui-ink-soft)]">
          Structured facts about authority, ownership, environment, and growth.
        </p>
      </div>
      <FactsGrid
        facts={[
          { label: "Team", value: facts.teamName },
          { label: "Manager role", value: facts.managerRole },
          { label: "Direct reports", value: facts.directReportCount },
          { label: "Clinical exposure", value: facts.clinicalExposure },
          { label: "Customer exposure", value: facts.customerExposure },
          { label: "Research freedom", value: facts.researchFreedom },
          { label: "Publication rights", value: facts.publicationRights },
          { label: "Open-source rights", value: facts.openSourceRights }
        ]}
      />
      <div className="grid gap-5 md:grid-cols-2">
        <EvidenceList
          title="Decision authority"
          items={strings("decisionAuthority")}
        />
        <EvidenceList
          title="Ownership areas"
          items={strings("ownershipAreas")}
        />
        <EvidenceList
          title="Domains and technologies"
          items={[...strings("domains"), ...strings("technologies")]}
        />
        <EvidenceList
          title="Skills used and developing"
          items={[...strings("skillsUsed"), ...strings("skillsDeveloping")]}
        />
        <EvidenceList title="Deliverables" items={strings("deliverables")} />
      </div>
    </Card>
  );
}

function moneyText(value: unknown) {
  const money = record(value);
  if (money.unknown === true || money.amount == null) return "Unknown";
  return `${String(money.currency ?? "")} ${Number(money.amount).toLocaleString()} / ${String(money.period ?? "period")}`.trim();
}

export function CompensationSummary({
  engagement
}: {
  engagement: WorkEngagement;
}) {
  const compensation = record(engagement.compensation);
  const benefits = Array.isArray(engagement.benefits)
    ? engagement.benefits.map(record)
    : [];
  const descriptions = [
    ["Bonus", record(compensation.bonus).description],
    ["Commission", record(compensation.commission).description],
    ["Equity", record(compensation.equity).description],
    ["Pension", record(compensation.pension).description],
    ...benefits.map((benefit) => [
      readable(benefit.type, "Benefit"),
      benefit.unknown === true
        ? "Unknown"
        : (benefit.label ?? benefit.days ?? benefit.amount)
    ])
  ].filter(
    (entry) => entry[1] !== "" && entry[1] !== null && entry[1] !== undefined
  );
  return (
    <Card className="grid gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-[var(--ui-ink-strong)]">
            Compensation and benefits
          </h2>
          <p className="mt-1 text-xs text-[var(--ui-ink-soft)]">
            Private Work data, visible only with compensation authority.
          </p>
        </div>
        <Badge tone="meta">Private</Badge>
      </div>
      <FactsGrid
        facts={[
          { label: "Gross base", value: moneyText(compensation.base) },
          { label: "Total compensation", value: moneyText(compensation.total) },
          { label: "Hourly rate", value: moneyText(compensation.hourlyRate) },
          { label: "Daily rate", value: moneyText(compensation.dailyRate) }
        ]}
      />
      {descriptions.length ? (
        <dl className="grid gap-2">
          {descriptions.map(([label, value]) => (
            <div
              key={String(label)}
              className="flex items-start justify-between gap-4 text-sm"
            >
              <dt className="text-[var(--ui-ink-soft)]">{String(label)}</dt>
              <dd className="text-right text-[var(--ui-ink-strong)]">
                {String(value)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </Card>
  );
}

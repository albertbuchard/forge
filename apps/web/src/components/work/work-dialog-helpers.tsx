import type { ReactNode } from "react";
import { FlowField } from "@/components/flows/question-flow-dialog";

export function lines(value: string) {
  return value
    .split(/\r?\n|,/gu)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function idempotencyKey(prefix: string) {
  return `${prefix}-${Date.now()}-${crypto.randomUUID()}`;
}

export function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Forge could not save this Work record.";
}

export function NativeSelect({
  label,
  value,
  onChange,
  children,
  hint
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <FlowField label={label} hint={hint}>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 w-full rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-2.5 text-sm text-[var(--ui-ink-strong)] outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary)_45%,transparent)]"
      >
        {children}
      </select>
    </FlowField>
  );
}

export const workInterfaceProvenance = {
  sourceKind: "user",
  sourceLabel: "Forge Work interface",
  sourceUrl: "",
  sourceArtifactId: "",
  confidence: 1,
  evidence: []
};

function amountOrNull(value: string) {
  return value.trim() ? Number(value) : null;
}

export function workCompensationRecord(input: {
  unknown: boolean;
  baseAmount: string;
  currency: string;
  basePeriod: string;
  totalAmount: string;
  hourlyRate: string;
  dailyRate: string;
  bonus: string;
  commission: string;
  equity: string;
  pension: string;
}) {
  const currency = input.currency.trim().toUpperCase() || null;
  const money = (value: string, period: string, basis = "gross") => ({
    amount: amountOrNull(value),
    currency: value.trim() ? currency : null,
    basis: value.trim() ? basis : "unknown",
    period: value.trim() ? period : "unknown",
    negotiable: null,
    unknown: !value.trim()
  });
  return {
    base: input.unknown
      ? {
          amount: null,
          currency: null,
          basis: "unknown",
          period: "unknown",
          negotiable: null,
          unknown: true
        }
      : money(input.baseAmount, input.basePeriod),
    total: money(input.totalAmount, "year"),
    hourlyRate: money(input.hourlyRate, "hour"),
    dailyRate: money(input.dailyRate, "day"),
    bonus: { description: input.bonus.trim(), unknown: !input.bonus.trim() },
    commission: {
      description: input.commission.trim(),
      unknown: !input.commission.trim()
    },
    equity: { description: input.equity.trim(), unknown: !input.equity.trim() },
    pension: {
      description: input.pension.trim(),
      unknown: !input.pension.trim()
    }
  };
}

export function workBenefitRecords(input: {
  paidLeaveDays: string;
  educationBudget: string;
  currency: string;
  otherBenefits: string;
}) {
  const paidLeave = amountOrNull(input.paidLeaveDays);
  const educationBudget = amountOrNull(input.educationBudget);
  return [
    { type: "paid_leave", days: paidLeave, unknown: paidLeave === null },
    {
      type: "education_budget",
      amount: educationBudget,
      currency:
        educationBudget === null ? null : input.currency.trim().toUpperCase(),
      period: educationBudget === null ? "unknown" : "year",
      unknown: educationBudget === null
    },
    ...lines(input.otherBenefits).map((label) => ({
      type: "other",
      label,
      unknown: false
    }))
  ];
}

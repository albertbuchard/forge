import type { ReactNode } from "react";
import { FlowField } from "@/components/flows/question-flow-dialog";

export const provenance = {
  sourceKind: "user",
  sourceLabel: "Forge Work interface",
  sourceUrl: "",
  sourceArtifactId: "",
  confidence: 1,
  evidence: []
};

export function lines(value: string) {
  return value
    .split(/\r?\n/gu)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function keyValue(value: string) {
  return Object.fromEntries(
    lines(value).map((entry) => {
      const separator = entry.indexOf("=");
      return separator < 0
        ? [entry, ""]
        : [entry.slice(0, separator).trim(), entry.slice(separator + 1).trim()];
    })
  );
}

export function localDateTime(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

export function isoOrNull(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Forge could not save this Work record.";
}

export function idempotencyKey(prefix: string) {
  return `${prefix}-${Date.now()}-${crypto.randomUUID()}`;
}

export function recordValue(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function Select({
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

export function Check({
  checked,
  onChange,
  children
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex min-h-11 items-start gap-3 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3 text-sm leading-5 text-[var(--ui-ink-medium)]">
      <input
        className="mt-0.5"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{children}</span>
    </label>
  );
}

import type { ReactNode } from "react";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { cn } from "@/lib/utils";

export function DetailLabel({ label, help }: { label: string; help?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-[var(--ui-ink-soft)]">
      <span>{label}</span>
      {help ? <InfoTooltip content={help} label={`Explain ${label}`} /> : null}
    </div>
  );
}

export function SectionCard({
  eyebrow,
  title,
  description,
  children,
  className
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4 sm:p-5",
        className
      )}
    >
      <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
        {eyebrow}
      </div>
      <div className="mt-2 text-lg font-medium text-[var(--ui-ink-strong)]">
        {title}
      </div>
      {description ? (
        <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
          {description}
        </p>
      ) : null}
      <div className="mt-4">{children}</div>
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  className
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3",
        className
      )}
    >
      <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
        {label}
      </div>
      <div className="mt-2 text-base font-medium text-[var(--ui-ink-strong)]">
        {value}
      </div>
      {hint ? (
        <div className="mt-1 text-sm leading-5 text-[var(--ui-ink-faint)]">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

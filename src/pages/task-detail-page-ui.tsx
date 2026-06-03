import type { ReactNode } from "react";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { cn } from "@/lib/utils";

export function DetailLabel({ label, help }: { label: string; help?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-white/58">
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
        "rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.025))] p-4 sm:p-5",
        className
      )}
    >
      <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">
        {eyebrow}
      </div>
      <div className="mt-2 text-lg font-medium text-white">{title}</div>
      {description ? (
        <p className="mt-2 text-sm leading-6 text-white/56">{description}</p>
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
        "rounded-[18px] border border-white/8 bg-white/[0.035] px-4 py-3",
        className
      )}
    >
      <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">
        {label}
      </div>
      <div className="mt-2 text-base font-medium text-white">{value}</div>
      {hint ? (
        <div className="mt-1 text-sm leading-5 text-white/52">{hint}</div>
      ) : null}
    </div>
  );
}

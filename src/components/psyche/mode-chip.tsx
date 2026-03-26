import { cn } from "@/lib/utils";
import type { ModeProfile } from "@/lib/psyche-types";

const toneMap: Record<ModeProfile["family"], string> = {
  coping: "bg-[rgba(251,113,133,0.16)] text-rose-100",
  child: "bg-[rgba(125,211,252,0.16)] text-sky-100",
  critic_parent: "bg-[rgba(196,181,253,0.16)] text-violet-100",
  healthy_adult: "bg-[rgba(110,231,183,0.16)] text-emerald-100",
  happy_child: "bg-[rgba(251,191,36,0.16)] text-amber-100"
};

export function ModeChip({
  family,
  label,
  className
}: {
  family: ModeProfile["family"];
  label: string;
  className?: string;
}) {
  return <span className={cn("inline-flex items-center rounded-full px-3 py-1.5 text-xs", toneMap[family], className)}>{label}</span>;
}

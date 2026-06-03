import { cn } from "@/lib/utils";

export function Spinner({
  className,
  tone = "primary"
}: {
  className?: string;
  tone?: "primary" | "subtle" | "psyche";
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-4 rounded-full border border-[var(--ui-border-strong)] border-t-transparent bg-[conic-gradient(from_180deg_at_50%_50%,transparent,color-mix(in_srgb,var(--ui-ink-strong)_34%,transparent),transparent)] align-middle motion-safe:animate-spin",
        tone === "primary" && "shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_22%,transparent)]",
        tone === "subtle" && "opacity-80 shadow-[0_0_0_1px_var(--ui-border-subtle)]",
        tone === "psyche" && "shadow-[0_0_0_1px_color-mix(in_srgb,var(--secondary)_22%,transparent)]",
        className
      )}
    />
  );
}

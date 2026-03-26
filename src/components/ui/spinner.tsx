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
        "inline-block size-4 rounded-full border border-white/14 border-t-transparent bg-[conic-gradient(from_180deg_at_50%_50%,rgba(255,255,255,0.02),rgba(255,255,255,0.34),rgba(255,255,255,0.02))] align-middle motion-safe:animate-spin",
        tone === "primary" && "shadow-[0_0_0_1px_rgba(192,193,255,0.22)]",
        tone === "subtle" && "opacity-80 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]",
        tone === "psyche" && "shadow-[0_0_0_1px_rgba(110,231,183,0.2)]",
        className
      )}
    />
  );
}

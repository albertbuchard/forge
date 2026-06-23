import { Check, Sparkles } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export function MutationInlineState({
  state,
  idleLabel,
  pendingLabel,
  successLabel,
  className
}: {
  state: "idle" | "pending" | "success";
  idleLabel: string;
  pendingLabel: string;
  successLabel: string;
  className?: string;
}) {
  const tone =
    state === "success"
      ? "text-emerald-200"
      : state === "pending"
        ? "text-white/78"
        : "text-white/48";

  return (
    <div className={cn("inline-flex min-h-10 items-center gap-2 rounded-full bg-white/[0.04] px-3 py-2", tone, className)}>
      {state === "pending" ? <Spinner className="size-3.5" tone="subtle" /> : null}
      {state === "success" ? <Check className="size-3.5" /> : null}
      {state === "idle" ? <Sparkles className="size-3.5 opacity-70" /> : null}
      <span className="type-meta">{state === "pending" ? pendingLabel : state === "success" ? successLabel : idleLabel}</span>
    </div>
  );
}

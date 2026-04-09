import type { ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-w-0 max-w-full items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-[var(--radius-control)] font-medium leading-none transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(192,193,255,0.45)] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:
          "border border-[var(--primary)]/14 bg-[var(--ui-accent-soft)] text-[var(--ui-ink-on-accent)] shadow-[var(--ui-shadow-soft)] hover:bg-[var(--ui-accent-soft-hover)]",
        secondary:
          "border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-strong)] hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)]",
        ghost:
          "border border-transparent bg-transparent text-[var(--primary)] hover:bg-[var(--ui-surface-1)]"
      },
      size: {
        sm: "min-h-[2.125rem] px-2.5 py-[0.4375rem] text-[13px]",
        md: "interactive-tap min-h-10 px-3 py-2 text-[13px]",
        lg: "min-h-11 px-4 py-2.5 text-sm"
      }
    },
    defaultVariants: {
      variant: "primary",
      size: "md"
    }
  }
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    pending?: boolean;
    pendingLabel?: string;
  };

export function Button({ className, variant, size, pending = false, pendingLabel, children, disabled, ...props }: ButtonProps) {
  return (
    <button className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || pending} aria-busy={pending} {...props}>
      {pending ? <Spinner className="size-3.5" tone="subtle" /> : null}
      <span className="inline-flex min-w-0 max-w-full items-center gap-2 overflow-hidden truncate whitespace-nowrap">
        {pending && pendingLabel ? pendingLabel : children}
      </span>
    </button>
  );
}

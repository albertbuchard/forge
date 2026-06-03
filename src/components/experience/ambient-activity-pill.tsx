import { motion } from "framer-motion";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function AmbientActivityPill({
  active,
  label,
  className,
  onClick
}: {
  active: boolean;
  label: string;
  className?: string;
  onClick?: () => void;
}) {
  const { t } = useI18n();
  return (
    <motion.button
      type="button"
      initial={false}
      animate={{
        opacity: active ? 1 : 0.55,
        y: 0,
        scale: active ? 1 : 0.98
      }}
      transition={{ duration: 0.24, ease: "easeOut" }}
      onClick={onClick}
      className={cn(
        "surface-pulse ambient-glow inline-flex min-h-11 shrink-0 items-center gap-2.5 rounded-full border border-[var(--ui-border-subtle)] px-4 py-2 text-left shadow-[var(--ui-shadow-soft)] backdrop-blur-xl transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)]",
        onClick ? "cursor-pointer" : "cursor-default",
        className
      )}
      aria-live="polite"
      aria-label={`${t("common.labels.backgroundActivity")}: ${label}`}
    >
      <Spinner
        tone="subtle"
        className={active ? "opacity-100" : "opacity-45"}
      />
      <div className="inline-flex min-w-0 max-w-full items-center gap-2 whitespace-nowrap">
        <span className="type-label hidden text-[var(--ui-ink-soft)] sm:inline">
          {t("common.labels.backgroundActivity")}
        </span>
        <span className="hidden text-[var(--ui-ink-faint)] sm:inline">•</span>
        <span className="truncate text-sm text-[var(--ui-ink-medium)]">{label}</span>
      </div>
    </motion.button>
  );
}

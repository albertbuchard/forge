import { motion } from "framer-motion";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function AmbientActivityPill({
  active,
  label,
  className
}: {
  active: boolean;
  label: string;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <motion.div
      initial={false}
      animate={{
        opacity: active ? 1 : 0.55,
        y: 0,
        scale: active ? 1 : 0.98
      }}
      transition={{ duration: 0.24, ease: "easeOut" }}
      className={cn(
        "surface-pulse ambient-glow inline-flex min-h-11 shrink-0 items-center gap-2.5 rounded-full border border-white/8 px-4 py-2 text-left shadow-[0_18px_40px_rgba(3,8,18,0.22)] backdrop-blur-xl",
        className
      )}
      aria-live="polite"
    >
      <Spinner tone="subtle" className={active ? "opacity-100" : "opacity-45"} />
      <div className="inline-flex min-w-0 items-center gap-2 whitespace-nowrap">
        <span className="type-label text-white/56">{t("common.labels.backgroundActivity")}</span>
        <span className="text-white/30">•</span>
        <span className="truncate text-sm text-white/80">{label}</span>
      </div>
    </motion.div>
  );
}

import { cn } from "@/lib/utils";
import { getSchemaTypeLabel, getSchemaVisual, type SchemaType } from "@/lib/schema-visuals";

export function SchemaBadge({
  label,
  schemaType,
  compact = false,
  showType = false,
  className
}: {
  label: string;
  schemaType: SchemaType;
  compact?: boolean;
  showType?: boolean;
  className?: string;
}) {
  const visual = getSchemaVisual(schemaType);

  return (
    <span
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm leading-tight shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
        compact ? "min-h-8" : "min-h-9",
        visual.badgeTone,
        className
      )}
    >
      {showType ? <span className="text-[11px] uppercase tracking-[0.16em] text-white/58">{getSchemaTypeLabel(schemaType)}</span> : null}
      <span className="min-w-0 break-words whitespace-normal">{label}</span>
    </span>
  );
}

import { SettingsStateFrame } from "@/components/settings/settings-section-nav";
import { Card } from "@/components/ui/card";

export function SettingsOwnerBoundary({
  title,
  description
}: {
  title: string;
  description: string;
}) {
  return (
    <SettingsStateFrame>
      <Card className="grid gap-3 p-5">
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
          Local owner access
        </div>
        <h1 className="text-xl font-semibold text-[var(--ui-ink-strong)]">
          {title}
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-[var(--ui-ink-soft)]">
          {description}
        </p>
        <p className="max-w-3xl text-sm leading-6 text-[var(--ui-ink-soft)]">
          This paired browser remains connected for everyday Forge work. Open
          Forge on the host machine when you need this protected operation.
        </p>
      </Card>
    </SettingsStateFrame>
  );
}

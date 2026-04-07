import { Button } from "@/components/ui/button";
import type { SurfaceMode } from "@/lib/surface-mode";

export function SurfaceModeToggle({
  mode,
  onModeChange
}: {
  mode: SurfaceMode;
  onModeChange: (mode: SurfaceMode) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-white/8 bg-white/[0.04] p-1">
      <Button
        type="button"
        size="sm"
        variant={mode === "default" ? "primary" : "ghost"}
        className="min-w-[6rem]"
        onClick={() => onModeChange("default")}
      >
        Default view
      </Button>
      <Button
        type="button"
        size="sm"
        variant={mode === "custom" ? "primary" : "ghost"}
        className="min-w-[6rem]"
        onClick={() => onModeChange("custom")}
      >
        Custom view
      </Button>
    </div>
  );
}

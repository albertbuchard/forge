import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

type DemoStatus = {
  sampleData: true;
  isolatedSession: true;
  resettable: true;
  expiresAt: string;
};
const DEMO_CAPABILITY_HEADER = "x-forge-demo";
const DEMO_CAPABILITY_VALUE = "isolated";

export function DemoBanner() {
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const healthResponse = await fetch("/api/health", {
        signal: controller.signal,
        credentials: "same-origin"
      });
      if (
        !healthResponse.ok ||
        healthResponse.headers.get(DEMO_CAPABILITY_HEADER) !==
          DEMO_CAPABILITY_VALUE
      ) {
        return;
      }
      const statusResponse = await fetch("/api/v1/demo/status", {
        signal: controller.signal,
        credentials: "same-origin"
      });
      if (!statusResponse.ok) return;
      const payload = (await statusResponse.json()) as { demo: DemoStatus };
      if (!controller.signal.aborted) setStatus(payload.demo);
    })().catch(() => undefined);
    return () => controller.abort();
  }, []);

  if (!status) return null;
  return (
    <aside
      className="sticky top-0 z-[100] flex min-h-12 flex-wrap items-center justify-center gap-x-4 gap-y-2 border-b border-[color-mix(in_srgb,var(--primary)_35%,var(--ui-border-subtle))] bg-[var(--ui-accent-soft)] px-4 py-2 text-center text-sm"
      aria-label="Public demonstration notice"
    >
      <strong>Public demonstration · sample data only</strong>
      <span>
        Your isolated session expires at{" "}
        {new Date(status.expiresAt).toLocaleTimeString()} and cannot reach
        personal Forge data or external services.
      </span>
      <Button
        size="sm"
        variant="secondary"
        pending={resetting}
        pendingLabel="Resetting…"
        onClick={async () => {
          setResetting(true);
          const response = await fetch("/api/v1/demo/reset", {
            method: "POST",
            credentials: "same-origin"
          });
          if (response.ok) window.location.assign("/forge/");
          else setResetting(false);
        }}
      >
        <RotateCcw className="size-3.5" /> Reset sample
      </Button>
    </aside>
  );
}

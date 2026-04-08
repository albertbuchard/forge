import { useEffect } from "react";
import type { ForgeSnapshot, SettingsPayload } from "@/lib/types";
import { useHeartbeatTaskRunMutation } from "@/store/api/forge-api";

export function useShellTaskHeartbeat({
  snapshot,
  settings
}: {
  snapshot: ForgeSnapshot | undefined;
  settings: SettingsPayload | undefined;
}) {
  const [heartbeatTaskRun] = useHeartbeatTaskRunMutation();

  useEffect(() => {
    if (!snapshot || !settings || snapshot.activeTaskRuns.length === 0) {
      return;
    }

    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }

      for (const run of snapshot.activeTaskRuns) {
        void heartbeatTaskRun({
          runId: run.id,
          input: {
            actor: run.actor,
            leaseTtlSeconds: run.leaseTtlSeconds,
            note: run.note
          }
        }).unwrap().catch(() => undefined);
      }
    }, 30_000);

    return () => window.clearInterval(timer);
  }, [heartbeatTaskRun, settings, snapshot]);
}

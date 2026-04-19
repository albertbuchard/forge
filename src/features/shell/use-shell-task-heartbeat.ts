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

    const sendHeartbeats = () => {
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
    };

    const timer = window.setInterval(() => {
      sendHeartbeats();
    }, 30_000);

    const handleVisibilityChange = () => {
      sendHeartbeats();
    };
    const handleWindowFocus = () => {
      sendHeartbeats();
    };
    const handlePageHide = () => {
      sendHeartbeats();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [heartbeatTaskRun, settings, snapshot]);
}

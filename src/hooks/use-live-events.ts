import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { resolveForgePath } from "@/lib/runtime-paths";
import { forgeApi } from "@/store/api/forge-api";
import { appStore } from "@/store/store";

export function useLiveEvents() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const stream = new EventSource(resolveForgePath("/api/v1/events/stream"));
    const invalidate = () => {
      appStore.dispatch(
        forgeApi.util.invalidateTags([
          "OperatorSession",
          "Settings",
          "Snapshot",
          "Sleep",
          "Psyche",
          "WikiIngestJobs"
        ])
      );
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["forge-snapshot"] }),
        queryClient.invalidateQueries({ queryKey: ["task-context"] })
      ]);
    };

    stream.addEventListener("snapshot", invalidate);
    stream.addEventListener("activity", invalidate);

    stream.onerror = () => {
      stream.close();
    };

    return () => {
      stream.removeEventListener("snapshot", invalidate);
      stream.removeEventListener("activity", invalidate);
      stream.close();
    };
  }, [queryClient]);
}

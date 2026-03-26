import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { resolveForgePath } from "@/lib/runtime-paths";

export function useLiveEvents() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const stream = new EventSource(resolveForgePath("/api/v1/events/stream"));
    const invalidate = () => {
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

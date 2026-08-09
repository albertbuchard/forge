import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { resolveForgePath } from "@/lib/runtime-paths";
import { forgeApi } from "@/store/api/forge-api";
import { appStore } from "@/store/store";

export const LIVE_EVENT_RECONNECT_INITIAL_DELAY_MS = 5_000;
export const LIVE_EVENT_RECONNECT_MAX_DELAY_MS = 30_000;

export function useLiveEvents(enabled = true) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let disposed = false;
    let retryAttempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let activeStream: EventSource | null = null;
    const invalidate = () => {
      appStore.dispatch(
        forgeApi.util.invalidateTags([
          "OperatorSession",
          "Settings",
          "Snapshot",
          "Gamification",
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

    const closeStream = (stream: EventSource) => {
      stream.removeEventListener("snapshot", invalidate);
      stream.removeEventListener("activity", invalidate);
      stream.onopen = null;
      stream.onerror = null;
      stream.close();
    };

    const connect = () => {
      if (disposed || activeStream || retryTimer) {
        return;
      }
      const stream = new EventSource(resolveForgePath("/api/v1/events/stream"));
      activeStream = stream;
      stream.addEventListener("snapshot", invalidate);
      stream.addEventListener("activity", invalidate);

      stream.onopen = () => {
        if (activeStream === stream) {
          retryAttempt = 0;
        }
      };

      stream.onerror = () => {
        if (activeStream !== stream) {
          return;
        }
        activeStream = null;
        closeStream(stream);
        if (disposed || retryTimer) {
          return;
        }
        const delay = Math.min(
          LIVE_EVENT_RECONNECT_INITIAL_DELAY_MS * 2 ** retryAttempt,
          LIVE_EVENT_RECONNECT_MAX_DELAY_MS
        );
        retryAttempt = Math.min(
          retryAttempt + 1,
          Math.ceil(
            Math.log2(
              LIVE_EVENT_RECONNECT_MAX_DELAY_MS /
                LIVE_EVENT_RECONNECT_INITIAL_DELAY_MS
            )
          )
        );
        retryTimer = setTimeout(() => {
          retryTimer = null;
          connect();
        }, delay);
      };
    };

    connect();

    return () => {
      disposed = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (activeStream) {
        const stream = activeStream;
        activeStream = null;
        closeStream(stream);
      }
    };
  }, [enabled, queryClient]);
}

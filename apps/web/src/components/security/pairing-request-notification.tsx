import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { BellRing, ChevronRight } from "lucide-react";

import { listRemotePairingRequests } from "@/lib/api";

export const REMOTE_PAIRING_REQUESTS_QUERY_KEY = [
  "forge-security-pairing-requests"
] as const;

export function pairingRequestPollingInterval(
  visible: boolean,
  status: "pending" | "error" | "success"
) {
  if (!visible) return false;
  return status === "error" ? 15_000 : 3_000;
}

function useDocumentVisible() {
  const [visible, setVisible] = useState(
    () =>
      typeof document === "undefined" || document.visibilityState === "visible"
  );

  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  return visible;
}

export function useRemotePairingRequests(enabled: boolean) {
  const visible = useDocumentVisible();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: REMOTE_PAIRING_REQUESTS_QUERY_KEY,
    queryFn: listRemotePairingRequests,
    enabled,
    refetchInterval: (state) =>
      pairingRequestPollingInterval(visible, state.state.status),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    staleTime: 1_000
  });

  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      void queryClient.invalidateQueries({
        queryKey: REMOTE_PAIRING_REQUESTS_QUERY_KEY
      });
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [enabled, queryClient]);

  return query;
}

export function PairingRequestNotification({ enabled }: { enabled: boolean }) {
  const pairingRequestsQuery = useRemotePairingRequests(enabled);
  const pending =
    pairingRequestsQuery.data?.requests.filter(
      (request) => request.status === "pending"
    ) ?? [];

  if (!enabled || pending.length === 0) {
    return null;
  }

  const newest = pending[0];
  return (
    <div
      className="pointer-events-none fixed inset-x-3 top-3 z-[80] flex justify-center sm:inset-x-auto sm:right-5 sm:top-5 sm:justify-end"
      aria-live="polite"
      aria-atomic="true"
    >
      <Link
        to="/settings/agents#pending-pairings"
        className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-[18px] border border-[color-mix(in_srgb,var(--warning)_36%,var(--ui-border-subtle)_64%)] bg-[color-mix(in_srgb,var(--ui-surface-1)_94%,var(--warning)_6%)] px-4 py-3 text-left shadow-[0_18px_48px_rgba(15,23,42,0.22)] outline-none transition hover:border-[color-mix(in_srgb,var(--warning)_54%,var(--ui-border-subtle)_46%)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--ui-warning-soft)] text-[var(--warning)]">
          <BellRing className="size-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-[var(--ui-ink-strong)]">
            {pending.length === 1
              ? "New pairing request"
              : `${pending.length} pairing requests`}
          </span>
          <span className="mt-0.5 block truncate text-sm text-[var(--ui-ink-muted)]">
            {newest?.clientName ?? "A device"} is waiting for your code
          </span>
        </span>
        <ChevronRight
          className="size-5 shrink-0 text-[var(--ui-ink-muted)]"
          aria-hidden="true"
        />
      </Link>
    </div>
  );
}

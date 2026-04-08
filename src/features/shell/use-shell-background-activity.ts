import { useMemo } from "react";
import type { TranslationKey } from "@/lib/i18n";
import type { WikiIngestJobPayload } from "@/lib/types";
import { useListWikiIngestJobsQuery } from "@/store/api/forge-api";

export function useShellBackgroundActivity({
  backgroundActivityOpen,
  fetchingCount,
  mutatingCount,
  t
}: {
  backgroundActivityOpen: boolean;
  fetchingCount: number;
  mutatingCount: number;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
}) {
  const ingestJobsQuery = useListWikiIngestJobsQuery(undefined, {
    pollingInterval: backgroundActivityOpen ? 2000 : 15000,
    refetchOnFocus: true,
    refetchOnReconnect: true
  });

  const recentIngestJobs = ingestJobsQuery.data?.jobs ?? [];
  const hasActiveIngestJobs = recentIngestJobs.some((job) =>
    ["queued", "processing"].includes(job.job.status)
  );

  const activeIngestJobs = useMemo(
    () =>
      recentIngestJobs.filter((job) =>
        ["queued", "processing"].includes(job.job.status)
      ),
    [recentIngestJobs]
  );

  const activityLabel = useMemo(() => {
    if (activeIngestJobs.length > 0) {
      if (activeIngestJobs.length === 1) {
        const job = activeIngestJobs[0] as WikiIngestJobPayload | undefined;
        return job?.job.latestMessage || job?.job.titleHint || "1 ingest running";
      }
      return `${activeIngestJobs.length} ingest jobs running`;
    }

    if (mutatingCount > 0) {
      return t(
        mutatingCount === 1
          ? "common.shell.savingOne"
          : "common.shell.savingOther",
        { count: mutatingCount }
      );
    }

    if (fetchingCount > 0) {
      return t(
        fetchingCount === 1
          ? "common.shell.refreshingOne"
          : "common.shell.refreshingOther",
        { count: fetchingCount }
      );
    }

    return t("common.shell.settled");
  }, [activeIngestJobs, fetchingCount, mutatingCount, t]);

  return {
    activityLabel,
    hasActiveIngestJobs,
    ingestJobsQuery,
    recentIngestJobs
  };
}

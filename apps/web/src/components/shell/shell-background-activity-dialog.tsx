import * as Dialog from "@radix-ui/react-dialog";
import { Link } from "react-router-dom";
import { RefreshCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import {
  shellDialogContentClassName,
  shellDialogDescriptionClassName,
  shellDialogOverlayClassName,
  shellDialogTitleClassName
} from "@/components/shell/shell-style-tokens";
import type { WikiIngestJobPayload } from "@/lib/types";
import { cn } from "@/lib/utils";

function getWikiIngestRoute(job: WikiIngestJobPayload) {
  const search = new URLSearchParams();
  if (job.job.spaceId) {
    search.set("spaceId", job.job.spaceId);
  }
  search.set("ingest", "1");
  search.set("ingestJobId", job.job.id);
  return {
    pathname: "/wiki",
    search: `?${search.toString()}`
  };
}

function formatActivityTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function ShellBackgroundActivityDialog({
  open,
  onOpenChange,
  isLoading,
  isError,
  error,
  onRetry,
  recentIngestJobs
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  recentIngestJobs: WikiIngestJobPayload[];
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={shellDialogOverlayClassName} />
        <Dialog.Content
          className={cn(
            shellDialogContentClassName,
            "top-[10vh] w-[min(42rem,calc(100vw-1.5rem))]"
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className={shellDialogTitleClassName}>
                Background activity
              </Dialog.Title>
              <Dialog.Description className={shellDialogDescriptionClassName}>
                Follow active KarpaWiki ingest jobs and reopen completed reviews
                without leaving your current context.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <ModalCloseButton aria-label="Close background activity dialog" />
            </Dialog.Close>
          </div>

          <div className="mt-4 max-h-[65vh] overflow-y-auto">
            {isLoading ? (
              <LoadingState
                eyebrow="Background"
                title="Loading activity"
                description="Checking the latest queued and completed ingest jobs."
              />
            ) : isError ? (
              <ErrorState
                eyebrow="Background"
                error={error}
                onRetry={onRetry}
              />
            ) : recentIngestJobs.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-[var(--ui-border-strong)] px-4 py-10 text-center text-[13px] leading-6 text-[var(--ui-ink-faint)]">
                No background ingest jobs yet.
              </div>
            ) : (
              <div className="grid gap-3">
                {recentIngestJobs.map((job) => {
                  const activeJob = ["queued", "processing"].includes(
                    job.job.status
                  );
                  return (
                    <Link
                      key={job.job.id}
                      to={getWikiIngestRoute(job)}
                      onClick={() => onOpenChange(false)}
                      className="rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-4 transition hover:bg-[var(--ui-surface-hover)]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                            KarpaWiki ingest
                          </div>
                          <div className="mt-2 text-[14px] font-semibold text-[var(--ui-ink-strong)]">
                            {job.job.titleHint ||
                              job.job.latestMessage ||
                              "Background ingest"}
                          </div>
                          <div className="mt-1 text-[12px] leading-5 text-[var(--ui-ink-soft)]">
                            {job.job.status} · {job.job.phase} ·{" "}
                            {job.job.progressPercent}% ·{" "}
                            {formatActivityTimestamp(job.job.updatedAt)}
                          </div>
                          <div className="mt-2 text-[12px] leading-5 text-[var(--ui-ink-faint)]">
                            {job.job.createdPageCount} pages ·{" "}
                            {job.job.createdEntityCount} entities ·{" "}
                            {job.job.acceptedCount} accepted ·{" "}
                            {job.job.rejectedCount} rejected
                          </div>
                        </div>
                        <div className="shrink-0">
                          {activeJob ? (
                            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 py-2 text-xs text-[var(--ui-ink-soft)]">
                              <RefreshCcw className="size-3.5 animate-spin" />
                              Running
                            </div>
                          ) : (
                            <Badge tone="meta">{job.job.phase}</Badge>
                          )}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

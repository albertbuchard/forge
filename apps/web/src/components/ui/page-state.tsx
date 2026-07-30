import type { ReactNode } from "react";
import { RefreshCcw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { describeApiError } from "@/lib/api-error";
import { useI18n } from "@/lib/i18n";

export function LoadingState({
  eyebrow,
  title,
  description
}: {
  eyebrow?: string;
  title?: string;
  description?: string;
}) {
  const { t } = useI18n();
  return (
    <Card
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="surface-pulse ambient-glow mx-auto grid max-w-2xl gap-4 text-center"
    >
      <div className="type-label text-[var(--ui-ink-faint)]">
        {eyebrow ?? t("common.labels.loading")}
      </div>
      <div className="type-display-section text-[var(--ui-ink-strong)]">
        {title ?? t("common.pageState.loadingTitle")}
      </div>
      <p className="type-body mx-auto max-w-xl text-[var(--ui-ink-soft)]">
        {description ?? t("common.pageState.loadingDescription")}
      </p>
      <div className="mx-auto flex min-h-11 items-center gap-3 rounded-full bg-[var(--ui-surface-2)] px-4 py-3 text-[var(--ui-ink-soft)]">
        <Spinner tone="subtle" className="size-3.5" />
        <span className="type-meta">{t("common.labels.syncInProgress")}</span>
      </div>
    </Card>
  );
}

export function ErrorState({
  error,
  onRetry,
  retryHref,
  retryLabel,
  eyebrow
}: {
  error: unknown;
  onRetry?: () => void;
  retryHref?: string;
  retryLabel?: string;
  eyebrow?: string;
}) {
  const { t } = useI18n();
  const { title, description, code } = describeApiError(error);

  return (
    <Card
      role="alert"
      aria-live="assertive"
      className="mx-auto grid max-w-2xl gap-4"
    >
      <div className="type-label text-[var(--danger)]">
        {eyebrow ?? t("common.labels.connectionState")}
      </div>
      <div className="type-display-section text-[var(--ui-ink-strong)]">
        {title}
      </div>
      <p className="type-body text-[var(--ui-ink-soft)]">{description}</p>
      <div className="type-meta text-[var(--ui-ink-faint)]">
        {t("common.labels.errorCode", { code })}
      </div>
      {onRetry ? (
        <div className="flex flex-wrap gap-3">
          {retryHref ? (
            <a
              className={buttonVariants({ variant: "secondary" })}
              href={retryHref}
              rel="noreferrer"
              onClick={(event) => {
                event.preventDefault();
                onRetry();
              }}
            >
              <RefreshCcw className="mr-2 size-4" />
              {retryLabel ?? t("common.actions.retry")}
            </a>
          ) : (
            <Button type="button" variant="secondary" onClick={onRetry}>
              <RefreshCcw className="mr-2 size-4" />
              {retryLabel ?? t("common.actions.retry")}
            </Button>
          )}
        </div>
      ) : null}
    </Card>
  );
}

export function EmptyState({
  eyebrow,
  title,
  description,
  action
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Card
      role="status"
      aria-live="polite"
      className="mx-auto grid max-w-2xl gap-4 text-center"
    >
      <div className="type-label text-[var(--ui-ink-faint)]">
        {eyebrow ?? t("common.labels.empty")}
      </div>
      <div className="type-display-section text-[var(--ui-ink-strong)]">
        {title}
      </div>
      <p className="type-body mx-auto max-w-xl text-[var(--ui-ink-soft)]">
        {description}
      </p>
      {action ? <div className="flex justify-center">{action}</div> : null}
    </Card>
  );
}

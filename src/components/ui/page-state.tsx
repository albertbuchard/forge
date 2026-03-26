import type { ReactNode } from "react";
import { RefreshCcw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
    <Card className="surface-pulse ambient-glow mx-auto grid max-w-2xl gap-4 text-center">
      <div className="type-label text-white/40">{eyebrow ?? t("common.labels.loading")}</div>
      <div className="type-display-section text-white">{title ?? t("common.pageState.loadingTitle")}</div>
      <p className="type-body mx-auto max-w-xl text-white/60">{description ?? t("common.pageState.loadingDescription")}</p>
      <div className="mx-auto flex min-h-11 items-center gap-3 rounded-full bg-white/[0.05] px-4 py-3 text-white/60">
        <Spinner tone="subtle" className="size-3.5" />
        <span className="type-meta">{t("common.labels.syncInProgress")}</span>
      </div>
    </Card>
  );
}

export function ErrorState({
  error,
  onRetry,
  eyebrow
}: {
  error: unknown;
  onRetry?: () => void;
  eyebrow?: string;
}) {
  const { t } = useI18n();
  const { title, description, code } = describeApiError(error);

  return (
    <Card className="mx-auto grid max-w-2xl gap-4">
      <div className="type-label text-rose-200/72">{eyebrow ?? t("common.labels.connectionState")}</div>
      <div className="type-display-section text-white">{title}</div>
      <p className="type-body text-white/62">{description}</p>
      <div className="type-meta text-white/40">{t("common.labels.errorCode", { code })}</div>
      {onRetry ? (
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="secondary" onClick={onRetry}>
            <RefreshCcw className="mr-2 size-4" />
            {t("common.actions.retry")}
          </Button>
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
    <Card className="mx-auto grid max-w-2xl gap-4 text-center">
      <div className="type-label text-white/38">{eyebrow ?? t("common.labels.loading")}</div>
      <div className="type-display-section text-white">{title}</div>
      <p className="type-body mx-auto max-w-xl text-white/60">{description}</p>
      {action ? <div className="flex justify-center">{action}</div> : null}
    </Card>
  );
}

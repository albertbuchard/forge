import { useEffect, useRef } from "react";
import { ArrowLeft, CircleCheck } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";

const ATTENTION_PATH = "/attention";
const LOCAL_URL_ORIGIN = "http://forge.local";
const MOBILE_SYNC_SOURCE_PATTERN =
  /^health_mobile_sync_session:([a-zA-Z0-9][a-zA-Z0-9_-]{0,127})$/;

export function safeAttentionReturnHref(value: string | null | undefined) {
  const candidate = value?.trim();
  if (!candidate || candidate.length > 2_048) {
    return ATTENTION_PATH;
  }
  try {
    const parsed = new URL(candidate, LOCAL_URL_ORIGIN);
    if (
      parsed.origin !== LOCAL_URL_ORIGIN ||
      parsed.username ||
      parsed.password ||
      (parsed.pathname !== ATTENTION_PATH &&
        parsed.pathname !== `${ATTENTION_PATH}/`)
    ) {
      return ATTENTION_PATH;
    }
    return `${ATTENTION_PATH}${parsed.search}${parsed.hash}`;
  } catch {
    return ATTENTION_PATH;
  }
}

export function readMobileSyncAttentionSourceRef(
  value: string | null | undefined
) {
  const match = value?.match(MOBILE_SYNC_SOURCE_PATTERN);
  return match
    ? {
        sourceRef: match[0],
        sessionId: match[1]!
      }
    : null;
}

export function AttentionSourceReturn({
  sourceRef,
  sourceLabel,
  className
}: {
  sourceRef: string;
  sourceLabel?: string;
  className?: string;
}) {
  const [searchParams] = useSearchParams();
  const target = searchParams.get("attentionSource");
  const containerRef = useRef<HTMLDivElement>(null);
  const active = target === sourceRef;

  useEffect(() => {
    if (!active) {
      return;
    }
    const container = containerRef.current;
    container?.focus({ preventScroll: true });
    container?.scrollIntoView?.({ block: "center" });
  }, [active]);

  if (!active) {
    return null;
  }

  const returnHref = safeAttentionReturnHref(
    searchParams.get("attentionReturn")
  );
  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      data-attention-source={sourceRef}
      className={cn(
        "mb-4 flex min-w-0 flex-col gap-3 rounded-[var(--radius-control)] border border-[var(--ui-success-border)] bg-[var(--ui-success-soft)] px-4 py-3 text-sm text-[var(--ui-ink-medium)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)] sm:flex-row sm:items-center sm:justify-between",
        className
      )}
    >
      <span role="status" className="flex min-w-0 items-start gap-2">
        <CircleCheck
          className="mt-0.5 size-4 shrink-0 text-[var(--success)]"
          aria-hidden="true"
        />
        <span>
          Opened from Attention{sourceLabel ? ` for ${sourceLabel}` : ""}.
          Complete the source action here, then return so Forge can check the
          result.
        </span>
      </span>
      <Link
        to={returnHref}
        className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 py-2 font-medium text-[var(--ui-ink-strong)] transition hover:bg-[var(--ui-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Return to Attention
      </Link>
    </div>
  );
}

export function MobileSyncAttentionSourceReturn({
  className
}: {
  className?: string;
}) {
  const [searchParams] = useSearchParams();
  const source = readMobileSyncAttentionSourceRef(
    searchParams.get("attentionSource")
  );
  if (!source) {
    return null;
  }
  return (
    <AttentionSourceReturn
      sourceRef={source.sourceRef}
      sourceLabel={`companion sync session ${source.sessionId}`}
      className={className}
    />
  );
}

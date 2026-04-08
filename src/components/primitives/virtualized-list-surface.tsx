import type { ReactNode, RefObject } from "react";
import { Card } from "@/components/ui/card";

export function VirtualizedListSurface({
  title,
  description,
  summary,
  listRef,
  heightClassName = "h-[34rem]",
  emptyState,
  children
}: {
  title: ReactNode;
  description: ReactNode;
  summary?: ReactNode;
  listRef: RefObject<HTMLDivElement | null>;
  heightClassName?: string;
  emptyState?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            {title}
          </div>
          <div className="mt-2 text-lg text-white">{description}</div>
        </div>
        {summary ? <div className="shrink-0">{summary}</div> : null}
      </div>

      <div
        ref={listRef}
        className={`${heightClassName} overflow-y-auto rounded-[24px] border border-white/8 bg-white/[0.03]`}
      >
        {emptyState ? emptyState : children}
      </div>
    </Card>
  );
}

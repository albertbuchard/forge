import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

const DEFAULT_PAGE_SIZE = 20;

export function PeopleProgressiveList<T>({
  items,
  getKey,
  renderItem,
  resetKey,
  label,
  className,
  ordered = false,
  pageSize = DEFAULT_PAGE_SIZE
}: {
  items: readonly T[];
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  resetKey: string;
  label: string;
  className?: string;
  ordered?: boolean;
  pageSize?: number;
}) {
  const boundedPageSize = Math.max(1, pageSize);
  const [visibleCount, setVisibleCount] = useState(boundedPageSize);
  const List = ordered ? "ol" : "ul";

  useEffect(() => {
    setVisibleCount(boundedPageSize);
  }, [boundedPageSize, resetKey]);

  const visibleItems = items.slice(0, visibleCount);
  const remainingCount = items.length - visibleItems.length;

  return (
    <>
      <List className={className}>
        {visibleItems.map((item) => (
          <Fragment key={getKey(item)}>{renderItem(item)}</Fragment>
        ))}
      </List>
      {remainingCount > 0 ? (
        <div className="mt-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
          <p role="status" className="text-xs text-[var(--ui-ink-muted)]">
            Showing {visibleItems.length} of {items.length} {label}.
          </p>
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            onClick={() =>
              setVisibleCount((current) =>
                Math.min(items.length, current + boundedPageSize)
              )
            }
          >
            Show {Math.min(boundedPageSize, remainingCount)} more
          </Button>
        </div>
      ) : null}
    </>
  );
}

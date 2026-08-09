import { Link } from "react-router-dom";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable
} from "@tanstack/react-table";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UserBadge } from "@/components/ui/user-badge";
import {
  getReadableActivityDescription,
  getReadableActivityTitle
} from "@/lib/activity-copy";
import { getActivityEventHref } from "@/lib/entity-links";
import { formatDateTime } from "@/lib/utils";
import type { ActivityEvent } from "@/lib/types";

const columnHelper = createColumnHelper<ActivityEvent>();

const columns = [
  columnHelper.accessor("title", {
    header: "Event",
    cell: (info) => {
      const href = getActivityEventHref(info.row.original);
      return href ? (
        <Link
          to={href}
          className="-mx-2 inline-flex min-h-11 items-center px-2 font-medium text-[var(--ui-ink-strong)] transition hover:text-[var(--primary)]"
        >
          {getReadableActivityTitle(info.row.original)}
        </Link>
      ) : (
        <div className="font-medium text-[var(--ui-ink-strong)]">
          {getReadableActivityTitle(info.row.original)}
        </div>
      );
    }
  }),
  columnHelper.accessor("source", {
    header: "Source",
    cell: (info) => (
      <div className="font-label text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
        {info.getValue()}
      </div>
    )
  }),
  columnHelper.display({
    id: "owner",
    header: "Owner",
    cell: (info) =>
      info.row.original.user ? (
        <UserBadge user={info.row.original.user} compact />
      ) : (
        <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
          Unowned
        </div>
      )
  }),
  columnHelper.accessor("createdAt", {
    header: "When",
    cell: (info) => (
      <div className="text-sm text-[var(--ui-ink-soft)]">
        {formatDateTime(info.getValue())}
      </div>
    )
  }),
  columnHelper.display({
    id: "actions",
    header: "Open",
    cell: (info) => {
      const href = getActivityEventHref(info.row.original);
      return href ? (
        <Link
          to={href}
          className="-mx-2 inline-flex min-h-11 items-center px-2 text-[11px] uppercase tracking-[0.16em] text-[var(--primary)] transition hover:text-[var(--ui-ink-strong)]"
        >
          Open
        </Link>
      ) : (
        <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
          Archive only
        </div>
      );
    }
  })
];

export function ActivityTable({
  rows,
  onRemove,
  removingEventId
}: {
  rows: ActivityEvent[];
  onRemove?: (eventId: string) => Promise<void>;
  removingEventId?: string | null;
}) {
  const actionColumns = onRemove
    ? [
        ...columns,
        columnHelper.display({
          id: "remove",
          header: "Correct",
          cell: (info) => (
            <Button
              variant="ghost"
              className="min-h-11 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-soft)]"
              pending={removingEventId === info.row.original.id}
              aria-label={`Remove ${getReadableActivityTitle(info.row.original)} from visible activity`}
              onClick={() => {
                void onRemove(info.row.original.id).catch(() => undefined);
              }}
            >
              Remove log
            </Button>
          )
        })
      ]
    : columns;

  const table = useReactTable({
    columns: actionColumns,
    data: rows,
    getCoreRowModel: getCoreRowModel()
  });

  return (
    <Card className="min-w-0 overflow-hidden p-0">
      <table className="hidden w-full border-collapse md:table">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="bg-[var(--ui-surface-2)]">
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className="px-5 py-4 text-left font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]"
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              className="border-t border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] transition hover:bg-[var(--ui-surface-hover)]"
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-5 py-4 align-top">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid gap-3 p-3 md:hidden">
        {rows.map((event) => {
          const href = getActivityEventHref(event);
          return (
            <article
              key={event.id}
              className="min-w-0 rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4"
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                    {event.source}
                  </div>
                  <div className="mt-2 break-words text-sm font-semibold text-[var(--ui-ink-strong)]">
                    {getReadableActivityTitle(event)}
                  </div>
                </div>
                {event.user ? <UserBadge user={event.user} compact /> : null}
              </div>
              <div className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
                {getReadableActivityDescription(event)}
              </div>
              <div className="mt-3 text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                {formatDateTime(event.createdAt)}
              </div>
              <div className="mt-3 flex flex-wrap gap-3">
                {href ? (
                  <Link
                    to={href}
                    className="-mx-2 inline-flex min-h-11 items-center px-2 text-[11px] uppercase tracking-[0.16em] text-[var(--primary)] transition hover:text-[var(--ui-ink-strong)]"
                  >
                    Open
                  </Link>
                ) : null}
                {onRemove ? (
                  <Button
                    variant="ghost"
                    className="min-h-11 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-soft)]"
                    pending={removingEventId === event.id}
                    aria-label={`Remove ${getReadableActivityTitle(event)} from visible activity`}
                    onClick={() => {
                      void onRemove(event.id).catch(() => undefined);
                    }}
                  >
                    Remove log
                  </Button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </Card>
  );
}

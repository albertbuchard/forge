import { Link } from "react-router-dom";
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
        <Link to={href} className="font-medium text-white transition hover:text-[var(--primary)]">
          {info.getValue()}
        </Link>
      ) : (
        <div className="font-medium text-white">{info.getValue()}</div>
      );
    }
  }),
  columnHelper.accessor("source", {
    header: "Source",
    cell: (info) => <div className="font-label text-[11px] uppercase tracking-[0.16em] text-white/50">{info.getValue()}</div>
  }),
  columnHelper.accessor("createdAt", {
    header: "When",
    cell: (info) => <div className="text-sm text-white/55">{formatDateTime(info.getValue())}</div>
  }),
  columnHelper.display({
    id: "actions",
    header: "Open",
    cell: (info) => {
      const href = getActivityEventHref(info.row.original);
      return href ? (
        <Link to={href} className="inline-flex text-[11px] uppercase tracking-[0.16em] text-[var(--primary)] transition hover:text-white">
          Open
        </Link>
      ) : (
        <div className="text-[11px] uppercase tracking-[0.16em] text-white/32">Archive only</div>
      );
    }
  })
];

export function ActivityTable({
  rows,
  onRemove
}: {
  rows: ActivityEvent[];
  onRemove?: (eventId: string) => Promise<void>;
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
              className="h-auto px-0 py-0 text-[11px] uppercase tracking-[0.16em] text-white/55"
              onClick={() => {
                void onRemove(info.row.original.id);
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
    <Card className="overflow-hidden p-0">
      <table className="w-full border-collapse">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="bg-white/[0.03]">
              {headerGroup.headers.map((header) => (
                <th key={header.id} className="px-5 py-4 text-left font-label text-[11px] uppercase tracking-[0.18em] text-white/40">
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="bg-white/[0.015] transition hover:bg-white/[0.035]">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-5 py-4 align-top">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

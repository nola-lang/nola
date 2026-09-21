import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { AskSummary } from "../api";
import { formatClock, formatDuration } from "../format";
import { withSearch } from "../search";
import { KindIcon } from "./kind-icon";
import { StatusDot } from "./status-dot";

const PAGE_SIZES = [10, 25, 50] as const;

const columns: ColumnDef<AskSummary>[] = [
  {
    id: "status",
    header: "",
    accessorKey: "status",
    enableSorting: false,
    cell: ({ row }) => <StatusDot status={row.original.status} />,
    size: 24,
  },
  {
    id: "site",
    header: "site",
    accessorFn: (ask) => ask.site ?? ask.askId,
    cell: ({ row, getValue }) => (
      <span className="flex min-w-0 items-center gap-1.5 font-mono text-xs" title={getValue<string>()}>
        <KindIcon kind={row.original.kind ?? "extract"} />
        <span className="truncate">{getValue<string>()}</span>
      </span>
    ),
  },
  {
    id: "at",
    header: "at",
    accessorKey: "startedAt",
    cell: ({ getValue }) => formatClock(getValue<number>()),
    size: 96,
  },
  {
    id: "duration",
    header: "duration",
    accessorKey: "durationMs",
    cell: ({ getValue }) => formatDuration(getValue<number | undefined>()),
    size: 96,
  },
  {
    id: "provider",
    header: "provider",
    accessorFn: (ask) => [ask.provider, ask.profile].filter(Boolean).join(" · ") || "—",
    size: 200,
  },
  {
    id: "attempts",
    header: "attempts",
    accessorKey: "attempts",
    cell: ({ getValue }) => getValue<number | undefined>() ?? "—",
    size: 96,
  },
];

/**
 * A definition's executions as a sortable, paginated grid. A row click opens
 * that ask (`?ask=`); clicking the open row closes it. Sort and page are
 * view state — the URL carries only the selection.
 *
 * The data is LIVE — it changes when an execution starts and again when it
 * ends — so nothing here may react to "the data changed": rows are keyed by
 * ask (not by index), the page stays where the reader put it, and the
 * columns have fixed widths (`site` takes the rest) so a cell going from
 * `—` to `420ms` cannot re-lay the grid.
 */
export function ExecutionsTable({ asks, selectedAskId }: { asks: AskSummary[]; selectedAskId?: string }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "at", desc: true }]);
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const table = useReactTable({
    data: asks,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getRowId: (ask) => ask.askId,
    autoResetPageIndex: false,
    initialState: { pagination: { pageSize: PAGE_SIZES[0] } },
  });
  const { pageIndex, pageSize } = table.getState().pagination;
  const pageCount = table.getPageCount();
  // the page no longer resets with the data, so a list that shrank under it (a narrower filter) pulls it back
  useEffect(() => {
    if (pageCount > 0 && pageIndex >= pageCount) table.setPageIndex(pageCount - 1);
  }, [pageCount, pageIndex, table]);

  return (
    <div className="overflow-hidden rounded-md">
      <Table className="table-fixed font-mono text-xs">
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                return (
                  <TableHead
                    key={header.id}
                    className="h-8 font-sans font-semibold text-[11px] text-muted-foreground uppercase tracking-[0.12em]"
                    style={header.column.columnDef.size ? { width: header.column.columnDef.size } : undefined}
                  >
                    {header.column.getCanSort() ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sorted === "asc" && <ArrowUp className="size-3" />}
                        {sorted === "desc" && <ArrowDown className="size-3" />}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => {
            const selected = row.original.askId === selectedAskId;
            return (
              <TableRow
                key={row.id}
                data-state={selected ? "selected" : undefined}
                className={cn("cursor-pointer hover:bg-card", selected && "bg-card shadow-[inset_2px_0_0_var(--primary)]")}
                onClick={() => navigate(withSearch(search, { ask: selected ? undefined : row.original.askId }))}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="overflow-hidden text-ellipsis py-2">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className="flex items-center gap-3 px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
        <span>
          {asks.length} execution{asks.length === 1 ? "" : "s"}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          rows
          <Select value={String(pageSize)} onValueChange={(v) => table.setPageSize(Number(v))}>
            <SelectTrigger size="sm" className="h-6 w-16 font-mono text-[11px]" aria-label="Rows per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((n) => (
                <SelectItem key={n} value={String(n)} className="font-mono text-xs">
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </span>
        <span>
          page {pageIndex + 1} of {Math.max(pageCount, 1)}
        </span>
        <span className="flex gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Previous page"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Next page"
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            <ChevronRight />
          </Button>
        </span>
      </div>
    </div>
  );
}

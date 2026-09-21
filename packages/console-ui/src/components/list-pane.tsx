import type { ReactNode } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";

/**
 * The master list on the left of every view: a small sticky status bar
 * naming the page (how many rows are showing, and the page's actions on the
 * right), then the rows scrolling inside a ScrollArea. Radix's viewport wraps children in a `display: table` div
 * that grows to its content, which would defeat the rows' `truncate` — so
 * it is forced to block width here.
 */
export function ListPane({
  title,
  count,
  actions,
  children,
}: {
  title: string;
  count?: number;
  /** the page's list-level actions, right-aligned in the status bar */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ScrollArea className="h-full w-full [&>[data-slot=scroll-area-viewport]>div]:block!">
      <h1 className="sticky top-0 z-20 m-0 flex items-center gap-2 bg-background py-1 pr-1.5 pl-3.5 font-sans font-semibold text-[11px] text-foreground/80 uppercase tracking-[0.12em]">
        {title}
        {count !== undefined && <span className="font-mono font-normal normal-case tracking-normal">{count}</span>}
        {actions !== undefined && <span className="ml-auto flex items-center gap-1 normal-case tracking-normal">{actions}</span>}
      </h1>
      <ol className="m-0 w-full min-w-0 list-none p-0">{children}</ol>
    </ScrollArea>
  );
}

import { Command as CommandPrimitive, useCommandState } from "cmdk";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { matchSegments } from "../palette";

/**
 * cmdk dressed as VS Code's quick pick: a flat inset input with no icon, tight
 * gap-less rows, a filled and outlined selected row, and the typed characters
 * lit up inside each label. The shadcn `Command` wrappers stay untouched —
 * their selected-row ground is the panel grey, invisible on the panel.
 */
export function Palette({ className, ...props }: ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      className={cn("flex w-full flex-col text-sm overflow-hidden bg-popover text-popover-foreground", className)}
      {...props}
    />
  );
}

export function PaletteInput({ className, ...props }: ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="p-2">
      <CommandPrimitive.Input
        className={cn(
          "h-7 w-full border border-input bg-background px-1.5 outline-none placeholder:text-muted-foreground rounded-md",
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function PaletteList({ className, ...props }: ComponentProps<typeof CommandPrimitive.List>) {
  return <CommandPrimitive.List className={cn("max-h-72 overflow-y-auto p-1", className)} {...props} />;
}

export function PaletteEmpty({ children = "No matching results", ...props }: ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty className="px-2 py-1 text-muted-foreground" {...props}>
      {children}
    </CommandPrimitive.Empty>
  );
}

/**
 * One row: an optional leading slot (a check mark), the highlighted label, a
 * muted description right after it, and a muted trailing column pinned to the
 * right edge where VS Code shows keybindings.
 */
export function PaletteItem({
  label,
  description,
  trailing,
  children,
  className,
  ...props
}: Omit<ComponentProps<typeof CommandPrimitive.Item>, "children"> & {
  label: string;
  description?: string;
  trailing?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <CommandPrimitive.Item
      value={label}
      className={cn(
        "flex h-7 cursor-pointer select-none items-center gap-1.5 px-2 outline-none rounded-md justify-between",
        "data-[selected=true]:bg-primary/15 data-[selected=true]:ring-0 data-[selected=true]:ring-inset",
        "data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    >
      {children}
      <Highlight text={label} />
      {description && <span className="truncate text-muted-foreground">{description}</span>}
      {trailing !== undefined && <span className="ml-auto shrink-0 pl-3 text-muted-foreground">{trailing}</span>}
    </CommandPrimitive.Item>
  );
}

function Highlight({ text }: { text: string }) {
  const query = useCommandState((s) => s.search);
  return (
    <span className="shrink-0 whitespace-pre font-semibold">
      {matchSegments(text, query).map((seg, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and re-derived on every query change
        <span key={i} className={seg.hit ? "font-medium text-primary" : undefined}>
          {seg.text}
        </span>
      ))}
    </span>
  );
}

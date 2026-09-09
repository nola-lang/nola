import { ArrowRightToLine, Braces, SquareFunction } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RecordKind } from "../api";

const ICON = { invocation: SquareFunction, extract: Braces, call: ArrowRightToLine } as const;
const TITLE: Record<RecordKind, string> = { invocation: "infer function call", extract: "extract", call: "call intent" };

/** The record's kind at a glance — replaces a text badge so rows stay narrow. */
export function KindIcon({ kind, className }: { kind: RecordKind; className?: string }) {
  const Icon = ICON[kind];
  return (
    <Icon
      className={cn("size-3.5 shrink-0 text-muted-foreground", className)}
      strokeWidth={1.75}
      aria-label={TITLE[kind]}
      role="img"
    />
  );
}

import { cn } from "@/lib/utils";
import type { AskStatus } from "../format";

const TONE: Record<AskStatus, string> = {
  running: "bg-live animate-pulse-dot motion-reduce:animate-none",
  ok: "bg-ok",
  error: "bg-err",
};

/** The 8px status dot every row and heading opens with. */
export function StatusDot({ status, className }: { status: AskStatus; className?: string }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", TONE[status], className)} aria-hidden />;
}

/** A definition's tone: red the moment any execution failed. */
export const errorTone = (errorCount: number): AskStatus => (errorCount > 0 ? "error" : "ok");

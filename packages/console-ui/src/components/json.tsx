import { Check, Copy } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { type JsonTokenKind, jsonTokens, renderValue, type ValueFormat } from "../json-tokens";
import { readValueFormat, writeValueFormat } from "../value-format";

/** The code block every value in the detail pane sits in. */
export const CODE = "overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-card p-3 font-mono text-xs leading-relaxed";

/** Token colours drawn from the palette tokens in index.css — no theme of their own. */
const TONE: Record<JsonTokenKind, string | undefined> = {
  key: "text-primary",
  string: "text-brand",
  number: "text-ok",
  literal: undefined,
  punct: "text-muted-foreground",
};

const FORMATS: { format: ValueFormat; label: string }[] = [
  { format: "js", label: "JS" },
  { format: "json", label: "JSON" },
];

// One format for every block on the page, kept in localStorage and shared
// through a tiny external store so every block re-renders on a change.
let current: ValueFormat = readValueFormat(localStorage);
const listeners = new Set<() => void>();
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const setValueFormat = (format: ValueFormat): void => {
  if (format === current) return;
  current = format;
  writeValueFormat(localStorage, format);
  for (const listener of listeners) listener();
};
const useValueFormat = (): ValueFormat => useSyncExternalStore(subscribe, () => current);

/**
 * `value` in a code block: a bare string reads as itself; anything else
 * pretty-prints with coloured tokens in the chosen format. A toolbar on hover
 * switches JS / JSON (shared by every block) and copies the text as shown.
 */
export function Json({ value, className }: { value: unknown; className?: string }) {
  const format = useValueFormat();
  const isText = typeof value === "string";
  const text = isText ? value : renderValue(value, format);
  let offset = 0;
  return (
    <div className={cn("group relative", className)}>
      <pre className={CODE}>
        {isText
          ? value
          : jsonTokens(value, format).map((token) => {
              const at = offset;
              offset += token.text.length;
              return (
                <span key={at} className={TONE[token.kind]}>
                  {token.text}
                </span>
              );
            })}
      </pre>
      <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 rounded-md border bg-card font-mono text-[11px] opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        {!isText &&
          FORMATS.map((entry) => (
            <button
              key={entry.format}
              type="button"
              aria-pressed={format === entry.format}
              onClick={() => setValueFormat(entry.format)}
              className={cn(
                "rounded-md px-1.5 py-0.5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
                format === entry.format ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {entry.label}
            </button>
          ))}
        <CopyButton text={text} />
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      title="Copy"
      aria-label={copied ? "Copied" : "Copy"}
      onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))}
      className={cn(
        "rounded-md p-1 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
        copied ? "text-ok" : "text-muted-foreground",
      )}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </button>
  );
}

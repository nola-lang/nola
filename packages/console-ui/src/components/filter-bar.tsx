import { Check, X } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { ProjectSummary } from "../api";
import {
  activeParams,
  clearParam,
  FILTER_PARAMS,
  type Filter,
  type FilterParam,
  isEmptyFilter,
  parseFilter,
  serializeFilter,
  toggleProject,
} from "../filter";
import { formatClock, formatDuration } from "../format";
import { Palette, PaletteEmpty, PaletteInput, PaletteItem, PaletteList } from "./palette";

type Editing = FilterParam | "menu";

/**
 * The unified filter: an input-styled strip carrying one labelled group per
 * active parameter. Clicking the free space opens the parameter menu; a
 * chip re-opens its editor; × clears it. State lives in the URL (see
 * filter.ts), so the filter follows the window between views.
 */
export function FilterBar({ projects }: { projects: ProjectSummary[] }) {
  const [search, setSearch] = useSearchParams();
  const filter = parseFilter(search);
  const [editing, setEditing] = useState<Editing | undefined>();
  const apply = (next: Filter): void => setSearch(new URLSearchParams(serializeFilter(next, search)), { replace: true });
  const close = (): void => setEditing(undefined);
  const commit = (next: Filter): void => {
    apply(next);
    close();
  };

  return (
    <Popover open={editing !== undefined} onOpenChange={(open) => !open && close()}>
      <PopoverAnchor asChild>
        <div className="flex h-full min-w-0 flex-1 cursor-text items-center gap-2 overflow-x-auto bg-background px-2">
          {activeParams(filter).map((param) => (
            <Group key={param} label={FILTER_PARAMS.find((p) => p.key === param)?.label ?? param}>
              {param === "project" ? (
                filter.projects.map((name) => (
                  <Chip
                    key={String(name)}
                    text={name ?? "(no project)"}
                    onEdit={() => setEditing("project")}
                    onClear={() => apply(toggleProject(filter, name))}
                  />
                ))
              ) : (
                <Chip text={chipText(filter, param)} onEdit={() => setEditing(param)} onClear={() => apply(clearParam(filter, param))} />
              )}
            </Group>
          ))}
          <button
            type="button"
            className="h-full min-w-24 flex-1 cursor-text text-left font-mono text-muted-foreground text-xs outline-none"
            aria-label="Add filter"
            aria-expanded={editing !== undefined}
            onClick={() => setEditing("menu")}
          >
            {isEmptyFilter(filter) ? "filter by project, time, duration, pid, file…" : ""}
          </button>
        </div>
      </PopoverAnchor>
      <PopoverContent align="start" sideOffset={6} className="w-96 p-0 ">
        {editing === "menu" && (
          <Palette>
            <PaletteInput placeholder="parameters…" autoFocus />
            <PaletteList>
              <PaletteEmpty />
              {FILTER_PARAMS.map((p) => (
                <PaletteItem key={p.key} label={p.label} description={p.hint} onSelect={() => setEditing(p.key)} />
              ))}
            </PaletteList>
          </Palette>
        )}
        {editing === "project" && (
          <Palette>
            <PaletteInput placeholder="Projects…" autoFocus />
            <PaletteList>
              <PaletteEmpty>No projects seen yet.</PaletteEmpty>
              {projects.map((p) => {
                const on = filter.projects.includes(p.name);
                return (
                  <PaletteItem
                    key={String(p.name)}
                    label={p.name ?? "(no project)"}
                    trailing={`${p.traceCount} trace${p.traceCount === 1 ? "" : "s"}`}
                    onSelect={() => apply(toggleProject(filter, p.name))}
                  >
                    <Check className={cn("size-3.5", on ? "text-primary" : "opacity-0")} />
                  </PaletteItem>
                );
              })}
            </PaletteList>
          </Palette>
        )}
        {editing === "time" && (
          <EditorForm
            title="time range"
            fields={[
              { key: "from", label: "from", type: "datetime-local", step: "1", value: toLocalInput(filter.from) },
              { key: "to", label: "to", type: "datetime-local", step: "1", value: toLocalInput(filter.to) },
            ]}
            onSubmit={(v) => commit({ ...filter, from: fromLocalInput(v.from), to: fromLocalInput(v.to) })}
          />
        )}
        {editing === "duration" && (
          <EditorForm
            title="duration (ms)"
            fields={[
              { key: "dmin", label: "min", type: "number", placeholder: "0", value: numText(filter.dmin) },
              { key: "dmax", label: "max", type: "number", placeholder: "∞", value: numText(filter.dmax) },
            ]}
            onSubmit={(v) => commit({ ...filter, dmin: numValue(v.dmin), dmax: numValue(v.dmax) })}
          />
        )}
        {editing === "pid" && (
          <EditorForm
            title="pid"
            fields={[{ key: "pid", label: "process id", type: "number", value: numText(filter.pid) }]}
            onSubmit={(v) => commit({ ...filter, pid: numValue(v.pid) })}
          />
        )}
        {editing === "file" && (
          <EditorForm
            title="file"
            fields={[{ key: "file", label: "path contains", type: "text", placeholder: "src/", value: filter.file ?? "" }]}
            onSubmit={(v) => {
              const file = v.file?.trim();
              const { file: _, ...rest } = filter;
              commit(file ? { ...rest, file } : rest);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 border-l pl-2 first:border-l-0 first:pl-0">
      <span className="font-semibold text-[11px] text-muted-foreground uppercase tracking-[0.12em]">{label}</span>
      {children}
    </span>
  );
}

function Chip({ text, onEdit, onClear }: { text: string; onEdit: () => void; onClear: () => void }) {
  return (
    <span className="flex items-center overflow-hidden rounded-md border bg-card hover:border-muted-foreground">
      <button type="button" className="px-2 py-0.5 font-mono text-xs outline-none focus-visible:bg-accent" onClick={onEdit}>
        {text}
      </button>
      <button
        type="button"
        className="px-1.5 py-1 text-muted-foreground outline-none hover:text-err focus-visible:text-err"
        aria-label={`Clear ${text}`}
        onClick={onClear}
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

interface Field {
  key: string;
  label: string;
  type: string;
  value: string;
  step?: string;
  placeholder?: string;
}

function EditorForm({
  title,
  fields,
  onSubmit,
}: {
  title: string;
  fields: Field[];
  onSubmit: (values: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, f.value])));
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    onSubmit(values);
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 p-3">
      <span className="font-semibold text-[11px] text-muted-foreground uppercase tracking-[0.12em]">{title}</span>
      {fields.map((f, i) => (
        <label key={f.key} htmlFor={`filter-${f.key}`} className="flex items-center gap-2 font-mono text-xs">
          <span className="w-24 text-muted-foreground">{f.label}</span>
          <Input
            id={`filter-${f.key}`}
            type={f.type}
            step={f.step}
            placeholder={f.placeholder}
            value={values[f.key] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            className="h-7 font-mono text-xs"
            autoFocus={i === 0}
          />
        </label>
      ))}
      <Button type="submit" size="xs" variant="secondary" className="self-end">
        apply
      </Button>
    </form>
  );
}

/** Chip text for a non-project param. */
function chipText(f: Filter, param: FilterParam): string {
  switch (param) {
    case "time":
      return rangeText(f.from, f.to, clockText);
    case "duration":
      return rangeText(f.dmin, f.dmax, formatDuration);
    case "pid":
      return String(f.pid);
    case "file":
      return f.file ?? "";
    case "project":
      return "";
  }
}

function rangeText(lo: number | undefined, hi: number | undefined, fmt: (n: number) => string): string {
  if (lo !== undefined && hi !== undefined) return `${fmt(lo)} – ${fmt(hi)}`;
  if (lo !== undefined) return `≥ ${fmt(lo)}`;
  if (hi !== undefined) return `≤ ${fmt(hi)}`;
  return "";
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** Clock time, with the date in front when it is not today. */
function clockText(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay ? formatClock(ms) : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${formatClock(ms)}`;
}

/** epoch ms → the `datetime-local` value in local time ("" when unset). */
function toLocalInput(ms: number | undefined): string {
  if (ms === undefined) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fromLocalInput(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

const numText = (n: number | undefined): string => (n === undefined ? "" : String(n));

function numValue(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

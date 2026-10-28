import { toolWireName } from "@nola-lang/core";
import type { InferType } from "../../types/infer-type.js";
import type { ToolEntry } from "./tool-use-context.js";

/**
 * A group verdict (spec 2026-10-09 §3.5): what derive answered for a tool
 * list entry whose type is a tuple, an array or an object of functions. A
 * single function's verdict is its argument carrier itself.
 */
export type ToolGroupVerdict =
  | { readonly __nolaToolGroup: true; readonly kind: "tuple"; readonly items: readonly InferType<unknown>[] }
  | { readonly __nolaToolGroup: true; readonly kind: "array"; readonly item: InferType<unknown> }
  | { readonly __nolaToolGroup: true; readonly kind: "members"; readonly members: Readonly<Record<string, InferType<unknown>>> };

export type ToolVerdict = InferType<unknown> | ToolGroupVerdict;

/** The constructors the appendix calls (`__nola.tools.*`). */
export const toolVerdicts = {
  tuple: (items: readonly InferType<unknown>[]): ToolGroupVerdict => ({ __nolaToolGroup: true, kind: "tuple", items }),
  array: (item: InferType<unknown>): ToolGroupVerdict => ({ __nolaToolGroup: true, kind: "array", item }),
  members: (members: Readonly<Record<string, InferType<unknown>>>): ToolGroupVerdict => ({ __nolaToolGroup: true, kind: "members", members }),
};

export function isGroupVerdict(v: ToolVerdict): v is ToolGroupVerdict {
  return typeof v === "object" && v !== null && (v as { __nolaToolGroup?: unknown }).__nolaToolGroup === true;
}

/** One lowered entry, deferred: the value as written, derive's verdict, the written text (a name or dotted chain), the member expression's object. */
export interface ToolSource {
  readonly value: unknown;
  readonly verdict: ToolVerdict;
  readonly spread: boolean;
  readonly written?: string;
  readonly receiver?: unknown;
}

/** `__nola.tool(value, verdict, written?, receiver?)` — a function, or a bare group named `<written>.<member>`. */
export function toolSource(value: unknown, verdict: ToolVerdict, written?: string, receiver?: unknown): ToolSource {
  return { value, verdict, spread: false, ...(written !== undefined ? { written } : {}), ...(receiver !== undefined ? { receiver } : {}) };
}

/** `__nola.toolSpread(value, verdict)` — a group flattened into the list. */
export function toolSpreadSource(value: unknown, verdict: ToolVerdict): ToolSource {
  return { value, verdict, spread: true };
}

export function isToolSource(t: ToolEntry | ToolSource): t is ToolSource {
  return "verdict" in t;
}

/** A function's own name with every `bound ` prefix removed (a bound function is named `bound <name>`). */
export function ownName(fn: unknown): string {
  let name = typeof fn === "function" ? String((fn as { name?: unknown }).name ?? "") : "";
  while (name.startsWith("bound ")) name = name.slice("bound ".length);
  return name;
}

type Materialized = { entries: ToolEntry[]; error?: string };

/**
 * The entry list the loop consumes, built from the lowered sources (spec
 * 2026-10-09 §3.5). Never throws: the first problem is returned as `error`
 * and the ask-site node raises it as NOLA3022 on the ask span.
 */
export function materializeTools(tools: readonly (ToolEntry | ToolSource)[]): Materialized {
  const entries: ToolEntry[] = [];
  const byWire = new Map<string, ToolEntry>();
  for (const [i, t] of tools.entries()) {
    const position = i + 1;
    const built = isToolSource(t) ? fromSource(t, position) : { entries: [t] };
    if ("error" in built) return { entries: [], error: built.error };
    for (const e of built.entries) {
      const wire = toolWireName(e.name);
      const prior = byWire.get(wire);
      if (prior !== undefined) {
        // the same tool listed again — two lists of one ask (spec 2026-10-12 §3.6): one entry
        if (sameOrigin(prior, e)) continue;
        return {
          entries: [],
          error: `tool '${e.name}' (entry ${position}) shares the wire name '${wire}' with '${prior.name}' — a model's tool call comes back by that name; rename one of them.`,
        };
      }
      byWire.set(wire, e);
      entries.push(e);
    }
  }
  return { entries };
}

/** Where an entry's callable came from: the function as written and the object it is bound to — identity, not the bound copy. */
interface Origin {
  fn: unknown;
  receiver: unknown;
}
const origins = new WeakMap<ToolEntry, Origin>();
function withOrigin(entry: ToolEntry, fn: unknown, receiver: unknown): ToolEntry {
  origins.set(entry, { fn, receiver });
  return entry;
}
/** A hand-written entry is its own origin. */
function sameOrigin(a: ToolEntry, b: ToolEntry): boolean {
  const oa = origins.get(a) ?? { fn: a.call, receiver: undefined };
  const ob = origins.get(b) ?? { fn: b.call, receiver: undefined };
  return oa.fn === ob.fn && oa.receiver === ob.receiver;
}

type Built = { entries: ToolEntry[] } | { error: string };
type Callable = (...a: never[]) => unknown;

function fromSource(s: ToolSource, position: number): Built {
  const label = s.written !== undefined ? `'${s.written}'` : `entry ${position}`;
  if (!isGroupVerdict(s.verdict)) {
    if (s.spread) return { error: `${label} is one function — spread a group (an array or an object of functions), not a function.` };
    if (typeof s.value !== "function") return { error: `${label} is not a function (got ${describe(s.value)}).` };
    const name = s.written ?? ownName(s.value);
    if (name === "") return { error: `${label} (entry ${position}) has no name — give the function a name, or list it under a written name.` };
    const call = s.receiver !== undefined ? (s.value as Callable).bind(s.receiver) : (s.value as Callable);
    return { entries: [withOrigin({ name, call, args: s.verdict }, s.value, s.receiver)] };
  }
  if (!s.spread && s.written === undefined) return { error: `${label} is a group reached through an expression — name it or spread it.` };
  const prefix = s.spread ? "" : `${s.written}.`;
  const v = s.verdict;
  if (v.kind === "members") {
    if (typeof s.value !== "object" || s.value === null) return { error: `${label} is not an object of functions (got ${describe(s.value)}).` };
    const obj = s.value as Record<string, unknown>;
    const entries: ToolEntry[] = [];
    for (const [key, args] of Object.entries(v.members)) {
      const fn = obj[key];
      if (typeof fn !== "function") return { error: `'${prefix}${key}' is not a function (got ${describe(fn)}).` };
      entries.push(withOrigin({ name: `${prefix}${key}`, call: (fn as Callable).bind(obj), args }, fn, obj));
    }
    return { entries };
  }
  if (!Array.isArray(s.value)) return { error: `${label} is not an array of functions (got ${describe(s.value)}).` };
  if (v.kind === "tuple" && s.value.length !== v.items.length) {
    return { error: `${label} has ${s.value.length} element${s.value.length === 1 ? "" : "s"} — its type has ${v.items.length}.` };
  }
  const items = v.kind === "tuple" ? v.items : s.value.map(() => v.item);
  const entries: ToolEntry[] = [];
  for (const [i, fn] of s.value.entries()) {
    if (typeof fn !== "function") return { error: `element ${i + 1} of ${label} is not a function (got ${describe(fn)}).` };
    const name = ownName(fn);
    if (name === "") return { error: `element ${i + 1} of ${label} has no name — give the function a name, or list it under a written name.` };
    entries.push(withOrigin({ name: `${prefix}${name}`, call: fn as Callable, args: items[i] as InferType<unknown> }, fn, undefined));
  }
  return { entries };
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value === "object" ? "an object" : typeof value;
}

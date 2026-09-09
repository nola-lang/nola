/**
 * The master/detail split, remembered across reloads. react-resizable-panels
 * reports a layout as `{ [panelId]: percent }`; this stores it under one key
 * and hands it back only when it still looks like one — anything else
 * (missing, unparsable, a foreign shape, a storage that throws in a private
 * window) reads as "no saved layout" and the default split applies.
 */
export const SPLIT_LAYOUT_KEY = "nola-console:split";

export type SplitLayout = Record<string, number>;

type SplitStorage = Pick<Storage, "getItem" | "setItem">;

export function readSplitLayout(storage: SplitStorage): SplitLayout | undefined {
  try {
    const raw = storage.getItem(SPLIT_LAYOUT_KEY);
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    const entries = Object.entries(parsed);
    if (entries.length === 0 || !entries.every(([, v]) => typeof v === "number" && Number.isFinite(v))) return undefined;
    return Object.fromEntries(entries) as SplitLayout;
  } catch {
    return undefined;
  }
}

export function writeSplitLayout(storage: SplitStorage, layout: SplitLayout): void {
  try {
    storage.setItem(SPLIT_LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // storage unavailable — the split simply is not remembered
  }
}

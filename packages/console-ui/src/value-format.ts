import type { ValueFormat } from "./json-tokens";

/**
 * The detail pane's value format (JS literal or JSON), remembered across
 * reloads under one key. Anything but a known format — missing, foreign, a
 * storage that throws in a private window — reads as the JS default.
 */
export const VALUE_FORMAT_KEY = "nola-console:value-format";

type FormatStorage = Pick<Storage, "getItem" | "setItem">;

export function readValueFormat(storage: FormatStorage): ValueFormat {
  try {
    return storage.getItem(VALUE_FORMAT_KEY) === "json" ? "json" : "js";
  } catch {
    return "js";
  }
}

export function writeValueFormat(storage: FormatStorage, format: ValueFormat): void {
  try {
    storage.setItem(VALUE_FORMAT_KEY, format);
  } catch {
    // storage unavailable — the format simply is not remembered
  }
}

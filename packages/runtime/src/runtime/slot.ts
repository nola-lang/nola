import { Codes } from "@nola-lang/ast";
import { NOLA_EMIT, type NolaConfig, NolaVersionError } from "@nola-lang/core";
import type { ResolvedNolaConfig } from "../config.js";
import { NolaRuntime } from "./nola-runtime.js";

// Symbol.for: shared across every runtime copy in the process by design.
const SLOT_KEY = Symbol.for("nola.runtime");

/**
 * Claim or adopt the process-wide runtime instance. Same emit contract → adopt
 * the existing instance (all copies share one config). Different emit contract
 * → the process cannot run safely; fail at import.
 * Exported as a test/diagnostic seam (module-level only, not from the package
 * index) — application code never calls this.
 */
export function claimNolaRuntime(emit: number, url: string): NolaRuntime {
  const g = globalThis as unknown as Record<symbol, NolaRuntime | undefined>;
  const existing = g[SLOT_KEY];
  if (existing) {
    if (existing.emit !== emit) {
      throw new NolaVersionError(
        `Two incompatible copies of @nola-lang/runtime are loaded: ${existing.url} (emit contract ${existing.emit}) and ${url} (emit contract ${emit}). Run \`npm dedupe\`, or align your nola-lang versions so a single runtime is installed.`,
        Codes.DuplicateRuntimeConflict,
        { expected: existing.emit, actual: emit, urls: [existing.url, url] },
      );
    }
    return existing;
  }
  const runtime = new NolaRuntime(emit, url);
  g[SLOT_KEY] = runtime;
  return runtime;
}

let current = claimNolaRuntime(NOLA_EMIT, import.meta.url);

/**
 * The module-level facade over the process-wide NolaRuntime instance. Methods
 * close over the slot (no `this`), so they are safe to pass around detached.
 */
export const nolaRuntime = {
  /** The process-wide NolaRuntime instance. */
  current(): NolaRuntime {
    return current;
  },

  configure(config: NolaConfig | ResolvedNolaConfig, opts?: { source?: string }): void {
    current.configure(config, opts);
  },

  /** Discard the instance wholesale and claim a fresh one. */
  reset(): void {
    delete (globalThis as unknown as Record<symbol, NolaRuntime | undefined>)[SLOT_KEY];
    current = claimNolaRuntime(NOLA_EMIT, import.meta.url);
  },
};

/**
 * Lowered modules call this immediately after importing the runtime — it
 * attaches the module to the process-wide NolaRuntime and fails at module
 * load on a build/runtime skew, so stale code never reaches an `ask`.
 */
export function useRuntime(emitted: number): void {
  if (emitted === current.emit) return;
  const direction = emitted < current.emit ? "rebuild" : "update-runtime";
  const fix =
    direction === "rebuild"
      ? "Rebuild your project: `nola build` (or re-run through `nola run`)."
      : "Update the runtime: `npm install nola-lang@latest`.";
  throw new NolaVersionError(
    `This module was compiled for Nola emit contract ${emitted}, but @nola-lang/runtime (at ${current.url}) provides contract ${current.emit}. ${fix}`,
    Codes.EmitContractMismatch,
    { expected: current.emit, actual: emitted, direction },
  );
}

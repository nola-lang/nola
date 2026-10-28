import { Codes } from "@nola-lang/ast";
import { toolWireName } from "@nola-lang/core";
import type { DerivationAnswer, DerivationRequest } from "./types.js";

/**
 * The names a tool list's entries declare collide across the entries of ONE
 * ask (spec 2026-10-09 §3.4): a spread member against a written entry, two
 * spread groups, a bare group's qualified names against a written chain. The
 * lowerer checks the written texts against each other before any checker
 * runs; this pass checks what derive could name — per ask, in entry order —
 * and fails the LATER entry with NOLA2018. Two written single entries are the
 * lowerer's pair (already reported), so a duplicate name is reported once.
 * Shared by `finalizeDerivations` and the editor's lazy pass, so `nola check`
 * and VS Code agree. Returns the answers with the colliding ones replaced.
 */
export function toolNameCollisions(derivations: readonly DerivationRequest[], answers: readonly DerivationAnswer[]): DerivationAnswer[] {
  const out = [...answers];
  const index = new Map(answers.map((a, i) => [a.accessor, i]));
  const seen = new Map<string, Map<string, { name: string; single: boolean }>>();
  for (const req of derivations) {
    if (req.kind !== "tool" || !req.tool) continue;
    const i = index.get(req.accessor);
    const a = i === undefined ? undefined : answers[i];
    if (i === undefined || !a?.ok || !a.names) continue;
    const perAsk = seen.get(req.tool.ask) ?? new Map<string, { name: string; single: boolean }>();
    seen.set(req.tool.ask, perAsk);
    // a written single entry: its one name is its written text — collisions among those are the lowerer's
    const single = req.tool.written !== undefined && a.names.length === 1 && a.names[0] === req.tool.written;
    for (const name of a.names) {
      const w = toolWireName(name);
      const prior = perAsk.get(w);
      if (prior !== undefined && !(single && prior.single)) {
        // the same name twice is a collision too (a spread's `search` beside a written `search`, a group beside its own member)
        const reason =
          prior.name === name
            ? `tool '${name}' is offered twice — a model's tool call comes back by that name; list it once, or offer the group bare so its names carry the group's prefix.`
            : `tool '${name}' shares the wire name '${w}' with '${prior.name}' — a model's tool call comes back by that name; rename one of them, or offer the group bare so its names carry the group's prefix.`;
        out[i] = { accessor: req.accessor, ok: false, reason, code: Codes.ToolEntryInvalid, accessors: a.accessors, deps: a.deps };
        break;
      }
      if (prior === undefined) perAsk.set(w, { name, single });
    }
  }
  return out;
}

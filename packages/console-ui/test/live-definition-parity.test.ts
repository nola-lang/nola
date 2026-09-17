import { ConsoleService, SqliteConsoleStorage } from "@nola-lang/console";
import { describe, expect, it } from "vitest";
import type { DefinitionDetail } from "../src/api";
import { applyNotice } from "../src/live-definition";

const DEF = "e".repeat(64);
const site = { file: "src/person.tsi", loc: "4:10" };
const envelope = (seq: number, at: number, kind: string, event: unknown) => ({ v: 1, runId: "r1", pid: 4, project: "app", seq, at, kind, event }) as never;

/**
 * `applyNotice` re-implements, for ONE cached definition, what storage does
 * with an envelope. The two must agree on every row the UI shows, or a live
 * bar changes shape when the refetch lands. This replays the same envelopes
 * through real storage and through the reducer and compares the rows.
 */
describe("applyNotice agrees with storage", () => {
  it("an extract ask: the running row, then the settled row", async () => {
    const service = new ConsoleService(new SqliteConsoleStorage(":memory:"));
    const start = envelope(0, 5000, "askStart", { askId: "p1", def: DEF, kind: "extract", provider: "openai", instruction: "name", typeText: "string", spanPath: ["inv1", "inv2"], site });
    const end = envelope(1, 5420, "askEnd", {
      askId: "p1",
      receipt: { def: DEF, kind: "extract", servedBy: "anthropic", profile: "fast", durationMs: 420, attempts: 2, outcome: { ok: true }, spanPath: ["inv1", "inv2"], site },
    });

    await service.ingest(start);
    const stored = (await service.getDefinition(DEF)) as DefinitionDetail;
    const blank: DefinitionDetail = { ...stored, asks: [], executions: 0, matched: 0, okCount: 0, errorCount: 0, providers: [] };
    const running = applyNotice(blank, {}, start);
    expect(running.asks).toEqual(stored.asks);
    expect(running.executions).toBe(stored.executions);
    expect(running.matched).toBe(stored.matched);

    await service.ingest(end);
    const storedEnd = (await service.getDefinition(DEF)) as DefinitionDetail;
    const settled = applyNotice(running, {}, end);
    expect(settled.asks).toEqual(storedEnd.asks);
    expect(settled.providers).toEqual(storedEnd.providers);
    expect(settled.okCount).toBe(storedEnd.okCount);
    expect(settled.errorCount).toBe(storedEnd.errorCount);
  });

  it("a failed call ask", async () => {
    const service = new ConsoleService(new SqliteConsoleStorage(":memory:"));
    const start = envelope(0, 7000, "askStart", { askId: "c1", def: DEF, kind: "call", provider: "openai", callee: "lookup", hint: "be brief", spanPath: ["inv1"], site });
    const end = envelope(1, 7100, "askEnd", { askId: "c1", receipt: { def: DEF, kind: "call", servedBy: "openai", durationMs: 100, attempts: 2, outcome: { ok: false, error: "no valid JSON" }, spanPath: ["inv1"], site } });
    await service.ingest(start);
    const stored = (await service.getDefinition(DEF)) as DefinitionDetail;
    const blank: DefinitionDetail = { ...stored, asks: [], executions: 0, matched: 0, okCount: 0, errorCount: 0, providers: [] };
    await service.ingest(end);
    const storedEnd = (await service.getDefinition(DEF)) as DefinitionDetail;
    const settled = applyNotice(applyNotice(blank, {}, start), {}, end);
    expect(settled.asks).toEqual(storedEnd.asks);
    expect(settled.errorCount).toBe(storedEnd.errorCount);
  });
});

import { type ConsoleNotice, ConsoleService, SqliteConsoleStorage } from "@nola-lang/console";
import type { NolaIngestEnvelope } from "@nola-lang/core";
import { describe, expect, it } from "vitest";

const envelope: NolaIngestEnvelope = {
  v: 1,
  runId: "r",
  pid: 1,
  seq: 0,
  at: 1,
  kind: "askStart",
  event: {
    askId: "a1",
    site: { file: "f.tsi", loc: "1:1" },
    provider: "mock",
    invocationId: "inv-1",
    spanPath: ["inv-1"],
    def: "d1".repeat(32),
    kind: "extract",
  },
};

describe("ConsoleService", () => {
  it("persists on ingest and notifies subscribers; unsubscribe stops delivery", async () => {
    const service = new ConsoleService(new SqliteConsoleStorage(":memory:"));
    const seen: NolaIngestEnvelope[] = [];
    const unsubscribe = service.onEvent((e) => seen.push(e));
    await service.ingest(envelope);
    expect(seen).toHaveLength(1);
    expect((await service.listRecords()).map((r) => [r.kind, r.id])).toEqual([
      ["invocation", "inv-1"],
      ["extract", "a1"],
    ]);
    expect((await service.getTrace("inv-1"))?.records[1]?.id).toBe("a1");
    expect((await service.getAsk("a1"))?.status).toBe("running");
    expect(await service.listProjects()).toMatchObject([{ name: null, traceCount: 1 }]); // the (no project) bucket
    expect((await service.listDefinitions())[0]?.def).toBe("d1".repeat(32));
    expect((await service.getDefinition("d1".repeat(32)))?.asks[0]?.askId).toBe("a1");
    unsubscribe();
    await service.ingest({ ...envelope, seq: 1, kind: "retry", event: { askId: "a1", attempt: 1, reason: "r", site: {} } });
    expect(seen).toHaveLength(1);
  });

  it("clear() wipes storage and notifies subscribers with a cleared notice", async () => {
    const service = new ConsoleService(new SqliteConsoleStorage(":memory:"));
    await service.ingest(envelope);
    const seen: ConsoleNotice[] = [];
    service.onEvent((e) => seen.push(e));
    await service.clear();
    expect(await service.listRecords()).toEqual([]);
    expect(seen).toEqual([{ kind: "cleared", at: expect.any(Number) }]);
  });
});

import { describe, expect, it } from "vitest";
import type { AskRecord, DefinitionSummary, InvocationRecord, TraceRecord } from "../src/api";
import {
  activeParams,
  addProject,
  clearParam,
  definitionAsksQuery,
  executionsCaption,
  type Filter,
  isEmptyFilter,
  matchesDefinition,
  minuteRange,
  parseFilter,
  planProjectQueries,
  serializeFilter,
  toggleProject,
  visibleRecords,
} from "../src/filter";

const sp = (s: string) => new URLSearchParams(s);

describe("filter ↔ search params", () => {
  it("parses every param; the (none) spelling is the no-project bucket; garbage is dropped", () => {
    expect(parseFilter(sp("project=crm&project=(none)&from=10&to=20&dmin=5&dmax=50&pid=7&file=src/a"))).toEqual({
      projects: ["crm", null],
      from: 10,
      to: 20,
      dmin: 5,
      dmax: 50,
      pid: 7,
      file: "src/a",
    });
    expect(parseFilter(sp("from=abc&pid=-1&file=%20&project=crm&project=crm"))).toEqual({
      projects: ["crm"],
      from: undefined,
      to: undefined,
      dmin: undefined,
      dmax: undefined,
      pid: undefined,
    });
    expect(isEmptyFilter(parseFilter(sp("")))).toBe(true);
    expect(isEmptyFilter(parseFilter(sp("pid=1")))).toBe(false);
  });

  it("serializes back and keeps unrelated params such as ask", () => {
    const f = parseFilter(sp("project=crm&project=(none)&from=10&pid=7&file=x"));
    expect(serializeFilter(f, sp("ask=a1&pid=99&from=1"))).toBe("?ask=a1&project=crm&project=%28none%29&from=10&pid=7&file=x");
    expect(serializeFilter({ projects: [] }, sp("pid=3"))).toBe("");
  });

  it("plans one query per selected project, one unfiltered query when none", () => {
    expect(planProjectQueries([])).toEqual([{}]);
    expect(planProjectQueries(["crm", null])).toEqual([{ project: "crm" }, { project: null }]);
  });

  it("activeParams, clearParam and toggleProject", () => {
    const f: Filter = { projects: ["crm"], from: 1, dmax: 9, pid: 2, file: "a" };
    expect(activeParams(f)).toEqual(["project", "time", "duration", "pid", "file"]);
    expect(activeParams({ projects: [] })).toEqual([]);
    expect(clearParam(f, "time")).toEqual({ ...f, from: undefined, to: undefined });
    expect(clearParam(f, "file")).toEqual({ projects: ["crm"], from: 1, dmax: 9, pid: 2 });
    expect(toggleProject(f, "crm").projects).toEqual([]);
    expect(toggleProject(f, null).projects).toEqual(["crm", null]);
    expect(addProject(f, "crm")).toBe(f);
    expect(addProject(f, null).projects).toEqual(["crm", null]);
  });

  it("minuteRange covers the containing minute", () => {
    const at = new Date(2026, 8, 1, 10, 15, 42, 500).getTime();
    const { from, to } = minuteRange(at);
    expect(new Date(from).getSeconds()).toBe(0);
    expect(to - from).toBe(59_999);
    expect(from <= at && at <= to).toBe(true);
  });
});

const root = (over: Partial<InvocationRecord> = {}): InvocationRecord => ({
  id: "r",
  kind: "invocation",
  traceId: "r",
  depth: 0,
  label: "triage(..)",
  status: "ok",
  startedAt: 100,
  durationMs: 250,
  detached: false,
  runId: "run",
  pid: 7,
  file: "src/test_7/triage.tsi",
  askCount: 1,
  errorCount: 0,
  ...over,
});
const child = (over: Partial<AskRecord> = {}): AskRecord => ({
  id: "a",
  kind: "extract",
  traceId: "r",
  parentId: "r",
  depth: 1,
  label: "..`x`",
  status: "ok",
  startedAt: 110,
  site: "src/other.tsi:1:1",
  ...over,
});

describe("matchers", () => {
  it("root: time, duration, pid and file all have to hold; a matching root keeps its whole subtree", () => {
    const f = parseFilter(sp("from=50&to=150&dmin=200&dmax=300&pid=7&file=TRIAGE"));
    const ids = (filter: Filter, records: TraceRecord[]) => visibleRecords(filter, records).map((r) => r.id);
    expect(ids(f, [root(), child()])).toEqual(["r", "a"]);
    expect(ids(f, [root({ startedAt: 151 }), child()])).toEqual([]);
    expect(ids(f, [root({ durationMs: 199 }), child()])).toEqual([]);
    expect(ids(f, [root({ durationMs: undefined }), child()])).toEqual([]);
    expect(ids(f, [root({ pid: 8 }), child()])).toEqual([]);
    expect(ids(f, [root({ file: "src/x.tsi" }), child()])).toEqual([]);
    expect(ids(parseFilter(sp("")), [root({ durationMs: undefined, file: undefined }), child()])).toEqual(["r", "a"]);
  });

  it("root: groups are kept or dropped whole; the file filter also matches a descendant ask's site", () => {
    const none = parseFilter(sp(""));
    const records: TraceRecord[] = [
      root(),
      child(),
      root({ id: "s", traceId: "s", pid: 8 }),
      child({ id: "b", traceId: "s", parentId: "s", site: "src/deep.tsi:2:2" }),
    ];
    const ids = (filter: Filter) => visibleRecords(filter, records).map((r) => r.id);
    expect(ids(none)).toEqual(["r", "a", "s", "b"]);
    expect(ids({ ...none, pid: 8 })).toEqual(["s", "b"]);
    expect(ids({ ...none, file: "other" })).toEqual(["r", "a"]);
    expect(ids({ ...none, file: "deep" })).toEqual(["s", "b"]);
    expect(ids({ ...none, file: "nope" })).toEqual([]);
  });

  it("definition: the range must overlap its life span; duration is the average; pid is ignored", () => {
    const d: DefinitionSummary = {
      def: "d",
      file: "src/a.tsi",
      firstSeenAt: 100,
      lastSeenAt: 200,
      executions: 2,
      okCount: 2,
      errorCount: 0,
      avgDurationMs: 150,
      providers: [],
    };
    expect(matchesDefinition(parseFilter(sp("from=150&to=300")), d)).toBe(true);
    expect(matchesDefinition(parseFilter(sp("from=201")), d)).toBe(false);
    expect(matchesDefinition(parseFilter(sp("to=99")), d)).toBe(false);
    expect(matchesDefinition(parseFilter(sp("dmin=151")), d)).toBe(false);
    expect(matchesDefinition(parseFilter(sp("file=A.TSI&pid=99")), d)).toBe(true);
  });

  it("executions: time, duration and pid travel to the server; project and file do not", () => {
    expect(definitionAsksQuery(parseFilter(sp("pid=7&dmax=40&from=100&project=crm&file=whatever")))).toEqual({
      from: 100,
      dmax: 40,
      pid: 7,
    });
    expect(definitionAsksQuery(parseFilter(sp("")))).toEqual({});
  });

  it("executions caption says what is shown out of what exists", () => {
    expect(executionsCaption({ shown: 12, matched: 12, executions: 12 })).toBe("");
    expect(executionsCaption({ shown: 4, matched: 4, executions: 12 })).toBe("4 of 12");
    expect(executionsCaption({ shown: 500, matched: 3120, executions: 3120 })).toBe("latest 500 of 3120");
    expect(executionsCaption({ shown: 500, matched: 900, executions: 3120 })).toBe("latest 500 of 900 matching, 3120 total");
  });
});

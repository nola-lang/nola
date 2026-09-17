import { describe, expect, it } from "vitest";
import { mergeQueryKeys, queryKeysFor } from "../src/live-keys";

const envelope = (kind: string, event: unknown) => ({ v: 1, runId: "r", pid: 1, seq: 0, at: 0, kind, event });

describe("queryKeysFor", () => {
  it("a cleared store refetches everything", () => {
    expect(queryKeysFor({ kind: "cleared", at: 0 })).toBe("all");
  });

  it("an ask starting or ending touches the lists, the definition panels and that ask", () => {
    const keys = queryKeysFor(envelope("askStart", { askId: "a1" }));
    expect(keys).toEqual([["projects"], ["records"], ["trace"], ["definitions"], ["definition"], ["ask", "a1"]]);
    expect(queryKeysFor(envelope("askEnd", { askId: "a1" }))).toEqual(keys);
  });

  it("mid-ask events touch ONLY that ask's detail — the lists and the chart do not refetch for them", () => {
    for (const kind of ["providerRequest", "providerResponse", "validationFailed", "retry"]) {
      expect(queryKeysFor(envelope(kind, { askId: "a1" }))).toEqual([["ask", "a1"]]);
    }
  });

  it("invocation events touch the trace views, never the definitions", () => {
    for (const kind of ["invocationStart", "invocationEnd"]) {
      expect(queryKeysFor(envelope(kind, { invocationId: "i1" }))).toEqual([["projects"], ["records"], ["trace"]]);
    }
  });

  it("an unknown or malformed notice falls back to everything", () => {
    expect(queryKeysFor(envelope("somethingNew", {}))).toBe("all");
    expect(queryKeysFor(null)).toBe("all");
    expect(queryKeysFor(envelope("askEnd", {}))).toBe("all");
  });
});

describe("mergeQueryKeys", () => {
  it("unions a batch's keys, each prefix once", () => {
    expect(mergeQueryKeys([[["ask", "a1"]], [["records"], ["ask", "a1"]], [["ask", "a2"]]])).toEqual([["ask", "a1"], ["records"], ["ask", "a2"]]);
  });

  it("one \"all\" in the batch is all", () => {
    expect(mergeQueryKeys([[["ask", "a1"]], "all"])).toBe("all");
  });
});

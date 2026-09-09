import { askLabel, invocationLabel } from "@nola-lang/console";
import { describe, expect, it } from "vitest";

describe("record labels", () => {
  it("names an invocation by its function, <anonymous> when unknown", () => {
    expect(invocationLabel("triage")).toBe("triage(..)");
    expect(invocationLabel(undefined)).toBe("<anonymous>(..)");
  });

  it("renders an extract as ..`instruction`<T>, truncating long text", () => {
    expect(askLabel({ kind: "extract", instruction: "summarize the ticket", typeText: "Ticket" })).toBe(
      "..`summarize the ticket`<Ticket>",
    );
    expect(askLabel({ kind: "extract", instruction: "summarize the ticket" })).toBe("..`summarize the ticket`");
    expect(askLabel({ kind: "extract", instruction: "order or quote?", typeText: '"quote" | "order"' })).toBe(
      '..`order or quote?`<"quote" | "order">',
    );
    expect(askLabel({ kind: "extract", instruction: "a".repeat(100) })).toBe(`..\`${"a".repeat(79)}…\``);
    expect(askLabel({ kind: "extract" })).toBe("..``");
  });

  it("renders a call as callee`hint`(..), or callee(..) without a hint", () => {
    expect(askLabel({ kind: "call", callee: "notify", hint: "urgently" })).toBe("notify`urgently`(..)");
    expect(askLabel({ kind: "call", callee: "notify", hint: "" })).toBe("notify(..)");
    expect(askLabel({ kind: "call" })).toBe("?(..)");
  });

  it("collapses whitespace so a multi-line instruction stays one line", () => {
    expect(askLabel({ kind: "extract", instruction: "  find\n  the   owner " })).toBe("..`find the owner`");
  });
});

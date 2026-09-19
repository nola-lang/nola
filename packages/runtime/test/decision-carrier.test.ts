import { inferTypes as t } from "@nola-lang/runtime";
import { describe, expect, it } from "vitest";

describe("decision carrier nodes", () => {
  it("factories build the three kinds and keep their criteria", () => {
    const c = t.choice({ billing: "Payments", sales: null });
    const s = t.scale(["Calm", "Civil", "Angry"]);
    const p = t.prob({ true: "Time pressure", false: "No urgency" });
    const bare = t.prob();
    expect(c._node).toEqual({ kind: "choice", criteria: { billing: "Payments", sales: null } });
    expect(s._node).toEqual({ kind: "scale", levels: ["Calm", "Civil", "Angry"] });
    expect(p._node).toEqual({ kind: "prob", criteria: { true: "Time pressure", false: "No urgency" } });
    expect(bare._node).toEqual({ kind: "prob" });
  });

  it("toTypeText reconstructs what the author wrote", () => {
    expect(t.choice({ billing: "Payments", sales: null }).toTypeText()).toBe('Choice<{ billing: "Payments"; sales: null }>');
    expect(t.choice({ a: null, b: null }).toTypeText()).toBe('Choice<"a" | "b">');
    expect(t.scale(["Calm", "Angry"]).toTypeText()).toBe('Scale<["Calm", "Angry"]>');
    expect(t.prob().toTypeText()).toBe("Prob");
    expect(t.prob({ true: "y", false: "n" }).toTypeText()).toBe('Prob<{ true: "y"; false: "n" }>');
  });

  it("numeric labels: the node lists them and toTypeText writes numbers", () => {
    const n = t.choice({ "1": null, "2": null }, { numeric: ["1", "2"] });
    expect(n._node).toEqual({ kind: "choice", criteria: { "1": null, "2": null }, numeric: ["1", "2"] });
    expect(n.toTypeText()).toBe("Choice<1 | 2>");
    expect(t.choice({ "1": "Low", "2": "High" }, { numeric: ["1", "2"] }).toTypeText()).toBe('Choice<{ 1: "Low"; 2: "High" }>');
    // a mixed union: only the listed labels are numbers
    expect(t.choice({ "1": null, a: null }, { numeric: ["1"] }).toTypeText()).toBe('Choice<1 | "a">');
    // string labels stay list-less (existing nodes and their schemas are unchanged)
    expect(t.choice({ a: null, b: null }, { numeric: [] })._node).toEqual({ kind: "choice", criteria: { a: null, b: null } });
  });

  it("toNativeType: the answer objects are objects, a prob is a number", () => {
    expect(t.choice({ a: null, b: null }).toNativeType()).toBe("object");
    expect(t.scale(["a", "b"]).toNativeType()).toBe("object");
    expect(t.prob().toNativeType()).toBe("number");
  });

  it("describe keeps the node; nesting inside an object is legal", () => {
    const triage = t.object({ department: t.choice({ a: null, b: null }).describe("Which team?") });
    expect(triage.toTypeText()).toBe('{ department: Choice<"a" | "b"> }');
  });
});

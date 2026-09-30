import { isGeneratedIdentifier, isGeneratedNameDiagnostic } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";

describe("names the lowering generates (hidden from the author in check and the editors)", () => {
  it("TS6133 on a generated `__nola_` name is generated; on a user name, or another code, it is not", () => {
    expect(isGeneratedNameDiagnostic(6133, "'__nola_ctx_1' is declared but its value is never read.")).toBe(true);
    expect(isGeneratedNameDiagnostic(6133, "'__nola_module_ctx' is declared but its value is never read.")).toBe(true);
    expect(isGeneratedNameDiagnostic(6133, "'foo' is declared but its value is never read.")).toBe(false);
    expect(isGeneratedNameDiagnostic(6133, "'my__nola_ctx' is declared but its value is never read.")).toBe(false);
    expect(isGeneratedNameDiagnostic(2304, "Cannot find name '__nola_ctx_1'.")).toBe(false);
  });

  it("whatever quotes the message's locale puts around the name (the editors load localized messages)", () => {
    // TypeScript's own zh-cn, de, cs and pl wordings of TS6133
    const localized: Array<[string, boolean]> = [
      ["已声明“__nola_ctx_1”，但从未读取其值。", true],
      ['"__nola_ctx_1" ist deklariert, aber der zugehörige Wert wird nie gelesen.', true],
      ["Deklaruje se __nola_ctx_1, ale jeho hodnota se vůbec nečte.", true],
      ["Element „foo” jest zadeklarowany, ale jego wartość nie jest nigdy odczytywana.", false],
    ];
    for (const [message, generated] of localized) {
      expect(isGeneratedNameDiagnostic(6133, message), message).toBe(generated);
    }
  });

  it("identifiers: `__nola…` and the executor's `__frame`, nothing else", () => {
    const generated = ["__nola", "__frame", "__nola_module_ctx", "__nola_type_$1", "__nola_type_Person", "__nola_ctx_1"];
    for (const name of generated) {
      expect(isGeneratedIdentifier(name), name).toBe(true);
    }
    for (const name of ["nola", "_nola", "x__nola", "frame", "__frames", "__frame2", "oncall"]) {
      expect(isGeneratedIdentifier(name), name).toBe(false);
    }
  });
});

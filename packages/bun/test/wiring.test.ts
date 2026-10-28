import { afterEach, describe, expect, it } from "vitest";
import { setResolver } from "../src/resolve.js";
import { configPathFromWiringId, isWiringId, WIRING_ID, WIRING_NAMESPACE, wiringIdFor, wiringSource } from "../src/wiring.js";

afterEach(() => setResolver(undefined));

describe("wiring id", () => {
  it("round-trips a Windows config path through the query param", () => {
    const id = wiringIdFor("D:\\work\\app\\nola.config.ts");
    expect(id.startsWith(`${WIRING_ID}?path=`)).toBe(true);
    expect(isWiringId(id)).toBe(true);
    expect(configPathFromWiringId(id)).toBe("D:\\work\\app\\nola.config.ts");
  });

  it("round-trips a posix path with spaces", () => {
    expect(configPathFromWiringId(wiringIdFor("/srv/my app/nola.config.ts"))).toBe("/srv/my app/nola.config.ts");
  });

  it("names its namespace", () => {
    expect(WIRING_NAMESPACE).toBe("nola-wiring");
    expect(isWiringId("./x.tsi")).toBe(false);
  });
});

describe("wiringSource", () => {
  it("imports the config and the runtime by ABSOLUTE forward-slash paths and configures", () => {
    setResolver((specifier, dir) => {
      expect(specifier).toBe("@nola-lang/runtime");
      expect(dir).toBe("D:\\work\\app");
      return "D:\\work\\app\\node_modules\\@nola-lang\\runtime\\dist\\index.js";
    });
    const src = wiringSource("D:\\work\\app\\nola.config.ts", "D:\\work\\app");
    expect(src).toBe(
      [
        'import config from "D:/work/app/nola.config.ts";',
        'import { nolaRuntime } from "D:/work/app/node_modules/@nola-lang/runtime/dist/index.js";',
        'nolaRuntime.configure(config, { source: "nola.config.ts" });',
        "",
      ].join("\n"),
    );
  });

  it("says what is missing when no resolver and no Bun global exist", () => {
    expect(() => wiringSource("/app/nola.config.ts", "/app")).toThrow(/Bun\.resolveSync is unavailable/);
  });
});

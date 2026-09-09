import { describe, expect, it } from "vitest";
import { styleOutro } from "../src/style.js";

/** Tagging colours instead of ANSI codes keeps the expectations readable. */
const tag = (name: string) => (s: string) => `<${name}>${s}</${name}>`;
const colors = { bold: tag("b"), dim: tag("dim"), green: tag("g"), cyan: tag("c") };

describe("styleOutro", () => {
  it("accents the scaffold outro: verb, name, file count, header, commands and hints", () => {
    const plain = [
      "Scaffolded nola-app (11 files).",
      "",
      "Next steps:",
      "  cd nola-app",
      "  npm start        # 25 free Nola runs — key in .env",
    ].join("\n");
    expect(styleOutro(plain, colors)).toBe(
      [
        "<g>Scaffolded</g> <b>nola-app</b> <dim>(11 files)</dim>.",
        "",
        "<b>Next steps:</b>",
        "  <c>cd nola-app</c>",
        "  <c>npm start        </c><dim># 25 free Nola runs — key in .env</dim>",
      ].join("\n"),
    );
  });

  it("accents the add outro, whose steps carry no hint", () => {
    const plain = ["Added Nola: nola.config.ts, package.json.", "", "Next steps:", "  npm install"].join("\n");
    expect(styleOutro(plain, colors)).toBe(
      ["<g>Added Nola:</g> <b>nola.config.ts, package.json</b>.", "", "<b>Next steps:</b>", "  <c>npm install</c>"].join(
        "\n",
      ),
    );
  });

  it("leaves lines it does not recognize untouched", () => {
    expect(styleOutro("Cancelled.", colors)).toBe("Cancelled.");
  });

  it("uses real colours by default and stays a no-op for the text itself", () => {
    const styled = styleOutro("Next steps:\n  npm start");
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI is the point
    expect(styled.replace(/\x1b\[[0-9;]*m/g, "")).toBe("Next steps:\n  npm start");
  });
});

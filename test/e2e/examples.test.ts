import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { cp, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { capture, ensureBuilt } from "./helpers/ensure-built.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CLI = join(ROOT, "packages", "nola-lang", "dist", "main.js");

interface Example {
  dir: string;
  /** basename of the .tsi source — build must emit dist/src/<tsi>.tsi.js + .tsi.d.ts */
  tsi: string;
  /** JSON printed by `nola run src/main.ts` under the mock provider */
  expected: unknown;
}

const EXAMPLES: Example[] = [
  {
    dir: "extract-person",
    tsi: "person",
    expected: { name: "Alice Smith", age: 32, employer: "Acme Corp", job: "staff engineer" },
  },
  {
    dir: "extract-resume",
    tsi: "resume",
    expected: {
      name: "Grace Hopper",
      email: "grace@example.com",
      experience: ["United States Navy programmer (1943-1966)", "Eckert-Mauchly, worked on UNIVAC I (1949-1954)"],
      skills: ["COBOL", "compilers"],
      education: [{ school: "Yale University", degree: "PhD in Mathematics", year: 1934 }],
    },
  },
  {
    dir: "extract-invoice",
    tsi: "invoice",
    expected: {
      invoiceNumber: "INV-2042",
      issuedTo: "Acme Corp",
      lineItems: [
        { description: "widget", quantity: 3, unitPrice: 19.99 },
        { description: "gizmo", quantity: 1, unitPrice: 250 },
      ],
      total: 309.97,
      dueDate: "2026-08-01",
    },
  },
  {
    dir: "classify-message",
    tsi: "classify",
    expected: { category: "refund", sentiment: "negative", urgent: true },
  },
  {
    dir: "cross-file-types",
    tsi: "report",
    expected: {
      result: {
        name: "Ada",
        home: { city: "London", zip: "N1" },
        manager: { name: "Grace", home: { city: "NYC", zip: "10001" } },
      },
      // schema.ts: the view of models.ts, imported from plain TS as `./models.tsi`
      required: ["name", "home"],
    },
  },
  {
    dir: "rich-types",
    tsi: "events",
    // discriminated union + Partial + Record (checker-backed derivation, emit 15);
    // disputedAt is revived to a Date and printed back as ISO by JSON.stringify
    expected: {
      event: { kind: "chargeback", reason: "disputed charge", disputedAt: "2026-01-03T00:00:00.000Z" },
      branches: 2,
      draftRequired: [],
      counts: false,
    },
  },
  {
    dir: "constraints",
    tsi: "signup",
    // JSDoc constraint tags (emit 16): the mock's first reply breaks four keywords,
    // the correction turn lists every issue, the second reply is accepted
    expected: {
      signup: { email: "ada@example.com", handle: "ada_l", age: 36, tags: ["ts", "nola"] },
      emailFormat: "email",
      age: ["integer", 13],
      issues: [
        'email: expected a valid email, got "not-an-email"',
        "handle: expected at least 3 characters, got 1",
        'handle: expected a string matching ^[a-z0-9_]+$, got "A"',
        "age: expected an integer, got 12.5",
        "age: expected a number ≥ 13, got 12.5",
        "tags: expected at least 1 item, got 0",
      ],
    },
  },
  {
    dir: "chain-of-thought",
    tsi: "solve",
    expected: {
      reasoning: "Roger starts with 5 balls. 2 cans of 3 balls each is 6 balls. 5 + 6 = 11.",
      answer: 11,
    },
  },
  {
    dir: "recursive-tree",
    tsi: "tree",
    expected: {
      label: "filesystem",
      children: [{ label: "src", children: [{ label: "main.ts" }] }, { label: "docs" }],
    },
  },
  {
    dir: "contextual-args",
    tsi: "issue",
    expected: { kind: "technical" },
  },
  {
    dir: "prompt-template",
    tsi: "triage",
    expected: { id: "T-4711" },
  },
  {
    dir: "research-notes",
    tsi: "research",
    expected: {
      answer: "Kinnairdy Castle, which David Gregory inherited in 1664, has five storeys and a garret.",
      evidence: [
        "David Gregory inherited Kinnairdy Castle in 1664.",
        "Kinnairdy Castle has five storeys and a garret.",
      ],
    },
  },
  {
    dir: "file-ticket",
    tsi: "tickets",
    expected: {
      filed: ["T-1", "T-2"],
      tickets: [
        { id: "T-1", title: "Checkout page shows a blank screen after paying", priority: 2 },
        { id: "T-2", title: "Checkout blank after payment; charged twice", priority: 1 },
      ],
    },
  },
];

beforeAll(async () => {
  await ensureBuilt(ROOT);
}, 300_000);

describe.each(EXAMPLES)("examples/$dir end-to-end", ({ dir, tsi, expected }) => {
  const cwd = join(ROOT, "examples", dir);

  it("nola run executes the .tsi via the mock provider", { timeout: 120_000 }, async () => {
    const stdout = await capture(process.execPath, [CLI, "run", "src/main.ts"], { cwd });
    expect(JSON.parse(stdout.trim())).toEqual(expected);
  });

  it("nola build emits js + declarations into dist, never into src", { timeout: 120_000 }, async () => {
    await capture(process.execPath, [CLI, "build", ".", "--out", "dist"], { cwd });
    expect(existsSync(join(cwd, "dist", "src", `${tsi}.tsi.js`))).toBe(true);
    expect(existsSync(join(cwd, "dist", "src", `${tsi}.tsi.d.ts`))).toBe(true);
    expect(existsSync(join(cwd, "src", `${tsi}.d.tsi.ts`))).toBe(false);
  });

  it("nola check passes on the example (main.ts included — the vue-tsc role)", { timeout: 120_000 }, async () => {
    const stdout = await capture(process.execPath, [CLI, "check", "."], { cwd });
    expect(stdout).toContain("no errors");
  });
});

describe("real OpenAI smoke (extract-person)", () => {
  it.skipIf(!process.env.OPENAI_API_KEY)("extracts a typed person", { timeout: 180_000 }, async () => {
    // e2e-owned override: the example's committed config is mock-only, so the
    // live-provider variant copies it aside and swaps the config.
    const dir = join(await mkdtemp(join(tmpdir(), "nola-openai-smoke-")), "app");
    await cp(join(ROOT, "examples", "extract-person"), dir, {
      recursive: true,
      filter: (src) => !/node_modules|[\\/]dist([\\/]|$)/.test(src),
    });
    await writeFile(
      join(dir, "nola.config.ts"),
      `import { openai } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";

export default defineConfig({ model: { default: openai() } });
`,
    );
    const scope = join(dir, "node_modules", "@nola-lang");
    mkdirSync(scope, { recursive: true });
    for (const pkg of ["runtime", "providers"]) {
      symlinkSync(join(ROOT, "packages", pkg), join(scope, pkg), "junction");
    }
    const stdout = await capture(process.execPath, [CLI, "run", "src/main.ts"], { cwd: dir });
    const result = JSON.parse(stdout.trim()) as { name: string; age: number; employer: string; job: string };
    expect(result.name.length).toBeGreaterThan(0);
    expect(typeof result.age).toBe("number");
    expect(typeof result.employer).toBe("string");
    expect(typeof result.job).toBe("string");
  });
});

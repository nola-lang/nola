import { execFileSync } from "node:child_process";
import { mkdirSync, symlinkSync } from "node:fs";
import { cp, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureBuilt } from "./helpers/ensure-built.js";

// The shipped examples stay free of test scaffolding: these typed consumers
// used to live in each example's src/main.ts. The suite injects them into a
// throwaway copy of the example and runs `nola check`, proving the `.tsi`
// types flow into plain TS (the annotations below fail to type-check if an
// infer function's return ever degrades to `any` or loses a member).

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CLI = join(ROOT, "packages", "nola-lang", "dist", "main.js");

interface TypedConsumer {
  dir: string;
  /** plain-TS consumer written to src/typed-consumer.ts before `nola check` */
  consumer: string;
}

const CASES: TypedConsumer[] = [
  {
    dir: "extract-person",
    consumer: `import { extractPerson } from "./person.tsi";

export async function typedConsumer(): Promise<number> {
  const person = await extractPerson("Alice Smith, 32, staff engineer at Acme Corp.");
  return person.age; // typed as number across the .tsi boundary
}
`,
  },
  {
    dir: "extract-resume",
    consumer: `import { extractResume } from "./resume.tsi";

export async function typedConsumer(): Promise<string[]> {
  const resume = await extractResume("Grace Hopper — grace@example.com. Skills: COBOL, compilers.");
  return resume.skills; // typed as string[] across the .tsi boundary
}
`,
  },
  {
    dir: "extract-invoice",
    consumer: `import { extractInvoice } from "./invoice.tsi";

export async function typedConsumer(): Promise<number> {
  const invoice = await extractInvoice("INVOICE #INV-1: 1 x widget @ $5. Total: $5.");
  // lineItems is typed as LineItem[] across the .tsi boundary
  return invoice.lineItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
}
`,
  },
  {
    dir: "classify-message",
    consumer: `import { classifyMessage, Sentiment } from "./classify.tsi";

export async function typedConsumer(): Promise<boolean> {
  const classified = await classifyMessage("Please refund order #88.");
  // category narrows against the union; sentiment compares against the enum member
  return classified.category === "refund" && classified.sentiment !== Sentiment.Positive;
}
`,
  },
  {
    dir: "cross-file-types",
    consumer: `import { extractPerson } from "./report.tsi";

export async function typedConsumer(): Promise<string | undefined> {
  const p = await extractPerson("someone");
  return p.manager?.home.city; // recursive imported type, fully typed
}
`,
  },
  {
    dir: "chain-of-thought",
    consumer: `import { solve } from "./solve.tsi";

export async function typedConsumer(): Promise<number> {
  const solved = await solve("What is 2 + 2?");
  return solved.answer; // typed as number across the .tsi boundary
}
`,
  },
  {
    dir: "recursive-tree",
    consumer: `import { parseTree } from "./tree.tsi";

export async function typedConsumer(): Promise<string | undefined> {
  const tree = await parseTree("root with one child");
  return tree.children?.[0]?.label; // typed recursively across the .tsi boundary
}
`,
  },
  {
    dir: "research-notes",
    consumer: `import { conclude, nextQuery } from "./research.tsi";

export async function typedConsumer(): Promise<string> {
  const query = await nextQuery("example question", []);
  const conclusion = await conclude("example question", [query]);
  return conclusion.answer; // typed as string across the .tsi boundary
}
`,
  },
];

/** Copy an example into a tmp dir and link the workspace runtime/providers. */
async function copyExample(dir: string): Promise<string> {
  const copy = join(await mkdtemp(join(tmpdir(), "nola-example-types-")), "app");
  await cp(join(ROOT, "examples", dir), copy, {
    recursive: true,
    filter: (src) => !/node_modules|[\\/]dist([\\/]|$)/.test(src),
  });
  const scope = join(copy, "node_modules", "@nola-lang");
  mkdirSync(scope, { recursive: true });
  // ast + core must be linked too: TypeScript resolves the runtime's .d.ts
  // through the junction path (no realpath), so its `@nola-lang/core` imports
  // walk up inside the copy — unresolved, skipLibCheck degrades Intent<T> to
  // `any` and every assertion below passes vacuously.
  for (const pkg of ["runtime", "providers", "ast", "core"]) {
    symlinkSync(join(ROOT, "packages", pkg), join(scope, pkg), "junction");
  }
  return copy;
}

beforeAll(async () => {
  await ensureBuilt(ROOT);
}, 300_000);

describe.each(CASES)("examples/$dir type flow", ({ dir, consumer }) => {
  it("nola check accepts a typed plain-TS consumer of the .tsi exports", { timeout: 120_000 }, async () => {
    const copy = await copyExample(dir);
    await writeFile(join(copy, "src", "typed-consumer.ts"), consumer);
    const stdout = execFileSync(process.execPath, [CLI, "check", "."], { cwd: copy, encoding: "utf8" });
    expect(stdout).toContain("no errors");
  });
});

describe("negative control", () => {
  // Proves the injected consumer actually joins the checked program: a wrong
  // annotation must FAIL check, or every case above passes vacuously.
  it("a mis-annotated consumer fails nola check", { timeout: 120_000 }, async () => {
    const copy = await copyExample("extract-person");
    await writeFile(
      join(copy, "src", "typed-consumer.ts"),
      `import { extractPerson } from "./person.tsi";

export async function typedConsumer(): Promise<string> {
  const person = await extractPerson("Alice Smith, 32, staff engineer at Acme Corp.");
  return person.age; // number is NOT assignable to string
}
`,
    );
    let stderr = "";
    try {
      execFileSync(process.execPath, [CLI, "check", "."], { cwd: copy, encoding: "utf8" });
    } catch (err) {
      stderr = (err as { stderr?: string }).stderr ?? "";
    }
    expect(stderr).toContain("typed-consumer.ts");
  });
});

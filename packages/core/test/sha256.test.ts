import { createHash } from "node:crypto";
import { sha256Hex } from "@nola-lang/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sha256HexJs } from "../src/sha256.js";

const node = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

describe("sha256HexJs (plain JS — what a browser runs; held to node:crypto)", () => {
  it("matches the FIPS 180-4 vectors", () => {
    expect(sha256HexJs("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256HexJs("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256HexJs("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
    expect(sha256HexJs("a".repeat(1_000_000))).toBe("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
  });

  it("agrees with node:crypto on block boundaries and multibyte text", () => {
    for (const n of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 121, 1000]) {
      const s = "x".repeat(n);
      expect(sha256HexJs(s), `length ${n}`).toBe(node(s));
    }
    for (const s of ["é", "日本語テキスト", "emoji 🙂🚀", "mixed: ascii + ü + 𝄞 + \u0000 + ￿", "ask `the person`: Person"]) {
      expect(sha256HexJs(s), s).toBe(node(s));
    }
  });

  it("agrees with node:crypto on random strings", () => {
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 200; i++) {
      const len = Math.floor(rand() * 300);
      let s = "";
      for (let j = 0; j < len; j++) s += String.fromCodePoint(Math.floor(rand() * 0x2ffff) + 1);
      s = s.replace(/[\ud800-\udfff]/g, "?"); // no lone surrogates: JSON-safe text only
      expect(sha256HexJs(s)).toBe(node(s));
    }
  });
});

describe("sha256Hex (the host's digest: node:crypto where Node offers it, plain JS elsewhere)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("hashes through node:crypto when process.getBuiltinModule hands it out", () => {
    const asked: string[] = [];
    vi.spyOn(process, "getBuiltinModule").mockImplementation(((id: string) => {
      asked.push(id);
      return {
        createHash: (algorithm: string) => ({
          update: (text: string, encoding: string) => ({ digest: (out: string) => `native ${algorithm} ${encoding} ${out} ${text}` }),
        }),
      };
    }) as never);
    expect(sha256Hex("abc")).toBe("native sha256 utf8 hex abc");
    expect(asked).toEqual(["node:crypto"]);
  });

  it("hashes in plain JS where there is no Node", () => {
    const saved = globalThis.process;
    Object.defineProperty(globalThis, "process", { value: undefined, configurable: true, writable: true });
    try {
      expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    } finally {
      Object.defineProperty(globalThis, "process", { value: saved, configurable: true, writable: true });
    }
  });

  it("hashes in plain JS when process has no getBuiltinModule (Node 22.0–22.2, or a process shim)", () => {
    vi.spyOn(process, "getBuiltinModule").mockReturnValue(undefined as never);
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("is one digest either way", () => {
    for (const s of ["", "abc", "日本語テキスト", "ask `the person`: Person", "x".repeat(1000)]) {
      expect(sha256Hex(s), s).toBe(sha256HexJs(s));
    }
  });
});

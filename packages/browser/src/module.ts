// The program as a module the host's loader can import: an inline map and a stable name, the
// runtime import pointed at the host's own runtime module, a blob URL to import it from.

const encoder = new TextEncoder();

/** Base64 of the UTF-8 bytes of `text` — `btoa` alone would choke on a non-Latin-1 character in a source. */
function base64Utf8(text: string): string {
  const bytes = encoder.encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * The module text with its debug map inline and a stable `//# sourceURL`: DevTools shows the
 * `.tsi` (the map's one source, content embedded) at a pause, and a breakpoint set on it survives
 * the next run's fresh blob because the name is the same (the loader appends its map the same way,
 * packages/node-loader/src/hooks.ts). `scriptUrl` names the SCRIPT and must differ from the map's
 * source name: DevTools binds a stored breakpoint through every source carrying its URL, so a
 * script named like the `.tsi` would take the breakpoint a second time, raw by line on the
 * generated text — one statement early after an infer function. (Node's loader cannot choose: its
 * script IS the `.tsi` path, which is why its layout is load-bearing; a browser host names both.)
 */
export function withInlineMap(code: string, map: string, scriptUrl: string): string {
  const body = code.endsWith("\n") ? code : `${code}\n`;
  return `${body}//# sourceMappingURL=data:application/json;base64,${base64Utf8(map)}\n//# sourceURL=${scriptUrl}\n`;
}

const RUNTIME = "@nola-lang/runtime";
// static `import … from "x"`, side-effect `import "x"`, `export … from "x"`, dynamic `import("x")`
const IMPORT_RE =
  /(?:^|[;\s])(?:import|export)\b[^'"`;]*?\bfrom\s*(['"])([^'"]+)\1|(?:^|[;\s])import\s*(['"])([^'"]+)\3|\bimport\s*\(\s*(['"])([^'"]+)\5\s*\)/g;

export interface RewrittenImports {
  /** the module text with every `@nola-lang/runtime` import pointed at `runtimeUrl` */
  code: string;
  /** every other specifier the module imports, in source order — the host decides what to do with them (a single-file playground refuses) */
  imports: string[];
}

/**
 * Points the program's `@nola-lang/runtime` import (the appendix's `import { __nola } …`) at the
 * module URL the host provides for its one runtime instance, and reports every other specifier:
 * a browser host has no node_modules to resolve them against, so what to do with `./helpers.js`
 * is its call.
 */
export function rewriteRuntimeImport(js: string, runtimeUrl: string): RewrittenImports {
  const imports: string[] = [];
  for (const m of js.matchAll(IMPORT_RE)) {
    const specifier = m[2] ?? m[4] ?? m[6];
    if (specifier && specifier !== RUNTIME) imports.push(specifier);
  }
  const code = js.replace(/(from\s*)(['"])@nola-lang\/runtime\2/g, `$1"${runtimeUrl}"`);
  return { code, imports };
}

/** A `blob:` URL for the module text, importable by `import()` on the same origin — revoke it once imported. */
export function blobModuleUrl(js: string): string {
  return URL.createObjectURL(new Blob([js], { type: "text/javascript" }));
}

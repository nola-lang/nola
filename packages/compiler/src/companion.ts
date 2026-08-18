import {
  type BaseNode,
  type Diagnostic,
  type ExportNamedDeclarationNode,
  programBody,
  type TSEnumDeclarationNode,
  type TSInterfaceDeclarationNode,
  type TSTypeAliasDeclarationNode,
} from "@nola-lang/ast";
import { NOLA_EMIT } from "@nola-lang/core";
import { parseNola } from "@nola-lang/parser";
import { companionSpecifierFor } from "./companion-name.js";
import { displayPathFor } from "./path.js";
import { collectTypeRegistry } from "./schema.js";
import {
  accessorNameFor,
  buildAccessorPlan,
  type CompanionImport,
  collectTypeImports,
  type DeriveContext,
  deriveTypeExpr,
} from "./schema-expr.js";
import type { CompileOptions } from "./types.js";

export interface CompanionResult {
  /** a TS module; "" when the source could not be parsed at all */
  code: string;
  /** companion specifiers THIS module imports (transitive worklist fuel) */
  companions: string[];
  diagnostics: Diagnostic[];
}

/** Exported type/interface/enum names, in declaration order. */
function collectExportedTypeNames(ast: BaseNode): string[] {
  const out: string[] = [];
  for (const stmt of programBody(ast)) {
    if (stmt.type !== "ExportNamedDeclaration") continue;
    const decl = (stmt as ExportNamedDeclarationNode).declaration;
    if (!decl) continue;
    if (
      decl.type === "TSTypeAliasDeclaration" ||
      decl.type === "TSInterfaceDeclaration" ||
      decl.type === "TSEnumDeclaration"
    ) {
      const name = (decl as TSTypeAliasDeclarationNode | TSInterfaceDeclarationNode | TSEnumDeclarationNode).id?.name;
      if (name) out.push(name);
    }
  }
  return out;
}

/**
 * Derive the companion module of one source file: an accessor per exported
 * type (plus reachable private helpers), re-exported under the type's own
 * name (`<Name>` — companions are INTERNAL, only generated code imports
 * them, so the export name needs no user-facing disambiguation). Every
 * accessor is a hoisted `function` declaration and exports are aliases — ESM
 * initializes function bindings during instantiation, which is what makes
 * CIRCULAR companion imports work. All refs are `<moduleId>#`-qualified so
 * same-named types from different files stay distinct in one $defs. Pure —
 * same inputs as compileNola; hosts do all I/O and probing.
 */
export function compileCompanion(source: string, file: string, options: CompileOptions = {}): CompanionResult {
  const { ast, diagnostics } = parseNola(source, file, { tolerant: true });
  if (!ast) return { code: "", companions: [], diagnostics };

  const displayFile = displayPathFor(file, options.sourceRoot);
  const moduleId = displayFile.replace(/\\/g, "/").replace(/\.(?:tsi|ts|js)$/, "");
  const registry = collectTypeRegistry(ast);
  const ctx: DeriveContext = {
    source,
    registry,
    imports: collectTypeImports(ast),
    importerDisplayFile: displayFile,
    refQualifier: `${moduleId}#`,
  };

  const exported = collectExportedTypeNames(ast).filter((n) => registry.has(n));
  const accessors = new Map<string, string>(); // name -> full statement text
  const companionImports = new Map<string, CompanionImport>();

  const plan = buildAccessorPlan(new Set(exported), ctx);
  for (const [local, imp] of plan.companions) companionImports.set(local, imp);
  for (const [name, expr] of plan.accessors) {
    accessors.set(name, `function ${accessorNameFor(name)}(): InferType<unknown> { return ${expr}; }`);
  }
  // Exported types the plan could not derive become unsupported accessors: the
  // module still compiles, and the failure surfaces at the USE site as a TS
  // error carrying the reason (UnsupportedType<Reason>) or NOLA3009 at run
  // time if it executes anyway.
  for (const name of exported) {
    if (accessors.has(name)) continue;
    const decl = registry.get(name) as BaseNode;
    const derived = deriveTypeExpr(decl, ctx);
    const reason = derived.ok ? "internal: derivation succeeded on retry" : derived.message;
    const literal = JSON.stringify(reason);
    accessors.set(
      name,
      `function ${accessorNameFor(name)}(): UnsupportedType<${literal}> { return __nola.types.unsupported(${literal}) as UnsupportedType<${literal}>; }`,
    );
  }

  const lines: string[] = [
    `import { __nola } from "@nola-lang/runtime";`,
    `__nola.useRuntime(${NOLA_EMIT});`,
    `import type { InferType, UnsupportedType } from "@nola-lang/runtime";`,
  ];
  for (const [local, imp] of companionImports) {
    lines.push(
      `import { ${imp.importedName} as ${accessorNameFor(local)} } from ${JSON.stringify(companionSpecifierFor(imp.specifier))};`,
    );
  }
  for (const body of accessors.values()) lines.push(body);
  if (exported.length > 0) {
    lines.push(`export { ${exported.map((n) => `${accessorNameFor(n)} as ${n}`).join(", ")} };`);
  }
  const companions = [...new Set([...companionImports.values()].map((i) => companionSpecifierFor(i.specifier)))].sort();
  return { code: `${lines.join("\n")}\n`, companions, diagnostics };
}

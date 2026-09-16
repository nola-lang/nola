import { type BaseNode, type ImportDeclarationNode, type ImportSpecifierNode, programBody } from "@nola-lang/ast";

/**
 * What survives of the syntactic derivation module since emit 15: the
 * accessor naming rule and the import collector. Derivation itself is the
 * checker walk in @nola-lang/derive (finalizeDerivations consumes its answers).
 */

/** A named type/value import a derivation reached (`import { Person } from "./models.js"`). */
export interface TypeImport {
  specifier: string;
  importedName: string;
}

export function accessorNameFor(typeName: string): string {
  return `__nola_type_${typeName}`;
}

/** All named ImportSpecifier bindings (type or value; default/namespace skipped). */
export function collectTypeImports(ast: BaseNode): Map<string, TypeImport> {
  const out = new Map<string, TypeImport>();

  const importDecls = programBody(ast).filter((n) => n.type === "ImportDeclaration") as ImportDeclarationNode[];
  for (const decl of importDecls) {
    const specifier = decl.source?.value;
    if (!specifier) continue;

    const specs = decl.specifiers?.filter((s) => s.type === "ImportSpecifier") as ImportSpecifierNode[];
    for (const spec of specs ?? []) {
      const imported = spec.imported;
      const local = spec.local?.name;
      const importedName = imported?.type === "StringLiteral" ? imported.value : imported?.name;

      if (importedName && local) out.set(local, { specifier, importedName });
    }
  }

  return out;
}

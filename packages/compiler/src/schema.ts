import {
  type BaseNode,
  type ExportNamedDeclarationNode,
  programBody,
  type TSEnumDeclarationNode,
  type TSInterfaceDeclarationNode,
  type TSTypeAliasDeclarationNode,
} from "@nola-lang/ast";

/**
 * Declaration collectors the lowerer and the view compiler need. Schema
 * derivation itself is the checker walk in @nola-lang/derive since emit 15;
 * the syntactic `deriveSchema` that lived here is gone.
 */

/** Top-level non-generic `type X = {…}` / `interface X {…}` by name. */
export function collectTypeRegistry(ast: BaseNode): Map<string, BaseNode> {
  const registry = new Map<string, BaseNode>();
  for (const raw of programBody(ast)) {
    const stmt = (raw.type === "ExportNamedDeclaration" ? (raw as ExportNamedDeclarationNode).declaration : raw) ?? raw;
    if (stmt.type === "TSTypeAliasDeclaration") {
      const alias = stmt as TSTypeAliasDeclarationNode;
      if (!alias.typeParameters) registry.set(alias.id?.name ?? "", alias.typeAnnotation);
    } else if (stmt.type === "TSInterfaceDeclaration") {
      const iface = stmt as TSInterfaceDeclarationNode;
      if (!iface.typeParameters && !iface.extends?.length) registry.set(iface.id?.name ?? "", iface);
    } else if (stmt.type === "TSEnumDeclaration") {
      registry.set((stmt as TSEnumDeclarationNode).id?.name ?? "", stmt);
    }
  }
  registry.delete("");
  return registry;
}

export interface ExportedTypeDecl {
  name: string;
  kind: "alias" | "interface" | "enum";
  /** the TS declaration node */
  node: BaseNode;
  /** the ExportNamedDeclaration wrapping it (insert point for the value export) */
  statement: BaseNode;
}

/** Exported type-ish declarations, in declaration order (`export { X }` lists are out of scope, spec §1). */
export function collectExportedTypeNames(ast: BaseNode): ExportedTypeDecl[] {
  const out: ExportedTypeDecl[] = [];
  for (const stmt of programBody(ast)) {
    if (stmt.type !== "ExportNamedDeclaration") continue;
    const decl = (stmt as ExportNamedDeclarationNode).declaration;
    if (!decl) continue;
    const kind =
      decl.type === "TSTypeAliasDeclaration"
        ? "alias"
        : decl.type === "TSInterfaceDeclaration"
          ? "interface"
          : decl.type === "TSEnumDeclaration"
            ? "enum"
            : undefined;
    if (!kind) continue;
    const name = (decl as TSTypeAliasDeclarationNode | TSInterfaceDeclarationNode | TSEnumDeclarationNode).id?.name;
    if (name) out.push({ name, kind, node: decl, statement: stmt });
  }
  return out;
}

/** Top-level value bindings (const/let/var, function, class, enum), exported or not — NOLA2011 candidates. */
export function collectTopLevelValueNames(ast: BaseNode): Set<string> {
  const out = new Set<string>();
  for (const raw of programBody(ast)) {
    const stmt =
      raw.type === "ExportNamedDeclaration" || raw.type === "ExportDefaultDeclaration"
        ? ((raw as { declaration?: BaseNode }).declaration ?? raw)
        : raw;
    if (stmt.type === "VariableDeclaration") {
      const { declarations } = stmt as unknown as { declarations: Array<{ id?: { type: string; name?: string } }> };
      for (const d of declarations) {
        if (d.id?.type === "Identifier" && d.id.name) out.add(d.id.name);
      }
    } else if (
      stmt.type === "FunctionDeclaration" ||
      stmt.type === "ClassDeclaration" ||
      stmt.type === "TSEnumDeclaration"
    ) {
      const name = (stmt as { id?: { name?: string } }).id?.name;
      if (name) out.add(name);
    }
  }
  return out;
}

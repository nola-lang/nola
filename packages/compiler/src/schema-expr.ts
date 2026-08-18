import {
  type BaseNode,
  type ImportDeclarationNode,
  type ImportSpecifierNode,
  programBody,
  type StringLiteralNode,
  type TSArrayTypeNode,
  type TSEnumDeclarationNode,
  type TSEnumMemberNode,
  type TSInterfaceDeclarationNode,
  type TSLiteralTypeNode,
  type TSPropertySignatureNode,
  type TSTypeLiteralNode,
  type TSTypeReferenceNode,
  type TSUnionTypeNode,
} from "@nola-lang/ast";
import { moduleIdFor } from "./companion-name.js";
import { jsdocDescription } from "./schema.js";

export interface CompanionImport {
  specifier: string;
  importedName: string;
}

export interface DeriveContext {
  source: string;
  registry: Map<string, BaseNode>;
  /** local name -> named type/value import it came from */
  imports: Map<string, CompanionImport>;
  importerDisplayFile: string;
  /** "" in lowered .tsi files; "<moduleId>#" inside companions */
  refQualifier: string;
  /**
   * Prune mode (harvest seam only): an object member whose type fails to
   * derive is dropped instead of failing the whole object. An object that
   * prunes to empty still fails upward, so its own parent drops it too.
   */
  lossy?: boolean;
  /**
   * Named types known to be underivable even lossily. Grown iteratively by the
   * prune loop in the Lowerer: a reference to a dead name fails (and is then
   * pruned by its enclosing object like any other underivable member).
   */
  deadRefs?: Set<string>;
}

export type TypeExprResult =
  | { ok: true; expr: string; refs: Set<string>; companions: Map<string, CompanionImport> }
  | { ok: false; message: string; node: BaseNode };

export function accessorNameFor(typeName: string): string {
  return `__nola_type_${typeName}`;
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Emit-5/6 companion of deriveSchema: same supported surface, but produces a
 * `__nola.types.*` combinator expression instead of inline JSON. Named
 * registry references become ref() calls — which is what makes recursion
 * legal (toJsonSchema resolves cycles to $defs/$ref at run time) — and named
 * IMPORTS become module-qualified refs bound to companion accessors.
 */
export function deriveTypeExpr(t: BaseNode, ctx: DeriveContext): TypeExprResult {
  const refs = new Set<string>();
  const companions = new Map<string, CompanionImport>();
  const result = walk(t, ctx, refs, companions);
  return result.ok ? { ok: true, expr: result.expr, refs, companions } : result;
}

/** All named ImportSpecifier bindings (type or value; default/namespace skipped). */
export function collectTypeImports(ast: BaseNode): Map<string, CompanionImport> {
  const out = new Map<string, CompanionImport>();

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

export interface AccessorPlan {
  /** local type name -> body expr, in first-use order */
  accessors: Map<string, string>;
  /** local binding name -> companion import */
  companions: Map<string, CompanionImport>;
  errors: Array<{ name: string; message: string; node: BaseNode }>;
}

/** Transitively derive accessor bodies for named local types (worklist). */
export function buildAccessorPlan(entryRefs: Set<string>, ctx: DeriveContext): AccessorPlan {
  const plan: AccessorPlan = { accessors: new Map(), companions: new Map(), errors: [] };
  const queue = [...entryRefs];
  while (queue.length > 0) {
    const name = queue.shift() as string;
    if (plan.accessors.has(name)) continue;
    const decl = ctx.registry.get(name);
    if (!decl) continue; // the reference itself was already diagnosed
    plan.accessors.set(name, ""); // reserve slot to break cycles
    const derived = deriveTypeExpr(decl, ctx);
    if (derived.ok) {
      plan.accessors.set(name, derived.expr);
      queue.push(...derived.refs);
      for (const [local, imp] of derived.companions) plan.companions.set(local, imp);
    } else {
      plan.accessors.delete(name);
      plan.errors.push({ name, message: derived.message, node: derived.node });
    }
  }
  return plan;
}

type Inner = { ok: true; expr: string } | { ok: false; message: string; node: BaseNode };

function walk(t: BaseNode, ctx: DeriveContext, refs: Set<string>, companions: Map<string, CompanionImport>): Inner {
  switch (t.type) {
    case "TSStringKeyword":
      return { ok: true, expr: "__nola.types.string()" };
    case "TSNumberKeyword":
      return { ok: true, expr: "__nola.types.number()" };
    case "TSBooleanKeyword":
      return { ok: true, expr: "__nola.types.boolean()" };
    case "TSArrayType": {
      const inner = walk((t as TSArrayTypeNode).elementType, ctx, refs, companions);
      return inner.ok ? { ok: true, expr: `__nola.types.array(${inner.expr})` } : inner;
    }
    case "TSTypeLiteral":
      return walkObject((t as TSTypeLiteralNode).members ?? [], ctx, refs, companions, t);
    case "TSInterfaceDeclaration": {
      const bodyMembers = (t as TSInterfaceDeclarationNode).body?.body ?? [];
      return walkObject(bodyMembers, ctx, refs, companions, t);
    }
    case "TSUnionType": {
      const labels: string[] = [];
      for (const member of (t as TSUnionTypeNode).types ?? []) {
        const literal = member.type === "TSLiteralType" ? (member as TSLiteralTypeNode).literal : undefined;
        if (literal?.type !== "StringLiteral") {
          return {
            ok: false,
            message: "only unions of string literals are supported in intent schemas",
            node: member,
          };
        }
        const value = (literal as StringLiteralNode).value ?? "";
        if (!labels.includes(value)) labels.push(value);
      }
      return { ok: true, expr: `__nola.types.enum([${labels.map((l) => JSON.stringify(l)).join(",")}])` };
    }
    case "TSEnumDeclaration": {
      const decl = t as TSEnumDeclarationNode;
      const members = decl.body?.members ?? decl.members ?? [];
      const labels: string[] = [];
      for (const member of members) {
        const init = (member as TSEnumMemberNode).initializer;
        if (init?.type !== "StringLiteral") {
          return { ok: false, message: "only string-valued enums are supported in intent schemas", node: member };
        }
        const value = (init as StringLiteralNode).value ?? "";
        if (!labels.includes(value)) labels.push(value);
      }
      return { ok: true, expr: `__nola.types.enum([${labels.map((l) => JSON.stringify(l)).join(",")}])` };
    }
    case "TSTypeReference": {
      const ref = t as TSTypeReferenceNode;
      const typeName = ref.typeName;
      const hasParams = Boolean(ref.typeParameters ?? ref.typeArguments);
      if (typeName?.type !== "Identifier" || hasParams) {
        return {
          ok: false,
          message: `unsupported type for intent schema: ${ctx.source.slice(t.start, t.end)}`,
          node: t,
        };
      }
      const name = typeName.name ?? "";
      // Checked before the registry: a dead name must not re-enter refs (that
      // is what makes the prune loop's dead-ref set monotone and terminating).
      if (ctx.lossy && ctx.deadRefs?.has(name)) {
        return { ok: false, message: `type '${name}' has no derivable members`, node: t };
      }
      if (ctx.registry.has(name)) {
        refs.add(name);
        return {
          ok: true,
          expr: `__nola.types.ref(${JSON.stringify(ctx.refQualifier + name)}, ${accessorNameFor(name)})`,
        };
      }
      const imp = ctx.imports.get(name);
      if (imp) {
        if (!imp.specifier.startsWith("./") && !imp.specifier.startsWith("../")) {
          return {
            ok: false,
            message: `type '${name}' is imported from a package ("${imp.specifier}") — intent schema types must come from project files`,
            node: t,
          };
        }
        companions.set(name, imp);
        const id = moduleIdFor(ctx.importerDisplayFile, imp.specifier);
        return {
          ok: true,
          expr: `__nola.types.ref(${JSON.stringify(`${id}#${imp.importedName}`)}, ${accessorNameFor(name)})`,
        };
      }
      // Built-in Date (only when no local declaration or import shadows it):
      // wire format is an ISO 8601 string; the runtime revives it to a Date.
      if (name === "Date") return { ok: true, expr: "__nola.types.date()" };
      return {
        ok: false,
        message: `type '${name}' must be a non-generic type alias, interface, or enum declared in this file or imported with a named import`,
        node: t,
      };
    }
    default:
      return { ok: false, message: `unsupported type for intent schema: ${t.type}`, node: t };
  }
}

function walkObject(
  members: BaseNode[],
  ctx: DeriveContext,
  refs: Set<string>,
  companions: Map<string, CompanionImport>,
  owner: BaseNode,
): Inner {
  const parts: string[] = [];
  for (const member of members) {
    if (member.type !== "TSPropertySignature") {
      if (ctx.lossy) continue; // prune: methods, index signatures, ... just vanish from the description
      return { ok: false, message: `unsupported member '${member.type}' in intent schema object`, node: member };
    }
    const prop = member as TSPropertySignatureNode;
    const key = prop.key;
    const name = key?.type === "Identifier" ? key.name : key?.type === "StringLiteral" ? key.value : undefined;
    if (!name) {
      if (ctx.lossy) continue;
      return { ok: false, message: "unsupported property key in intent schema object", node: member };
    }
    const annotation = prop.typeAnnotation?.typeAnnotation;
    if (!annotation) {
      if (ctx.lossy) continue;
      return { ok: false, message: `property '${name}' needs a type annotation`, node: member };
    }
    const inner = walk(annotation, ctx, refs, companions);
    if (!inner.ok) {
      if (ctx.lossy) continue;
      return inner;
    }
    let expr = inner.expr;
    if (prop.optional) expr = `__nola.types.optional(${expr})`;
    const description = jsdocDescription(member);
    if (description) expr = `${expr}.describe(${JSON.stringify(description)})`;
    parts.push(`${IDENT.test(name) ? name : JSON.stringify(name)}: ${expr}`);
  }
  if (parts.length === 0) {
    return { ok: false, message: "empty object types are not useful as intent schemas", node: owner };
  }
  return { ok: true, expr: `__nola.types.object({ ${parts.join(", ")} })` };
}

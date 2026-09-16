import { accessorNameFor, moduleIdFor, posixDirname, posixRelative, viewSpecifierFor } from "@nola-lang/compiler";
import { sha256Hex } from "@nola-lang/core";
import type ts from "typescript";
import { assertApplicable, constraintKindOf, parseConstraintTags } from "./constraints.js";
import { TS } from "./ts.js";

/** A `.tsi` value import the walk reached: `import { <importedName> as __nola_type_<localBinding> } from "<specifier>"`. */
export interface ViewImport {
  specifier: string;
  importedName: string;
  localBinding: string;
}

/** A named type the walk reached transitively (`Person` needs `Address`); emitted once per file, first-use order. */
export type NamedAccessor = { name: string; expr: string } | { name: string; unsupported: string };

export interface WalkContext {
  checker: ts.TypeChecker;
  /** absolute path (posix or native) of the file whose appendix the answer lands in */
  importerFile: string;
  /** posix, project-relative — the `moduleId` qualifier base (emit 14) */
  importerDisplayFile: string;
  /** absolute project root; files outside it (or under node_modules) are packages */
  sourceRoot: string;
  /** prune mode: an underivable member is dropped instead of failing its object */
  lossy: boolean;
  /** Turbopack inline mode: accessor naming override (default `__nola_type_<name>`) */
  accessorName?: (local: string) => string;
}

export interface WalkOutcome {
  expr: string;
  accessors: NamedAccessor[];
  imports: ViewImport[];
  /** declaration files the walk read — bundler watch dependencies */
  deps: string[];
}

/** A type (or member) the walk cannot express as a combinator; the message names it. `code` overrides the site's diagnostic (NOLA2007). */
export class DerivationError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

const norm = (p: string): string => p.replace(/\\/g, "/");

/** A named type a ref points at: its declared name, declaration file, and symbol (for alias-level constraint tags). */
type Named = { name: string; file: string; symbol: ts.Symbol };
const IDENT = /^[A-Za-z_$][\w$]*$/;

/**
 * The checker walk (spec §4.1): resolve the type at `node` and emit the
 * `__nola.types` combinator text the emit-14 syntactic walker produced for
 * every shape it supported (byte-identical — the corpus test pins it), plus
 * the shapes only a checker can see: utility types, `extends`,
 * intersections, unions, literals, tuples, records, generics at the
 * instantiation site, package types.
 */
export function deriveType(node: ts.Node, ctx: WalkContext, declaredName?: string): WalkOutcome {
  const w = new Walker(ctx);
  const type = ctx.checker.getTypeAtLocation(node);
  const expr = w.root(type, node, declaredName);
  return { expr, accessors: w.accessors, imports: w.imports, deps: [...w.deps] };
}

class Walker {
  readonly accessors: NamedAccessor[] = [];
  readonly imports: ViewImport[] = [];
  readonly deps = new Set<string>();
  private readonly seen = new Set<string>();
  private readonly failed = new Map<string, string>();
  private readonly acc: (local: string) => string;

  constructor(private readonly ctx: WalkContext) {
    this.acc = ctx.accessorName ?? accessorNameFor;
  }

  /**
   * `declaredName` is the exported type being derived (an "exported" request):
   * its own body expands in place. Anything else that resolves to a NAMED
   * type — an extractor's `<Person>`, a `type Alias = Other` — is a ref, as
   * the syntactic walker emitted it.
   */
  root(type: ts.Type, at: ts.Node, declaredName?: string): string {
    const owner = declaredName ?? (TS.isIdentifier(at) ? at.text : this.ctx.checker.typeToString(type));
    try {
      // The name as WRITTEN wins (`<P>` refs P even when P aliases Partial<…>,
      // `<Id>` refs Id even when Id is `string`): that is what the syntactic
      // walker emitted, and what keeps $defs names meaningful.
      const written = this.writtenName(at);
      // the declaration's own name means "expand me"; `type PathParts = ParsedPath` then refs its target
      const named = written && written.name !== declaredName ? written : this.namedTarget(type);
      const expr = named && named.name !== declaredName ? this.ref(named, type) : this.walk(type, true, owner);
      return this.constrainAlias(expr, type, at, declaredName);
    } catch (e) {
      if (e instanceof DerivationError && e.message.startsWith("generic parameter ")) {
        const shown = this.ctx.checker.typeToString(type);
        throw new DerivationError(`${shown} is a generic declaration; instantiate it (e.g. ${owner}<…> with concrete arguments)`);
      }
      throw e;
    }
  }

  private walk(type: ts.Type, top: boolean, owner: string): string {
    const { checker } = this.ctx;
    const f = type.flags;
    if (f & TS.TypeFlags.TypeParameter) {
      throw new DerivationError(`generic parameter ${checker.typeToString(type)} cannot be derived`);
    }
    if (f & TS.TypeFlags.String) return "__nola.types.string()";
    if (f & TS.TypeFlags.Number) return "__nola.types.number()";
    if (f & TS.TypeFlags.Boolean) return "__nola.types.boolean()";
    if (f & TS.TypeFlags.StringLiteral) {
      return `__nola.types.enum([${JSON.stringify((type as ts.StringLiteralType).value)}])`;
    }
    if (f & TS.TypeFlags.NumberLiteral) return `__nola.types.literal(${(type as ts.NumberLiteralType).value})`;
    if (f & TS.TypeFlags.BooleanLiteral) return `__nola.types.literal(${checker.typeToString(type)})`;
    if (type.isUnion()) return this.union(type, top, owner);
    if (f & TS.TypeFlags.Object || type.isIntersection()) return this.object(type as ts.ObjectType, top, owner);
    throw new DerivationError(`unsupported type ${this.shown(type)} at ${owner}`);
  }

  private union(type: ts.UnionType, top: boolean, owner: string): string {
    const members = type.types;
    // a string enum arrives as a union of enum-literal strings — same text as a literal union
    if (members.every((m) => m.flags & TS.TypeFlags.StringLiteral)) {
      const labels = [...new Set(members.map((m) => (m as ts.StringLiteralType).value))];
      return `__nola.types.enum([${labels.map((l) => JSON.stringify(l)).join(",")}])`;
    }
    const nonNull = members.filter((m) => !(m.flags & (TS.TypeFlags.Null | TS.TypeFlags.Undefined)));
    const hasNull = members.some((m) => m.flags & TS.TypeFlags.Null);
    const hasUndefined = members.some((m) => m.flags & TS.TypeFlags.Undefined);
    const bools = nonNull.filter((m) => m.flags & TS.TypeFlags.BooleanLiteral);
    const rest = nonNull.filter((m) => !(m.flags & TS.TypeFlags.BooleanLiteral));
    const parts = [
      ...(bools.length === 2 ? ["__nola.types.boolean()"] : bools.map((m) => this.walk(m, false, owner))),
      ...rest.map((m) => this.walk(m, false, owner)),
    ];
    if (parts.length === 0) throw new DerivationError(`unsupported type ${this.ctx.checker.typeToString(type)} at ${owner}`);
    let expr = parts.length === 1 ? (parts[0] as string) : `__nola.types.union([${parts.join(", ")}])`;
    if (hasNull) expr = `__nola.types.nullable(${expr})`;
    if (hasUndefined && top) expr = `__nola.types.optional(${expr})`;
    return expr;
  }

  /**
   * A site's type node spelled as a bare reference to a project-declared
   * alias / interface / class / enum (through an import binding if need be):
   * the name and declaration file the ref should carry. Undefined for
   * anything else — inline shapes, generic instantiations, lib types.
   */
  private writtenName(at: ts.Node): Named | undefined {
    // nodeAt hands over the smallest node spanning the request: for `<P>` that
    // is the identifier inside the type reference, for `<Box<number>>` the
    // reference itself (its arguments make it wider than the name).
    let ident: ts.Identifier | undefined;
    if (TS.isTypeReferenceNode(at) && !at.typeArguments?.length && TS.isIdentifier(at.typeName)) ident = at.typeName;
    else if (TS.isIdentifier(at) && !(at.parent && TS.isTypeReferenceNode(at.parent) && at.parent.typeArguments?.length)) {
      ident = at;
    }
    if (!ident) return undefined;
    let sym = this.ctx.checker.getSymbolAtLocation(ident);
    if (sym && sym.flags & TS.SymbolFlags.Alias) {
      const target = this.ctx.checker.getAliasedSymbol(sym);
      if (!target.declarations?.length) throw this.unresolvedImport(sym, ident.text);
      sym = target;
    }
    if (!sym || !(sym.flags & (TS.SymbolFlags.TypeAlias | TS.SymbolFlags.Interface | TS.SymbolFlags.Class | TS.SymbolFlags.Enum))) {
      return undefined;
    }
    const decl = sym.declarations?.[0];
    if (!decl) return undefined;
    if ((decl as ts.DeclarationStatement & { typeParameters?: ts.NodeArray<ts.Node> }).typeParameters?.length) return undefined;
    const file = norm(decl.getSourceFile().fileName);
    return this.isLib(file) ? undefined : { name: sym.name, file, symbol: sym };
  }

  /**
   * An import binding whose module does not resolve. A relative one is the
   * `.tsi` rule's miss — `./missing.js` would have been served as
   * `./missing.tsi`, which names neither a Nola file nor a plain module — so
   * it keeps its NOLA2007 identity; a package one is a plain unresolved module.
   */
  private unresolvedImport(alias: ts.Symbol, name: string): DerivationError {
    const decl = alias.declarations?.[0];
    const importDecl = decl && TS.isImportSpecifier(decl) ? decl.parent.parent.parent : undefined;
    const spec =
      importDecl && TS.isImportDeclaration(importDecl) && TS.isStringLiteral(importDecl.moduleSpecifier)
        ? importDecl.moduleSpecifier.text
        : undefined;
    if (spec && (spec.startsWith("./") || spec.startsWith("../"))) {
      return new DerivationError(
        `"${viewSpecifierFor(spec)}" names neither a Nola file nor a TypeScript module (type '${name}')`,
        "NOLA2007",
      );
    }
    return new DerivationError(`type '${name}' is imported from a module that does not resolve${spec ? ` ("${spec}")` : ""}`);
  }

  /**
   * The name a nested reference to `type` would carry, with its declaration
   * file: an interface/class/enum symbol that is not a generic instantiation,
   * or an alias applied without arguments. Lib types (Date, Map, Promise…)
   * never name a ref — `object()` handles them.
   */
  private namedTarget(type: ts.Type): Named | undefined {
    const structural =
      ((type as ts.ObjectType).objectFlags & (TS.ObjectFlags.Mapped | TS.ObjectFlags.Anonymous)) !== 0 ||
      type.isIntersection();
    const nominal = structural ? undefined : this.nominalName(type);
    const sym = nominal ? type.getSymbol() : type.aliasSymbol && !type.aliasTypeArguments?.length ? type.aliasSymbol : undefined;
    const decl = sym?.declarations?.[0];
    if (!sym || !decl) return undefined;
    const file = norm(decl.getSourceFile().fileName);
    if (this.isLib(file)) return undefined;
    return { name: sym.name, file, symbol: sym };
  }

  private object(type: ts.ObjectType, top: boolean, owner: string): string {
    const { checker } = this.ctx;
    if (checker.isArrayType(type)) {
      const [item] = checker.getTypeArguments(type as ts.TypeReference);
      return `__nola.types.array(${this.walk(item as ts.Type, false, owner)})`;
    }
    // Lib-declared NOMINAL types: Date derives, the rest (Map, Set, Promise,
    // RegExp, …) are unsupported whatever their arguments. Mapped types
    // (Partial<X>, Record<K, V>) are declared in lib too but are structural.
    const libSym = type.getSymbol();
    const libDecl = libSym?.declarations?.[0];
    const isMapped = (type.objectFlags & TS.ObjectFlags.Mapped) !== 0;
    if (libSym && libDecl && !isMapped && this.isLib(norm(libDecl.getSourceFile().fileName)) && !checker.isTupleType(type)) {
      if (libSym.name === "Date") return "__nola.types.date()";
      throw new DerivationError(`unsupported type ${this.shown(type)} at ${owner}`);
    }
    if (!top) {
      const named = this.namedTarget(type);
      if (named) return this.ref(named, type);
    }
    const nominal = this.nominalName(type);
    if (checker.isTupleType(type)) {
      const target = (type as ts.TypeReference).target as ts.TupleType;
      const items = checker.getTypeArguments(type as ts.TypeReference).map((t, i) => {
        const flags = target.elementFlags[i] ?? 0;
        if (flags & TS.ElementFlags.Rest) {
          throw new DerivationError(`unsupported rest element in tuple ${checker.typeToString(type)} at ${owner}`);
        }
        const e = this.walk(flags & TS.ElementFlags.Optional ? this.stripUndefined(t) : t, false, owner);
        return flags & TS.ElementFlags.Optional ? `__nola.types.optional(${e})` : e;
      });
      return `__nola.types.tuple([${items.join(", ")}])`;
    }
    if (type.getCallSignatures().length > 0) {
      throw new DerivationError(`unsupported function type ${checker.typeToString(type)} at ${owner}`);
    }
    const name = nominal ?? type.aliasSymbol?.name ?? owner;
    const parts: string[] = [];
    for (const prop of checker.getPropertiesOfType(type)) {
      try {
        const propType = checker.getTypeOfSymbol(prop);
        if (propType.getCallSignatures().length > 0 && !propType.isUnion()) {
          throw new DerivationError(`unsupported method '${prop.name}' of ${name}`);
        }
        const optional = Boolean(prop.flags & TS.SymbolFlags.Optional);
        const inner = optional ? this.stripUndefined(propType) : propType;
        const owner = `property '${prop.name}' of ${name}`;
        const writtenAlias = this.writtenPropertyAlias(prop, inner);
        let expr = writtenAlias ? this.ref(writtenAlias, inner) : this.walk(inner, false, owner);
        // JSDoc constraint tags (emit 16) wrap the member's own expression —
        // inside `optional` (absence is not a value), outside `nullable`
        // (the runtime routes the keywords to the non-null branch)
        expr = this.constrain(expr, prop, inner, owner);
        if (optional) expr = `__nola.types.optional(${expr})`;
        const doc = this.docText(prop);
        if (doc) expr = `${expr}.describe(${JSON.stringify(doc)})`;
        parts.push(`${IDENT.test(prop.name) ? prop.name : JSON.stringify(prop.name)}: ${expr}`);
      } catch (e) {
        // prune drops underivable members, never a malformed constraint tag (an authoring error)
        if (this.ctx.lossy && e instanceof DerivationError && e.code !== "NOLA2012") continue;
        throw e;
      }
    }
    const indexInfos = checker.getIndexInfosOfType(type);
    if (indexInfos.some((i) => i.keyType.flags & TS.TypeFlags.Number)) {
      throw new DerivationError(`unsupported number index signature at ${owner}`);
    }
    const index = indexInfos.find((i) => i.keyType.flags & TS.TypeFlags.String);
    if (index) {
      const value = this.walk(index.type, false, `index signature of ${name}`);
      return parts.length === 0
        ? `__nola.types.record(${value})`
        : `__nola.types.object({ ${parts.join(", ")} }, { additional: ${value} })`;
    }
    if (parts.length === 0) {
      throw new DerivationError(
        this.ctx.lossy ? `type ${name} has no derivable members` : `empty object types are not useful as intent schemas (${name})`,
      );
    }
    return `__nola.types.object({ ${parts.join(", ")} })`;
  }

  /** `expr.constrain({…})` from the symbol's constraint tags, after checking every keyword fits the type's kind. */
  private constrain(expr: string, symbol: ts.Symbol, type: ts.Type, owner: string): string {
    const { checker } = this.ctx;
    const c = parseConstraintTags(symbol, checker, owner);
    if (!c) return expr;
    assertApplicable(c, constraintKindOf(type, checker), owner, this.shown(type));
    return `${expr}.constrain(${JSON.stringify(c)})`;
  }

  /** The tags of a `type X = …` declaration being derived apply to its whole body (or to the ref it resolves to). */
  private constrainAlias(expr: string, type: ts.Type, at: ts.Node, declaredName: string | undefined): string {
    if (!declaredName || !TS.isIdentifier(at)) return expr;
    const sym = this.ctx.checker.getSymbolAtLocation(at);
    return sym ? this.constrainAliasSymbol(expr, sym, type, declaredName) : expr;
  }

  /** Only a `type X = …` declaration's tags are constraints; interface/class/enum-level tags are ignored. */
  private constrainAliasSymbol(expr: string, sym: ts.Symbol, type: ts.Type, name: string): string {
    const decl = sym.declarations?.[0];
    if (!decl || !TS.isTypeAliasDeclaration(decl)) return expr;
    return this.constrain(expr, sym, type, `type ${name}`);
  }

  /**
   * A property written as a bare reference to a project alias whose resolved
   * type carries no name of its own (`type Id = string; id: Id` — the checker
   * hands back the intrinsic `string`): the name as WRITTEN wins here too,
   * so the alias's constraint tags (and its $defs entry) survive. Types that
   * keep their alias/nominal symbol take the usual namedTarget route.
   */
  private writtenPropertyAlias(prop: ts.Symbol, inner: ts.Type): Named | undefined {
    if (this.namedTarget(inner)) return undefined;
    const decl = prop.declarations?.find((d) => TS.isPropertySignature(d) || TS.isPropertyDeclaration(d)) as
      | ts.PropertySignature
      | ts.PropertyDeclaration
      | undefined;
    const typeNode = decl?.type;
    if (!typeNode || !TS.isTypeReferenceNode(typeNode) || typeNode.typeArguments?.length || !TS.isIdentifier(typeNode.typeName)) {
      return undefined;
    }
    const named = this.writtenName(typeNode.typeName);
    return named && named.symbol.flags & TS.SymbolFlags.TypeAlias ? named : undefined;
  }

  /** Same collapse as the syntactic walker's jsdocDescription: lines trimmed and joined by one space. */
  private docText(prop: ts.Symbol): string | undefined {
    const text = TS.displayPartsToString(prop.getDocumentationComment(this.ctx.checker));
    const collapsed = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .join(" ")
      .trim();
    return collapsed.length > 0 ? collapsed : undefined;
  }

  private stripUndefined(t: ts.Type): ts.Type {
    if (!t.isUnion()) return t;
    const rest = t.types.filter((m) => !(m.flags & TS.TypeFlags.Undefined));
    if (rest.length === t.types.length) return t;
    return rest.length === 1 ? (rest[0] as ts.Type) : this.ctx.checker.getNonNullableType(t);
  }

  private nominalName(type: ts.Type): string | undefined {
    const sym = type.getSymbol();
    if (!sym || !(sym.flags & (TS.SymbolFlags.Interface | TS.SymbolFlags.Class | TS.SymbolFlags.Enum))) return undefined;
    const ref = type as ts.TypeReference;
    if (ref.target && ref.target !== type && (ref.typeArguments?.length ?? 0) > 0) return undefined;
    return sym.name;
  }

  /** The type as its DEFINITION, not its alias name: `type Bad = Map<…>` reports `Map<string, number>`, which is what is unsupported. */
  private shown(type: ts.Type): string {
    return this.ctx.checker.typeToString(
      type,
      undefined,
      TS.TypeFormatFlags.InTypeAlias | TS.TypeFormatFlags.NoTruncation | TS.TypeFormatFlags.UseFullyQualifiedType,
    );
  }

  private isLib(file: string): boolean {
    return /\/typescript\/lib\/lib\.[^/]*\.d\.ts$/.test(file);
  }

  private isPackage(file: string): boolean {
    return file.includes("/node_modules/") || !file.startsWith(`${norm(this.ctx.sourceRoot).replace(/\/$/, "")}/`);
  }

  /** Named reference: bare (this file), view import (another project file), or hashed local accessor (package). */
  private ref({ name, file, symbol }: Named, type: ts.Type): string {
    this.deps.add(file);
    const importer = norm(this.ctx.importerFile);
    // `<importer>.ts` is the lowered virtual of THIS .tsi (tshost / the service register it so)
    if (file === importer || file === `${importer}.ts`) {
      this.queue(name, this.acc(name), type, symbol);
      return `__nola.types.ref(${JSON.stringify(name)}, ${this.acc(name)})`;
    }
    if (this.isPackage(file)) {
      const pkgId = file.replace(/^.*\/node_modules\//, "").replace(/\.d\.ts$|\.ts$/, "");
      const local = `x_${sha256Hex(`${file}#${name}`).slice(0, 8)}`;
      this.queue(local, this.acc(local), type, symbol);
      return `__nola.types.ref(${JSON.stringify(`${pkgId}#${name}`)}, ${this.acc(local)})`;
    }
    // another project file: its `.tsi` (real, or the view of the plain module) exports the value
    const sourceFile = file.replace(/\.tsi\.ts$/, ".tsi");
    const rel = posixRelative(posixDirname(importer), sourceFile);
    const specifier = viewSpecifierFor(rel.startsWith(".") ? rel : `./${rel}`);
    const moduleId = moduleIdFor(this.ctx.importerDisplayFile, specifier);
    if (!this.imports.some((i) => i.localBinding === name)) {
      this.imports.push({ specifier, importedName: name, localBinding: name });
    }
    return `__nola.types.ref(${JSON.stringify(`${moduleId}#${name}`)}, () => ${this.acc(name)})`;
  }

  /**
   * Derive a named type's own accessor once. A failure PROPAGATES to the
   * referencing site: an extractor over `Bad` is NOLA2002, an exported alias
   * of it becomes UnsupportedType, and under prune the member that referenced
   * it is dropped by the enclosing object — exactly what the syntactic
   * walker's plan errors did. A second reference to a failed type rethrows
   * the same reason (never a dangling ref to an accessor that was not emitted).
   */
  private queue(name: string, accessor: string, type: ts.Type, symbol?: ts.Symbol): void {
    const failed = this.failed.get(accessor);
    if (failed) throw new DerivationError(failed);
    if (this.seen.has(accessor)) return;
    this.seen.add(accessor);
    try {
      // an alias's own constraint tags (emit 16) belong to its accessor body
      const body = this.walk(type, true, name);
      this.accessors.push({ name, expr: symbol ? this.constrainAliasSymbol(body, symbol, type, name) : body });
    } catch (e) {
      this.seen.delete(accessor);
      if (e instanceof DerivationError) this.failed.set(accessor, e.message);
      throw e;
    }
  }
}

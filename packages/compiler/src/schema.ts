import {
  type BaseNode,
  type ExportNamedDeclarationNode,
  programBody,
  type StringLiteralNode,
  type TSArrayTypeNode,
  type TSEnumDeclarationNode,
  type TSEnumMemberNode,
  type TSInterfaceDeclarationNode,
  type TSLiteralTypeNode,
  type TSPropertySignatureNode,
  type TSTypeAliasDeclarationNode,
  type TSTypeLiteralNode,
  type TSTypeReferenceNode,
  type TSUnionTypeNode,
} from "@nola-lang/ast";
import type { JsonSchema } from "@nola-lang/core";

export type SchemaResult = { ok: true; schema: JsonSchema } | { ok: false; message: string; node: BaseNode };

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

/** First JSDoc block (slash-star-star … star-slash) in leadingComments → collapsed description. */
export function jsdocDescription(member: BaseNode): string | undefined {
  const comments = member.leadingComments;
  if (!comments) return undefined;
  for (const c of comments) {
    if (c.type === "CommentBlock" && c.value.startsWith("*")) {
      const text = c.value
        .split("\n")
        .map((l) => l.replace(/^\s*\*+\s?/, "").trim())
        .filter((l) => l.length > 0)
        .join(" ")
        .trim();
      if (text) return text;
    }
  }
  return undefined;
}

export function deriveSchema(
  t: BaseNode,
  source: string,
  registry: Map<string, BaseNode>,
  seen: Set<string> = new Set(),
): SchemaResult {
  switch (t.type) {
    case "TSStringKeyword":
      return { ok: true, schema: { type: "string" } };
    case "TSNumberKeyword":
      return { ok: true, schema: { type: "number" } };
    case "TSBooleanKeyword":
      return { ok: true, schema: { type: "boolean" } };
    case "TSArrayType": {
      const inner = deriveSchema((t as TSArrayTypeNode).elementType, source, registry, seen);
      return inner.ok ? { ok: true, schema: { type: "array", items: inner.schema } } : inner;
    }
    case "TSTypeLiteral":
      return deriveObject((t as TSTypeLiteralNode).members ?? [], source, registry, seen, t);
    case "TSInterfaceDeclaration": {
      const bodyMembers = (t as TSInterfaceDeclarationNode).body?.body ?? [];
      return deriveObject(bodyMembers, source, registry, seen, t);
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
      return { ok: true, schema: { type: "string", enum: labels } };
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
      return { ok: true, schema: { type: "string", enum: labels } };
    }
    case "TSTypeReference": {
      const ref = t as TSTypeReferenceNode;
      const typeName = ref.typeName;
      const hasParams = Boolean(ref.typeParameters ?? ref.typeArguments);
      if (typeName?.type !== "Identifier" || hasParams) {
        return { ok: false, message: `unsupported type for intent schema: ${source.slice(t.start, t.end)}`, node: t };
      }
      const name = typeName.name ?? "";
      if (seen.has(name)) {
        return { ok: false, message: `recursive type '${name}' is not supported in intent schemas`, node: t };
      }
      const target = registry.get(name);
      if (!target) {
        // Built-in Date (unshadowed): ISO 8601 string on the wire, revived by
        // the runtime — keep in lockstep with deriveTypeExpr/inferTypes.date.
        if (name === "Date") return { ok: true, schema: { type: "string", format: "date-time" } };
        return {
          ok: false,
          message: `type '${name}' must be a non-generic type alias or interface declared in the same file`,
          node: t,
        };
      }
      const nextSeen = new Set(seen);
      nextSeen.add(name);
      return deriveSchema(target, source, registry, nextSeen);
    }
    default:
      return { ok: false, message: `unsupported type for intent schema: ${t.type}`, node: t };
  }
}

function deriveObject(
  members: BaseNode[],
  source: string,
  registry: Map<string, BaseNode>,
  seen: Set<string>,
  owner: BaseNode,
): SchemaResult {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const member of members) {
    if (member.type !== "TSPropertySignature") {
      return { ok: false, message: `unsupported member '${member.type}' in intent schema object`, node: member };
    }
    const prop = member as TSPropertySignatureNode;
    const key = prop.key;
    const name = key?.type === "Identifier" ? key.name : key?.type === "StringLiteral" ? key.value : undefined;
    if (!name) return { ok: false, message: "unsupported property key in intent schema object", node: member };
    const annotation = prop.typeAnnotation?.typeAnnotation;
    if (!annotation) return { ok: false, message: `property '${name}' needs a type annotation`, node: member };
    const inner = deriveSchema(annotation, source, registry, seen);
    if (!inner.ok) return inner;
    const description = jsdocDescription(member);
    properties[name] = description ? { ...inner.schema, description } : inner.schema;
    if (!prop.optional) required.push(name);
  }
  if (Object.keys(properties).length === 0) {
    return { ok: false, message: "empty object types are not useful as intent schemas", node: owner };
  }
  return { ok: true, schema: { type: "object", properties, required, additionalProperties: false } };
}

import {
  type BaseNode,
  type IdentifierNode,
  type ObjectExpressionNode,
  type ObjectPropertyNode,
  programBody,
  type StringLiteralNode,
} from "@nola-lang/ast";
import { parseNola } from "@nola-lang/parser";

const MODES = ["error", "prune", "omit"] as const;
export type StaticContextTypeMode = (typeof MODES)[number];

/**
 * Statically extract `compiler.underivableContextType` from nola.config.ts
 * source, for hosts that must not (editor processes) or cannot (sync compile
 * paths) evaluate the config. Understands the literal spellings only —
 * default-exported object, an optional wrapping call (defineConfig), as/
 * satisfies casts, and one level of top-level identifier indirection. A
 * computed value, an unknown mode, or a broken config yields undefined: the
 * caller falls back to the compile default, while build/check/run still see
 * the evaluated truth.
 */
export function staticUnderivableContextType(source: string): StaticContextTypeMode | undefined {
  let body: BaseNode[];
  try {
    const { ast } = parseNola(source, "nola.config.ts", { tolerant: true });
    if (!ast) return undefined;
    body = programBody(ast as BaseNode);
  } catch {
    return undefined;
  }

  const exported = body.find((n) => n.type === "ExportDefaultDeclaration");
  const config = resolveObject((exported as { declaration?: BaseNode } | undefined)?.declaration, body);
  const compiler = resolveObject(propValue(config, "compiler"), body);
  const mode = unwrap(propValue(compiler, "underivableContextType"));
  if (mode?.type !== "StringLiteral") return undefined;
  const value = (mode as StringLiteralNode).value;
  return (MODES as readonly string[]).includes(value) ? (value as StaticContextTypeMode) : undefined;
}

/** Peel wrappers that don't change the value: casts, parens, a single-argument call. */
function unwrap(node: BaseNode | undefined): BaseNode | undefined {
  let current = node;
  while (current) {
    if (
      current.type === "TSAsExpression" ||
      current.type === "TSSatisfiesExpression" ||
      current.type === "TSNonNullExpression" ||
      current.type === "ParenthesizedExpression"
    ) {
      current = (current as { expression?: BaseNode }).expression;
      continue;
    }
    if (current.type === "CallExpression") {
      const args = (current as { arguments?: BaseNode[] }).arguments ?? [];
      if (args.length !== 1) return undefined;
      current = args[0];
      continue;
    }
    return current;
  }
  return undefined;
}

/** unwrap() to an ObjectExpression, following one top-level `const x = ...` indirection. */
function resolveObject(node: BaseNode | undefined, body: BaseNode[]): ObjectExpressionNode | undefined {
  const direct = unwrap(node);
  if (direct?.type === "ObjectExpression") return direct as ObjectExpressionNode;
  if (direct?.type === "Identifier") {
    const name = (direct as IdentifierNode).name;
    for (const stmt of body) {
      if (stmt.type !== "VariableDeclaration") continue;
      for (const decl of (stmt as { declarations?: BaseNode[] }).declarations ?? []) {
        const d = decl as { id?: BaseNode; init?: BaseNode };
        if (d.id?.type === "Identifier" && (d.id as IdentifierNode).name === name) {
          const init = unwrap(d.init);
          if (init?.type === "ObjectExpression") return init as ObjectExpressionNode;
        }
      }
    }
  }
  return undefined;
}

function propValue(obj: ObjectExpressionNode | undefined, name: string): BaseNode | undefined {
  for (const prop of obj?.properties ?? []) {
    if (prop.type !== "ObjectProperty" || prop.computed === true) continue;
    const key = (prop as ObjectPropertyNode).key;
    const keyName =
      key.type === "Identifier"
        ? (key as IdentifierNode).name
        : key.type === "StringLiteral"
          ? (key as StringLiteralNode).value
          : undefined;
    if (keyName === name) return (prop as ObjectPropertyNode).value;
  }
  return undefined;
}

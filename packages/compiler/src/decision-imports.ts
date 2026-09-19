import { type BaseNode, walk } from "@nola-lang/ast";
import { collectTypeImports } from "./schema-expr.js";

/**
 * The intrinsic decision types (spec 2026-09-18 §2.1): first class in a .tsi
 * with no import. The lowerer appends `import type { … } from
 * "@nola-lang/runtime"` for the names a file USES as type references and does
 * not declare or import itself — a local declaration shadows the intrinsic,
 * the way a local type shadows a TS lib type.
 */
export const DECISION_TYPE_NAMES = ["Choice", "Prob", "Scale"] as const;
export type DecisionTypeName = (typeof DECISION_TYPE_NAMES)[number];

/** Declarations that occupy the TYPE namespace (a `const Choice` does not shadow a type). */
const TYPE_DECLARATIONS = new Set([
  "TSTypeAliasDeclaration",
  "TSInterfaceDeclaration",
  "ClassDeclaration",
  "TSEnumDeclaration",
]);

type Shape = BaseNode & {
  id?: { name?: string };
  local?: { name?: string };
  typeName?: BaseNode & { name?: string };
  /** `..choice` / `..scale` / `..prob`: the sugar desugars to the wrapper, which the lowered text then references */
  kind?: keyof typeof SUGAR_WRAPPERS;
};

/** The intrinsic each extractor sugar lowers to (mirrors `DECISION_WRAPPERS` in lower/templates.ts). */
const SUGAR_WRAPPERS = { choice: "Choice", scale: "Scale", prob: "Prob" } as const;

export function collectDecisionTypeUses(ast: BaseNode): DecisionTypeName[] {
  const declared = new Set<string>(collectTypeImports(ast).keys());
  const used = new Set<string>();
  walk(ast, (node) => {
    const n = node as Shape;
    if (TYPE_DECLARATIONS.has(n.type) && n.id?.name) declared.add(n.id.name);
    if ((n.type === "ImportDefaultSpecifier" || n.type === "ImportNamespaceSpecifier") && n.local?.name) {
      declared.add(n.local.name);
    }
    if (n.type === "TSTypeReference" && n.typeName?.type === "Identifier" && n.typeName.name) used.add(n.typeName.name);
    if (n.type === "NolaExtractExpression" && n.kind && n.kind in SUGAR_WRAPPERS) used.add(SUGAR_WRAPPERS[n.kind]);
  });
  return DECISION_TYPE_NAMES.filter((name) => used.has(name) && !declared.has(name));
}

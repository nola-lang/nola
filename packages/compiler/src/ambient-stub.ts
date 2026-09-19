/**
 * Ambient declarations of the emit surface — what lowered code references when
 * the real `@nola-lang/runtime` package is not resolvable (bare test projects).
 * Single-sourced here since Track 2; tshost (nola check) and the tsc-clean test
 * helper both import it. Keep in lockstep with __nola.ts + emit-surface.test.ts.
 */
export const RUNTIME_AMBIENT_STUB = `
export type JsonSchema = ({ type: string } | { anyOf: unknown[] } | { const: unknown }) & Record<string, unknown>;
export interface Askable<T = unknown> {
  withRetry(retries: number): Askable<T>;
  withModel(model: string): Askable<T>;
  withParams(params: Record<string, unknown>): Askable<T>;
  withTimeout(timeout: number): Askable<T>;
}
export interface Intent<T = unknown> extends Askable<T>, PromiseLike<T> {
  withRetry(retries: number): Intent<T>;
  withModel(model: string): Intent<T>;
  withParams(params: Record<string, unknown>): Intent<T>;
  withTimeout(timeout: number): Intent<T>;
  detached(): Intent<T>;
}
export interface InferContext {
  scope(data: Record<string, unknown>): InferContext;
}
export interface ValidationIssue { readonly path: ReadonlyArray<string | number>; readonly message: string; }
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };
export interface StandardSchemaV1Props<Input = unknown, Output = Input> {
  readonly version: 1; readonly vendor: string;
  readonly validate: (value: unknown) => { value: Output; issues?: undefined } | { issues: ReadonlyArray<{ message: string; path?: ReadonlyArray<PropertyKey> }> };
  readonly jsonSchema: {
    readonly input: (options: { target: string; libraryOptions?: Record<string, unknown> }) => Record<string, unknown>;
    readonly output: (options: { target: string; libraryOptions?: Record<string, unknown> }) => Record<string, unknown>;
  };
  readonly types?: { input: Input; output: Output } | undefined;
}
export interface InferType<T = unknown> {
  toJsonSchema(): JsonSchema;
  validate(value: unknown): ValidationResult<T>;
  parse(value: unknown): T;
  readonly "~standard": StandardSchemaV1Props<unknown, T>;
}
export interface TypeCarrier<T = unknown> extends InferType<T> {
  describe(text: string): TypeCarrier<T>;
  constrain(constraints: Record<string, unknown>): TypeCarrier<T>;
}
export interface InvocationContext extends InferContext {
  readonly __nolaFunctionScope: true;
}
export interface FunctionPromptScopeArg {
  readonly name: string; readonly type?: string; readonly contextual: boolean; readonly value?: unknown;
}
export interface FunctionPromptScope {
  readonly fn: string; readonly signature: string; readonly file?: string;
  readonly args: readonly FunctionPromptScopeArg[];
  readonly nested: boolean; readonly hasContext: boolean;
  readonly default: string; readonly next: string;
}
export interface ExtractPromptScope {
  readonly type: string; readonly schema: string; readonly hasContext: boolean;
  readonly default: string; readonly format: string;
}
export interface FileInferContext extends InferContext {
  func(init: {
    fn: string; instruction?: string; template?: (scope: FunctionPromptScope) => string;
    args?: Array<{ name: string; type?: InferType<unknown>; contextual?: boolean; value?: unknown }>;
    locals?: Array<{ name: string; type?: InferType<unknown> }>;
  }): InvocationContext;
  module(init: { instruction?: string; template?: (scope: FunctionPromptScope) => string; locals?: Array<{ name: string; type?: InferType<unknown> }> }): ModuleContext;
}
export interface ModuleContext extends InferContext {
  readonly __nolaModuleScope: true;
}
export interface Frame {
  readonly infer: InferContext;
}
export interface UnsupportedType<Reason extends string = string> {
  readonly __nolaTypeUnsupported: Reason;
}
export type TypeValueOf<Accessor, T> = Accessor extends () => UnsupportedType<infer R> ? UnsupportedType<R> : InferType<T>;
export type ChoiceCriteria = Record<string, string | null>;
export type ChoiceLabel<C> = C extends string | number ? C : keyof C & (string | number);
export type Choice<C extends ChoiceCriteria | string | number> = {
  readonly choice: ChoiceLabel<C>;
  readonly probabilities: Readonly<Record<\`\${ChoiceLabel<C>}\`, number>>;
  readonly confidence?: number;
  readonly __nola_choice?: C;
};
export type ScaleLevels = readonly [string, string, ...string[]];
export type Scale<L extends ScaleLevels> = {
  readonly score: number; readonly probabilities: readonly number[]; readonly levels: L;
  readonly confidence?: number; readonly __nola_scale?: L;
};
export type ProbCriteria = { readonly true: string; readonly false: string };
export type Prob<C extends ProbCriteria = never> = number & { readonly __nola_prob?: C };
export declare const __nola: {
  intents: {
    Intent<T>(executor: (ctx: Frame) => Promise<T>, scope: InvocationContext): Intent<T>;
    ExtractIntent<T = unknown>(init: { instruction: string; template?: (scope: ExtractPromptScope) => string; type: unknown; loc: string; def?: string }): Askable<T>;
    FunctionCallIntent<T = unknown>(init: {
      fn: unknown; name: string; instruction: string; template?: (scope: ExtractPromptScope) => string; loc: string; def?: string; args: unknown[];
    }): Askable<T>;
  };
  types: {
    string(): TypeCarrier<string>;
    number(): TypeCarrier<number>;
    boolean(): TypeCarrier<boolean>;
    date(): TypeCarrier<Date>;
    enum(labels: readonly string[]): TypeCarrier<string>;
    array<T>(item: InferType<T>): TypeCarrier<T[]>;
    object(props: Record<string, InferType<unknown>>, options?: { additional?: InferType<unknown> }): TypeCarrier<Record<string, unknown>>;
    literal(value: string | number | boolean): TypeCarrier<typeof value>;
    tuple(items: InferType<unknown>[]): TypeCarrier<unknown[]>;
    record<T>(value: InferType<T>): TypeCarrier<Record<string, T>>;
    nullable<T>(t: InferType<T>): TypeCarrier<T | null>;
    union(members: InferType<unknown>[]): TypeCarrier<unknown>;
    choice(criteria: Record<string, string | null>, options?: { readonly numeric?: readonly string[] }): TypeCarrier<Record<string, unknown>>;
    scale(levels: readonly string[]): TypeCarrier<Record<string, unknown>>;
    prob(criteria?: { true: string; false: string }): TypeCarrier<number>;
    optional<T>(t: InferType<T>): TypeCarrier<T | undefined>;
    ref<T = unknown>(name: string, resolve: () => InferType<T> | (() => InferType<T>)): TypeCarrier<T>;
    unsupported<R extends string>(reason: R): UnsupportedType<R>;
  };
  context: {
    file(file: string, emit?: number): FileInferContext;
  };
  ask<T>(value: Askable<T>, scope: Frame | ModuleContext, provider?: string, locals?: Record<string, unknown>): Promise<T>;
  fmt(value: unknown): string;
  tpl(strings: TemplateStringsArray, ...values: unknown[]): string;
  useRuntime(v: number): void;
};
`;


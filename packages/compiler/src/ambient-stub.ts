/**
 * Ambient declarations of the emit surface — what lowered code references when
 * the real `@nola-lang/runtime` package is not resolvable (bare test projects).
 * Single-sourced here since Track 2; tshost (nola check) and the tsc-clean test
 * helper both import it. Keep in lockstep with __nola.ts + emit-surface.test.ts.
 */
export const RUNTIME_AMBIENT_STUB = `
export type JsonSchema = { type: string } & Record<string, unknown>;
export interface Askable<T = unknown> {
  withRetry(retries: number): Askable<T>;
  withProvider(provider: string): Askable<T>;
  withParams(params: Record<string, unknown>): Askable<T>;
}
export interface Intent<T = unknown> extends Askable<T>, PromiseLike<T> {
  withRetry(retries: number): Intent<T>;
  withProvider(provider: string): Intent<T>;
  withParams(params: Record<string, unknown>): Intent<T>;
  withTimeout(timeout: number): Intent<T>;
  detached(): Intent<T>;
}
export interface InferContext {
  scope(data: Record<string, unknown>): InferContext;
}
export interface InferType<T = unknown> {
  describe(text: string): InferType<T>;
  toJsonSchema(): JsonSchema;
}
export interface FunctionInferContext extends InferContext {
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
  }): FunctionInferContext;
}
export interface Frame {
  readonly infer: InferContext;
}
export interface UnsupportedType<Reason extends string = string> {
  readonly __nolaTypeUnsupported: Reason;
}
export declare const __nola: {
  intents: {
    Intent<T>(executor: (ctx: Frame) => Promise<T>, scope: FunctionInferContext): Intent<T>;
    ExtractIntent<T = unknown>(init: { instruction: string; template?: (scope: ExtractPromptScope) => string; type: unknown; loc: string }): Askable<T>;
    FunctionCallingIntent<T = unknown>(init: {
      fn: unknown; name: string; instruction: string; template?: (scope: ExtractPromptScope) => string; loc: string; args: unknown[];
    }): Askable<T>;
  };
  types: {
    string(): InferType<string>;
    number(): InferType<number>;
    boolean(): InferType<boolean>;
    date(): InferType<Date>;
    enum(labels: readonly string[]): InferType<string>;
    array<T>(item: InferType<T>): InferType<T[]>;
    object(props: Record<string, InferType<unknown>>): InferType<Record<string, unknown>>;
    optional<T>(t: InferType<T>): InferType<T | undefined>;
    ref<T = unknown>(name: string, resolve: () => InferType<T>): InferType<T>;
    unsupported<R extends string>(reason: R): UnsupportedType<R>;
  };
  context: {
    file(file: string): FileInferContext;
  };
  ask<T>(value: Askable<T>, ctx: Frame, provider?: string): Promise<T>;
  fmt(value: unknown): string;
  tpl(strings: TemplateStringsArray, ...values: unknown[]): string;
  useRuntime(v: number): void;
};
`;


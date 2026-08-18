export interface BabelParseOptions {
  sourceType?: "module" | "script";
  plugins?: unknown[];
  attachComment?: boolean;
  errorRecovery?: boolean;
}
export declare function parse(input: string, options?: BabelParseOptions): unknown;

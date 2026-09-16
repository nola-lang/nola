/**
 * Standard Schema v1 (https://standardschema.dev, MIT) — vendored so the
 * runtime has no dependency. `InferType` implements it under `~standard`.
 * Flat names instead of the spec's namespace (biome forbids `namespace`).
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardSchemaV1Props<Input, Output>;
}

export interface StandardSchemaV1Props<Input = unknown, Output = Input> {
  readonly version: 1;
  readonly vendor: string;
  readonly validate: (value: unknown) => StandardSchemaV1Result<Output> | Promise<StandardSchemaV1Result<Output>>;
  readonly types?: StandardSchemaV1Types<Input, Output> | undefined;
}

export type StandardSchemaV1Result<Output> = StandardSchemaV1Success<Output> | StandardSchemaV1Failure;

export interface StandardSchemaV1Success<Output> {
  readonly value: Output;
  readonly issues?: undefined;
}

export interface StandardSchemaV1Failure {
  readonly issues: ReadonlyArray<StandardSchemaV1Issue>;
}

export interface StandardSchemaV1Issue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | StandardSchemaV1PathSegment> | undefined;
}

export interface StandardSchemaV1PathSegment {
  readonly key: PropertyKey;
}

export interface StandardSchemaV1Types<Input = unknown, Output = Input> {
  readonly input: Input;
  readonly output: Output;
}

export type StandardSchemaV1InferOutput<S extends StandardSchemaV1> = NonNullable<S["~standard"]["types"]>["output"];

/**
 * Standard JSON Schema (https://standardschema.dev/json-schema) — the
 * companion interface: `~standard.jsonSchema.input(options)` /
 * `.output(options)` return a JSON Schema document in the dialect `target`
 * names. One object satisfies both specs by carrying `validate` and
 * `jsonSchema` side by side, which is what a Nola type value does.
 */
export interface StandardJSONSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardJSONSchemaV1Props<Input, Output>;
}

export interface StandardJSONSchemaV1Props<Input = unknown, Output = Input> {
  readonly version: 1;
  readonly vendor: string;
  readonly jsonSchema: StandardJSONSchemaV1Converter;
  readonly types?: StandardSchemaV1Types<Input, Output> | undefined;
}

export interface StandardJSONSchemaV1Converter {
  /** The JSON Schema of what the schema ACCEPTS. */
  readonly input: (options: StandardJSONSchemaV1Options) => Record<string, unknown>;
  /** The JSON Schema of what the schema RETURNS. */
  readonly output: (options: StandardJSONSchemaV1Options) => Record<string, unknown>;
}

/** The dialects the spec names; a library throws for a target it cannot emit. */
export type StandardJSONSchemaV1Target = "draft-2020-12" | "draft-07" | "openapi-3.0" | (string & {});

export interface StandardJSONSchemaV1Options {
  readonly target: StandardJSONSchemaV1Target;
  readonly libraryOptions?: Record<string, unknown> | undefined;
}

/** What a Nola type value exposes under `~standard`: both specs at once. */
export type NolaStandardProps<T> = StandardSchemaV1Props<unknown, T> & StandardJSONSchemaV1Props<unknown, T>;

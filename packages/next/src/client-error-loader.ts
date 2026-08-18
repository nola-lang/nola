import { Codes } from "@nola-lang/ast";

/** Client compilations route .tsi here: fail fast with the bundler-family code. */
export default function nolaClientErrorLoader(this: { resourcePath: string }): never {
  throw new Error(
    `${Codes.TsiInClientBundle}: ${this.resourcePath} is a Nola module — server-only in v0. ` +
      `Import it from a server component, route handler, or server action instead of client code.`,
  );
}

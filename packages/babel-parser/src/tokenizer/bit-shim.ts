/**
 * NOLA VENDOR SHIM — replaces the Babel repo's build-time
 * `babel-plugin-bit-decorator` with an equivalent runtime implementation.
 * Each `@bit accessor` boolean is packed into the numeric field marked with
 * `@bit.storage` (State#flags), so whole-state save/restore via `flags`
 * keeps working exactly like Babel's build.
 */

type AccessorTarget = { get: (this: never) => unknown; set: (this: never, v: unknown) => void };

interface BitDecoratorShim {
  (target: AccessorTarget, context: ClassAccessorDecoratorContext): {
    get(this: { flags: number }): boolean;
    set(this: { flags: number }, value: boolean): void;
    init(this: { flags: number }, value: boolean): boolean;
  };
  storage(value: undefined, context: ClassFieldDecoratorContext): void;
}

let nextBit = 0;

const bitImpl = ((_target: AccessorTarget, _context: ClassAccessorDecoratorContext) => {
  const mask = 1 << nextBit++;
  if (nextBit > 31) throw new Error("bit-shim: more than 31 @bit fields");
  return {
    get(this: { flags: number }): boolean {
      return (this.flags & mask) !== 0;
    },
    set(this: { flags: number }, value: boolean): void {
      if (value) this.flags |= mask;
      else this.flags &= ~mask;
    },
    init(this: { flags: number }, value: boolean): boolean {
      if (value) this.flags |= mask;
      return value;
    },
  };
}) as BitDecoratorShim;

bitImpl.storage = (_value: undefined, _context: ClassFieldDecoratorContext): void => {};

export const bit = bitImpl;

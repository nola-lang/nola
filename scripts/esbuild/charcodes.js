// ESM stand-in for the `charcodes` package (CommonJS), aliased into every
// esbuild bundle that inlines the vendored parser: parser dist, LSP server,
// tsserver plugin, Turbopack loader.
//
// Why: esbuild exposes a CommonJS module's exports through getters (__toESM),
// so each `charCodes.x` read in the tokenizer's inner loop became a function
// call and the bundled parser ran 2.5x slower than the unbundled one (CPU
// profile 2026-09-20: one getter took a third of the parse). Plain `export
// const` integers are inlined instead. Upstream Babel inlines the same
// constants at build time for the same reason.
//
// GENERATED from the installed package (node -e over require("charcodes")) —
// test/esbuild-charcodes-shim.test.ts holds every key and value to it, so
// regenerate this file if the package is ever upgraded.

export const ampersand = 38;
export const apostrophe = 39;
export const asterisk = 42;
export const atSign = 64;
export const backSpace = 8;
export const backslash = 92;
export const caret = 94;
export const carriageReturn = 13;
export const colon = 58;
export const comma = 44;
export const dash = 45;
export const digit0 = 48;
export const digit1 = 49;
export const digit2 = 50;
export const digit3 = 51;
export const digit4 = 52;
export const digit5 = 53;
export const digit6 = 54;
export const digit7 = 55;
export const digit8 = 56;
export const digit9 = 57;
export const dollarSign = 36;
export const dot = 46;
export const equalsTo = 61;
export const exclamationMark = 33;
export const graveAccent = 96;
export const greaterThan = 62;
export const leftCurlyBrace = 123;
export const leftParenthesis = 40;
export const leftSquareBracket = 91;
export const lessThan = 60;
export const lineFeed = 10;
export const lineSeparator = 8232;
export const lowercaseA = 97;
export const lowercaseB = 98;
export const lowercaseC = 99;
export const lowercaseD = 100;
export const lowercaseE = 101;
export const lowercaseF = 102;
export const lowercaseG = 103;
export const lowercaseH = 104;
export const lowercaseI = 105;
export const lowercaseJ = 106;
export const lowercaseK = 107;
export const lowercaseL = 108;
export const lowercaseM = 109;
export const lowercaseN = 110;
export const lowercaseO = 111;
export const lowercaseP = 112;
export const lowercaseQ = 113;
export const lowercaseR = 114;
export const lowercaseS = 115;
export const lowercaseT = 116;
export const lowercaseU = 117;
export const lowercaseV = 118;
export const lowercaseW = 119;
export const lowercaseX = 120;
export const lowercaseY = 121;
export const lowercaseZ = 122;
export const nonBreakingSpace = 160;
export const numberSign = 35;
export const oghamSpaceMark = 5760;
export const paragraphSeparator = 8233;
export const percentSign = 37;
export const plusSign = 43;
export const questionMark = 63;
export const quotationMark = 34;
export const rightCurlyBrace = 125;
export const rightParenthesis = 41;
export const rightSquareBracket = 93;
export const semicolon = 59;
export const shiftOut = 14;
export const slash = 47;
export const space = 32;
export const tab = 9;
export const tilde = 126;
export const underscore = 95;
export const uppercaseA = 65;
export const uppercaseB = 66;
export const uppercaseC = 67;
export const uppercaseD = 68;
export const uppercaseE = 69;
export const uppercaseF = 70;
export const uppercaseG = 71;
export const uppercaseH = 72;
export const uppercaseI = 73;
export const uppercaseJ = 74;
export const uppercaseK = 75;
export const uppercaseL = 76;
export const uppercaseM = 77;
export const uppercaseN = 78;
export const uppercaseO = 79;
export const uppercaseP = 80;
export const uppercaseQ = 81;
export const uppercaseR = 82;
export const uppercaseS = 83;
export const uppercaseT = 84;
export const uppercaseU = 85;
export const uppercaseV = 86;
export const uppercaseW = 87;
export const uppercaseX = 88;
export const uppercaseY = 89;
export const uppercaseZ = 90;
export const verticalBar = 124;

export function isDigit(code) {
  return code >= digit0 && code <= digit9;
}

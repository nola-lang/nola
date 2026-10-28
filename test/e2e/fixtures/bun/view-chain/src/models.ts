import type { Address } from "./address.js";

// A real project shape: the type a .tsi extracts reaches another plain module's type —
// the view of models.ts imports ./address.tsi, the view of a view.
export interface Person {
  name: string;
  home: Address;
}

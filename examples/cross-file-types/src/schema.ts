import { Person } from "./models.tsi";

// The view of models.ts: `Person` is the interface AND a runtime value.
export const personSchema = Person.toJsonSchema();

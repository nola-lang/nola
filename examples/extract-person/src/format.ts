// Plain TypeScript, imported from person.tsi with the standard NodeNext
// `./format.js` specifier — mixing existing TS code into a nola module
// needs no special setup.
import type { Person } from "./person.tsi";

export function normalizePerson(person: Person): Person {
  return { ...person, name: person.name.trim(), employer: person.employer.trim() };
}

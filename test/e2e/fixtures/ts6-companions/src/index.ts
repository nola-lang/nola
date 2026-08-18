import { extractPerson } from "./extract.tsi";

export async function go(text: string): Promise<string> {
  const person = await extractPerson(text);
  return person.name;
}

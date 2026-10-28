import { extractPerson } from "./report.tsi";

const person = await extractPerson("Ada from London N1");
console.log(JSON.stringify(person));

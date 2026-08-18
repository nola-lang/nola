import { extractPerson } from "./person.tsi";

const result = await extractPerson("Alice Smith, 32, is a staff engineer at Acme Corp working on distributed systems.");
console.log(JSON.stringify(result));

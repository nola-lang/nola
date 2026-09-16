import { extractPerson } from "./report.tsi";
import { personSchema } from "./schema.js";

const result = await extractPerson("Ada from London N1, reporting to Grace in NYC 10001");
console.log(JSON.stringify({ result, required: (personSchema as { required?: string[] }).required }));

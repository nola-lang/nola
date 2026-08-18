import { triage } from "./triage.tsi";

const id = await triage("Ticket TCK-4711: the export button does nothing.");
console.log(JSON.stringify({ id }));

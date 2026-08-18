import { classifyIssue } from "./issue.tsi";

const kind = await classifyIssue({ id: "T-1", description: "The app crashes when I upload a CSV." }, "unknown");
console.log(JSON.stringify({ kind }));

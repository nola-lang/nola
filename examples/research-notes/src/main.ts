import { conclude, nextQuery } from "./research.tsi";

const CORPUS = [
  "David Gregory (1625-1720) was a Scottish physician who inherited Kinnairdy Castle in 1664.",
  "Kinnairdy Castle is a tower house in Aberdeenshire, having five storeys and a garret.",
  "David Gregory (1659-1708) was a mathematician and Savilian Professor of Astronomy at Oxford.",
  "Gregory Tower is a three-storey lighthouse on the Baltic Sea coast.",
];

// Retrieval is plain code — a keyword match over the corpus. The LLM only
// decides what to search for and what the notes add up to.
function search(query: string): string[] {
  const words = query.toLowerCase().split(/\W+/).filter(Boolean);
  return CORPUS.filter((doc) => words.some((word) => doc.toLowerCase().includes(word))).slice(0, 2);
}

const question = "How many storeys does the castle that David Gregory inherited have?";

const notes: string[] = [];
for (let hop = 0; hop < 2; hop++) {
  const query = await nextQuery(question, notes);
  for (const doc of search(query)) {
    if (!notes.includes(doc)) notes.push(doc);
  }
}

const result = await conclude(question, notes);
console.log(JSON.stringify(result));

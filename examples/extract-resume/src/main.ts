import { extractResume } from "./resume.tsi";

const result = await extractResume(
  [
    "Grace Hopper — grace@example.com",
    "Experience: United States Navy programmer (1943-1966); Eckert-Mauchly, worked on UNIVAC I (1949-1954).",
    "Skills: COBOL, compilers.",
    "Education: Yale University, PhD in Mathematics, 1934.",
  ].join("\n"),
);
console.log(JSON.stringify(result));

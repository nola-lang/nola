// Plain TypeScript, nothing Nola about it: the two functions the tool-use ask
// in main.tsi offers the model. A tiny in-memory "disc D" keeps the example
// deterministic; a real program would call the file system.
const DISC_D: Record<string, string> = {
  "D:/docs/visa/ds-160-confirmation.pdf": "DS-160 confirmation page for a US nonimmigrant visa application.",
  "D:/docs/visa/passport-scan.pdf": "Scan of the passport, valid until 2031.",
  "D:/docs/taxes/2025-return.pdf": "Tax return for 2025.",
  "D:/photos/cat.jpg": "(binary)",
};

/**
 * Lists the files under a directory on disc D.
 * @param dir an absolute directory path, such as D:/docs
 * @param pattern keeps only the paths that contain it, case-insensitively
 */
export async function searchFiles(dir: string, pattern?: string): Promise<string[]> {
  const prefix = dir.endsWith("/") ? dir : `${dir}/`;
  // Models often write a glob (`*visa*`) where the doc says "contains", so a
  // `*` stands for any run of characters and everything else is literal.
  const needle =
    pattern === undefined
      ? undefined
      : new RegExp(
          pattern
            .toLowerCase()
            .split("*")
            .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join(".*"),
        );
  return Object.keys(DISC_D).filter((path) => path.startsWith(prefix) && (needle === undefined || needle.test(path.toLowerCase())));
}

/**
 * Reads a file's text.
 * @param path an absolute file path on disc D
 */
export async function readFile(path: string): Promise<string> {
  const text = DISC_D[path];
  if (text === undefined) throw new Error(`no such file: ${path}`);
  return text;
}

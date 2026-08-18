/** Production example acquisition: GitHub Trees API + raw file fetches. */
const REPO = "nola-lang/nola";

/** Network/acquisition failure — the builtin templates always work offline. */
export class ExampleFetchError extends Error {}

export type FetchLike = (
  url: string,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

interface TreeEntry {
  path: string;
  type: string;
}

/** Try the lockstep release tag first; a repo without that tag serves main. */
async function fetchTree(version: string, fetchImpl: FetchLike): Promise<{ ref: string; tree: TreeEntry[] }> {
  const tag = `v${version}`;
  for (const ref of [tag, "main"]) {
    const res = await fetchImpl(`https://api.github.com/repos/${REPO}/git/trees/${ref}?recursive=1`);
    if (res.status === 404) continue;
    if (!res.ok) throw new ExampleFetchError(`GitHub tree request failed (HTTP ${res.status}) for ${REPO}@${ref}`);
    const body = (await res.json()) as { tree?: TreeEntry[]; truncated?: boolean };
    if (!body.tree || body.truncated) throw new ExampleFetchError(`GitHub tree for ${REPO}@${ref} is unusable`);
    if (ref !== tag) console.warn(`note: tag ${tag} not found on GitHub — fetching the example from main instead`);
    return { ref, tree: body.tree };
  }
  throw new ExampleFetchError(`GitHub has neither ${tag} nor main for ${REPO} — are you offline?`);
}

/**
 * rel-path → content for one example. All files are buffered before the
 * caller writes anything, so a mid-fetch failure scaffolds nothing.
 */
export async function fetchExampleFromGitHub(
  name: string,
  version: string,
  fetchImpl: FetchLike = fetch,
): Promise<Map<string, string>> {
  const { ref, tree } = await fetchTree(version, fetchImpl);
  const prefix = `examples/${name}/`;
  const blobs = tree.filter((entry) => entry.type === "blob" && entry.path.startsWith(prefix));
  if (blobs.length === 0) throw new ExampleFetchError(`example "${name}" not found in ${REPO}@${ref}`);
  const files = new Map<string, string>();
  for (const blob of blobs) {
    const res = await fetchImpl(`https://raw.githubusercontent.com/${REPO}/${ref}/${blob.path}`);
    if (!res.ok) throw new ExampleFetchError(`fetch failed (HTTP ${res.status}): ${blob.path}`);
    files.set(blob.path.slice(prefix.length), await res.text());
  }
  return files;
}

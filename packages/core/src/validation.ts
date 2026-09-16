/** One validator finding: where in the value (root = []) and what was wrong. */
export interface ValidationIssue {
  readonly path: ReadonlyArray<string | number>;
  readonly message: string;
}

/** `$`, `$.geo.lat`, `$.kids[0].label` — the spelling the correction prompt has always used. */
export function formatIssuePath(path: ReadonlyArray<string | number>): string {
  return `$${path.map((seg) => (typeof seg === "number" ? `[${seg}]` : `.${seg}`)).join("")}`;
}

export function formatIssue(issue: ValidationIssue): string {
  return `${formatIssuePath(issue.path)}: ${issue.message}`;
}

export function formatIssues(issues: ReadonlyArray<ValidationIssue>): string {
  return issues.map(formatIssue).join("; ");
}

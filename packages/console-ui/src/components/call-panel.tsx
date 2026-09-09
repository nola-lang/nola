import type { AskDetail } from "../api";
import { AskBody, AskHeader, ResultBlock } from "./ask-panel";

/** A call intent: the header IS the source (callee`hint`(..)), then the arguments the model filled, the facts, the shared tail. */
export function CallPanel({ detail, search }: { detail: AskDetail; search: URLSearchParams }) {
  const source = `${detail.callee ?? "?"}${detail.hint ? `\`${detail.hint}\`` : ""}(..)`;
  return (
    <>
      <AskHeader detail={detail} title={source} search={search} />
      <ResultBlock detail={detail} title="arguments" />
      <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-xs">
        <dt className="text-muted-foreground">callee</dt>
        <dd className="m-0">{detail.callee ?? "—"}</dd>
        <dt className="text-muted-foreground">hint</dt>
        <dd className="m-0">{detail.hint || "—"}</dd>
        {detail.instruction && (
          <>
            <dt className="text-muted-foreground">request</dt>
            <dd className="m-0">{detail.instruction}</dd>
          </>
        )}
      </dl>
      <AskBody detail={detail} />
    </>
  );
}

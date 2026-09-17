import { EventEmitter } from "node:events";
import type { NolaIngestEnvelope } from "@nola-lang/core";
import type {
  AskDetail,
  ConsoleStorage,
  DefinitionAsksQuery,
  DefinitionDetail,
  DefinitionSummary,
  ProjectSummary,
  RecordsQuery,
  TraceDetail,
  TraceRecord,
} from "../storage/types.js";

/** What live subscribers receive: every ingested envelope, plus a notice when the store was cleared. */
export type ConsoleNotice = NolaIngestEnvelope | { kind: "cleared"; at: number };

/** Framework-independent console domain: persistence + live fan-out. Knows nothing of Hono or HTTP. */
export class ConsoleService {
  readonly #storage: ConsoleStorage;
  readonly #emitter = new EventEmitter();

  constructor(storage: ConsoleStorage) {
    this.#storage = storage;
    this.#emitter.setMaxListeners(0); // one listener per open SSE stream
  }

  async ingest(envelope: NolaIngestEnvelope): Promise<void> {
    await this.#storage.ingest(envelope);
    this.#emitter.emit("event", envelope);
  }

  /** Wipe the store; subscribers hear a `cleared` notice so open UIs refetch. */
  async clear(): Promise<void> {
    await this.#storage.clear();
    this.#emitter.emit("event", { kind: "cleared", at: Date.now() } satisfies ConsoleNotice);
  }

  onEvent(listener: (notice: ConsoleNotice) => void): () => void {
    this.#emitter.on("event", listener);
    return () => this.#emitter.off("event", listener);
  }

  listProjects(): Promise<ProjectSummary[]> {
    return this.#storage.listProjects();
  }

  /** The flattened tree in display order — roots newest first, children in start order beneath each. */
  listRecords(query?: RecordsQuery): Promise<TraceRecord[]> {
    return this.#storage.listRecords(query);
  }

  getTrace(invocationId: string): Promise<TraceDetail | undefined> {
    return this.#storage.getTrace(invocationId);
  }

  getAsk(askId: string): Promise<AskDetail | undefined> {
    return this.#storage.getAsk(askId);
  }

  listDefinitions(query?: { project?: string; noProject?: boolean }): Promise<DefinitionSummary[]> {
    return this.#storage.listDefinitions(query);
  }

  getDefinition(def: string, query?: DefinitionAsksQuery): Promise<DefinitionDetail | undefined> {
    return this.#storage.getDefinition(def, query);
  }
}

// Minimal driver for a real tsserver.js over its stdio protocol, loading the
// nola plugin the same way VS Code does (globalPlugins + pluginProbeLocations).
import { type ChildProcess, spawn } from "node:child_process";

export interface TsDiagnostic {
  code?: number;
  text?: string;
}

export class TsServerHandle {
  private readonly proc: ChildProcess;
  private seq = 0;
  private buffer = "";
  private readonly pending = new Map<number, { resolve: (body: unknown) => void; reject: (err: Error) => void }>();

  constructor(tsserverPath: string, pluginProbeRoot: string) {
    this.proc = spawn(
      process.execPath,
      [
        tsserverPath,
        "--globalPlugins",
        "@nola-lang/typescript-plugin",
        "--pluginProbeLocations",
        pluginProbeRoot,
        "--disableAutomaticTypingAcquisition",
      ],
      { stdio: ["pipe", "pipe", "inherit"] },
    );
    this.proc.stdout?.setEncoding("utf8");
    this.proc.stdout?.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
  }

  private drain(): void {
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.buffer.slice(0, headerEnd);
      const length = Number(/Content-Length: (\d+)/.exec(header)?.[1] ?? Number.NaN);
      if (Number.isNaN(length)) throw new Error(`bad tsserver header: ${header}`);
      const start = headerEnd + 4;
      if (this.buffer.length < start + length) return;
      const message = JSON.parse(this.buffer.slice(start, start + length)) as {
        type: string;
        request_seq?: number;
        success?: boolean;
        message?: string;
        body?: unknown;
      };
      this.buffer = this.buffer.slice(start + length);
      if (message.type === "response" && message.request_seq !== undefined) {
        const entry = this.pending.get(message.request_seq);
        if (entry) {
          this.pending.delete(message.request_seq);
          if (message.success === false) entry.reject(new Error(`tsserver request failed: ${message.message}`));
          else entry.resolve(message.body);
        }
      }
    }
  }

  /** Fire-and-forget commands (open/change/close) get no response; sync commands resolve with the body. */
  send(command: string, args: unknown): void {
    this.seq += 1;
    this.proc.stdin?.write(`${JSON.stringify({ seq: this.seq, type: "request", command, arguments: args })}\n`);
  }

  request<T>(command: string, args: unknown): Promise<T> {
    this.send(command, args);
    const seq = this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(seq, { resolve: resolve as (body: unknown) => void, reject });
      setTimeout(() => {
        if (this.pending.delete(seq)) reject(new Error(`tsserver timed out on ${command}`));
      }, 120_000);
    });
  }

  kill(): void {
    this.proc.kill();
  }
}

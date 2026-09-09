import { mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ServerType, serve } from "@hono/node-server";
import { type ConsoleNotice, ConsoleService } from "./core/service.js";
import { createApp } from "./server/app.js";
import { SqliteConsoleStorage } from "./storage/sqlite.js";

export const CONSOLE_DEFAULT_PORT = 4141;

/**
 * The console is one instance per dev machine, so its root folder is
 * per-machine, not per-project: `~/.nola/console`. Everything the console
 * keeps lives under it — the database at `data/console.db` today, further
 * settings later. `StartConsoleOptions.path` is the only override.
 */
export function defaultConsolePath(): string {
  return join(homedir(), ".nola", "console");
}

/** The SQLite database inside a console root. */
export function consoleDbPath(root: string): string {
  return join(root, "data", "console.db");
}

export interface StartConsoleOptions {
  /** Exact port to bind — no scanning (0 = OS-assigned). Default: scan upward from 4141. */
  port?: number;
  /** Default 127.0.0.1 — loopback only (console design §13). */
  host?: string;
  /** The console's root folder — default `~/.nola/console`; created on demand. The database lives at `<path>/data/console.db`. */
  path?: string;
  /** Directory of the built UI. Default: `ui/` beside the compiled module (dist/ui in the published package); absent falls back to the placeholder page. */
  uiDir?: string;
}

export interface RunningConsole {
  url: string;
  port: number;
  /** The console root (`StartConsoleOptions.path` resolved). */
  path: string;
  /** The SQLite database inside the root. */
  dbPath: string;
  /** Subscribe to every ingested envelope and the `cleared` notice (the same fan-out the SSE stream reads); returns the unsubscribe. */
  onEvent(listener: (notice: ConsoleNotice) => void): () => void;
  close(): Promise<void>;
}

export async function findFreePort(host: string, start: number, attempts = 20): Promise<number> {
  for (let port = start; port < start + attempts; port++) {
    const free = await new Promise<boolean>((resolve) => {
      const probe = createServer();
      probe.once("error", () => resolve(false));
      probe.listen({ port, host }, () => probe.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error(`No free port found in ${start}..${start + attempts - 1}.`);
}

/** Open storage, mount the app, bind loopback — one process, one local database (console design §13). */
export async function startConsole(options: StartConsoleOptions = {}): Promise<RunningConsole> {
  const host = options.host ?? "127.0.0.1";
  const path = options.path ?? defaultConsolePath();
  const dbPath = consoleDbPath(path);
  mkdirSync(dirname(dbPath), { recursive: true });
  const storage = new SqliteConsoleStorage(dbPath);
  const service = new ConsoleService(storage);
  const uiDir = options.uiDir ?? fileURLToPath(new URL("ui/", import.meta.url));
  const app = createApp(service, { uiDir });
  const port = options.port ?? (await findFreePort(host, CONSOLE_DEFAULT_PORT));
  const server = await new Promise<ServerType>((resolve, reject) => {
    const s = serve({ fetch: app.fetch, port, hostname: host }, () => resolve(s));
    s.once("error", reject);
  });
  // An explicit port 0 binds an OS-assigned port — report the real one.
  const address = server.address();
  const boundPort = typeof address === "object" && address !== null ? address.port : port;
  return {
    url: `http://${host}:${boundPort}`,
    port: boundPort,
    path,
    dbPath,
    onEvent: (listener) => service.onEvent(listener),
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      await storage.close();
    },
  };
}

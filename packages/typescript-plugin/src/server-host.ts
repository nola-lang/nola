import { compileCompanion } from "@nola-lang/compiler";
import type ts from "typescript";
import { companionRegistration } from "./companion-host.js";

const PATCHED = Symbol.for("nola.companionServerHost");

/**
 * Make companions REAL to tsserver's file layer. Companion modules are
 * program files, and tsserver's ScriptInfo/watch machinery assumes every
 * program file is backed by disk or an open editor document — a companion
 * that exists only in language-service-host decorations violates that
 * invariant, and tsserver enforces it with Debug asserts in several places
 * (ProjectService.setDocument, Project.getScriptInfos via project telemetry —
 * the latter crashed VS Code's TS 6.0.3 on project load).
 *
 * The decoration answers for registered companion paths at the ServerHost
 * (ts.sys-equivalent) level:
 * - fileExists/readFile: the companion exists; its text derives from the
 *   ON-DISK source module (compileCompanion). The live unsaved-edits variant
 *   still comes from the language-service host's snapshot decoration — this
 *   layer only has to be consistent enough for ScriptInfo bookkeeping.
 * - getModifiedTime: the SOURCE file's mtime (the companion "changes" exactly
 *   when its source does).
 * - watchFile: forwards to a watch on the source file, reporting events under
 *   the companion's name — deleting the source marks the companion deleted.
 *
 * One ServerHost serves the whole tsserver process; the patch applies once.
 */
export function decorateServerHostForCompanions(serverHost: ts.server.ServerHost): void {
  const host = serverHost as ts.server.ServerHost & { [PATCHED]?: true };
  if (host[PATCHED]) return;
  host[PATCHED] = true;

  const priorFileExists = host.fileExists.bind(host);
  host.fileExists = (path) => (companionRegistration(path) ? true : priorFileExists(path));

  const priorReadFile = host.readFile.bind(host);
  host.readFile = (path, encoding) => {
    const registration = companionRegistration(path);
    if (!registration) return priorReadFile(path, encoding);
    const source = priorReadFile(registration.sourceFile);
    if (source === undefined) return undefined;
    return compileCompanion(source, registration.sourceFile, { sourceRoot: registration.sourceRoot }).code;
  };

  const priorGetModifiedTime = host.getModifiedTime?.bind(host);
  if (priorGetModifiedTime) {
    host.getModifiedTime = (path) => {
      const registration = companionRegistration(path);
      return priorGetModifiedTime(registration ? registration.sourceFile : path);
    };
  }

  const priorWatchFile = host.watchFile.bind(host);
  host.watchFile = (path, callback, pollingInterval, options) => {
    const registration = companionRegistration(path);
    if (!registration) return priorWatchFile(path, callback, pollingInterval, options);
    return priorWatchFile(
      registration.sourceFile,
      (_fileName, eventKind, modifiedTime) => callback(path, eventKind, modifiedTime),
      pollingInterval,
      options,
    );
  };
}

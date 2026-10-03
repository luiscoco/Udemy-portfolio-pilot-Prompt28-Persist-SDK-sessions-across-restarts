import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { AgentRunFailure } from './errors.js';
import type { AgentSessionLocator } from './streaming.js';

/** SDK session IDs are UUIDs; anything else is never turned into a path or passed to `resume`. */
export const SDK_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The SDK could not resume the requested session, and the attempt produced no visible text and no
 * tool call. Only then is it safe for the application to start a replacement session for the same
 * turn; a failure after output is an ordinary run failure.
 */
export class SessionResumeError extends AgentRunFailure {
  constructor() { super('resume_failed', 'The previous assistant session could not be resumed.'); }
}

/** Stable key for "this host + this session workspace". A binding from another key is not local. */
export function localHostKey(workspace: string): string {
  return `local:${createHash('sha256').update(`${hostname()}\0${workspace}`).digest('hex').slice(0, 40)}`;
}

/**
 * Whether the documented transcript file `$CLAUDE_CONFIG_DIR/projects/<project>/<sessionId>.jsonl`
 * exists and is non-empty. The live adapter sets CLAUDE_CONFIG_DIR to the agent workspace. All
 * project directories are searched, as the CLI does for `resume`, because the documented name
 * encoding truncates and hashes long paths. (The SDK's `getSessionInfo()` reads the API process's own
 * CLAUDE_CONFIG_DIR, not the subprocess's, so it cannot answer this for an isolated workspace.)
 */
export async function localSessionFileExists(configDir: string, sessionId: string): Promise<boolean> {
  if (!SDK_SESSION_ID.test(sessionId)) return false;
  let projects: string[];
  try { projects = await readdir(join(configDir, 'projects')); } catch { return false; }
  for (const project of projects.slice(0, 1000)) {
    try {
      const file = await stat(join(configDir, 'projects', project, `${sessionId}.jsonl`));
      if (file.isFile() && file.size > 0) return true;
    } catch { /* not in this project directory */ }
  }
  return false;
}

/** Locator for SDK session files under one workspace on this host. */
export function localSessionLocator(workspace: string, modelKey: string): AgentSessionLocator {
  return { hostKey: localHostKey(workspace), modelKey, isAvailable: sessionId => localSessionFileExists(workspace, sessionId) };
}

/**
 * Workspace identity resolution.
 *
 * Clients report whatever directory they happen to be launched from. Hashing that
 * raw path splits one repository into a different namespace per subdirectory, so
 * paths are first canonicalised to their git root (and worktrees are named after
 * the repository they belong to) before an id is derived.
 *
 * The walk is pure filesystem work on purpose: session opens happen on a hot path
 * and spawning `git rev-parse` per open costs a process and an extra failure mode.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, resolve, sep } from "node:path";

/** Depth guard so a pathological path cannot walk forever. */
const MAX_PARENT_WALK = 40;

const WORKTREE_GITDIR = /^(.+)[/\\]\.git[/\\]worktrees[/\\][^/\\]+$/;

export interface WorkspaceIdentity {
  /** Stable id for the workspace; undefined when the path is not worth tracking. */
  workspaceId?: string;
  /** Human-readable name: "repo" or "repo/worktree". */
  projectLabel?: string;
  /** Canonical path the id was derived from (the git root when one was found). */
  workspacePath?: string;
}

/**
 * Derives a stable workspace id from a filesystem path.
 *
 * Stays byte-identical to the desktop agent's workspaceIdFromPath
 * (App/memmy-agent/src/memmy-memory/hook.ts) so both clients land in the same
 * namespace for the same folder. Raw sha256 of the path, not stableHash.
 */
export function workspaceIdFromPath(workspacePath: string): string {
  return createHash("sha256").update(workspacePath).digest("hex").slice(0, 16);
}

/**
 * Resolves the project a reported directory belongs to.
 *
 * @param rawPath Directory reported by the client.
 * @param options.homeDirectory Overrides the home directory; for tests.
 * @returns The workspace identity, or an empty object when the path is untrackable.
 */
export function resolveWorkspaceIdentity(
  rawPath: string | undefined | null,
  options: { homeDirectory?: string } = {}
): WorkspaceIdentity {
  const home = options.homeDirectory ?? homedir();
  const normalized = normalizePath(rawPath, home);
  if (!normalized || !isTrackablePath(normalized, home)) return {};

  const root = gitRootFor(normalized) ?? normalized;
  return {
    workspaceId: workspaceIdFromPath(root),
    projectLabel: labelFor(root),
    workspacePath: root
  };
}

function normalizePath(rawPath: string | undefined | null, home: string): string | undefined {
  const trimmed = typeof rawPath === "string" ? rawPath.trim() : "";
  if (!trimmed) return undefined;
  const expanded = trimmed === "~" ? home : trimmed.startsWith("~/") ? home + trimmed.slice(1) : trimmed;
  if (!isAbsolute(expanded)) return undefined;
  return resolve(expanded);
}

/** Filesystem roots and the bare home directory are containers, not projects. */
function isTrackablePath(path: string, home: string): boolean {
  return path !== sep && path !== resolve(home) && dirname(path) !== path;
}

/**
 * Walks up looking for a `.git` entry.
 *
 * A `.git` directory marks a normal checkout; a `.git` file points at the real
 * git dir and identifies a worktree, whose id must still be its own (worktrees
 * hold different code) while its label names the parent repository.
 */
function gitRootFor(startPath: string): string | undefined {
  let current = startPath;
  for (let depth = 0; depth < MAX_PARENT_WALK; depth += 1) {
    if (existsSync(`${current}${sep}.git`)) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
  return undefined;
}

/** Reads the parent repository of a worktree, when the root is one. */
function parentRepoFor(root: string): string | undefined {
  const gitPath = `${root}${sep}.git`;
  try {
    if (statSync(gitPath).isDirectory()) return undefined;
    const gitdir = readFileSync(gitPath, "utf8").trim().match(/^gitdir:\s*(.+)$/)?.[1];
    if (!gitdir) return undefined;
    const absolute = isAbsolute(gitdir) ? gitdir : resolve(root, gitdir);
    return WORKTREE_GITDIR.exec(absolute)?.[1];
  } catch {
    return undefined;
  }
}

function labelFor(root: string): string {
  const own = basename(root);
  const parentRepo = parentRepoFor(root);
  return parentRepo ? `${basename(parentRepo)}/${own}` : own;
}

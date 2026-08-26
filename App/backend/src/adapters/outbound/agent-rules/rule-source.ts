/** Rule source module. */
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import YAML from "yaml";

import type { AgentRule, AgentRuleSource, AgentRuleSourceError } from "./types.js";

const RULE_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

/** Default directory holding one markdown file per rule. */
export function resolveAgentRulesDirectory(): string {
  return join(homedir(), ".memmy", "agent-rules");
}

/**
 * Reads every `*.md` in the rule directory. A malformed file is reported rather
 * than thrown, so one bad rule cannot stop the others from being applied.
 */
export async function readAgentRules(directory = resolveAgentRulesDirectory()): Promise<AgentRuleSource> {
  const fileNames = await listRuleFiles(directory);
  const rules: AgentRule[] = [];
  const errors: AgentRuleSourceError[] = [];
  const seen = new Map<string, string>();

  for (const fileName of fileNames) {
    const sourcePath = join(directory, fileName);
    let raw: string;
    try {
      raw = await readFile(sourcePath, "utf8");
    } catch (error) {
      errors.push({ sourcePath, message: describe(error) });
      continue;
    }

    const parsed = parseRuleFile(raw, sourcePath);
    if ("message" in parsed) {
      errors.push(parsed);
      continue;
    }

    const previous = seen.get(parsed.id);
    if (previous) {
      errors.push({ sourcePath, message: `duplicate rule id "${parsed.id}", already defined by ${previous}` });
      continue;
    }

    seen.set(parsed.id, sourcePath);
    rules.push(parsed);
  }

  return { rules, errors };
}

/** Parses one rule file's frontmatter and body. */
export function parseRuleFile(raw: string, sourcePath: string): AgentRule | AgentRuleSourceError {
  const frontmatter = splitFrontmatter(raw);
  if (!frontmatter) {
    return { sourcePath, message: "missing YAML frontmatter delimited by ---" };
  }

  let meta: unknown;
  try {
    meta = YAML.parse(frontmatter.meta);
  } catch (error) {
    return { sourcePath, message: `invalid YAML frontmatter: ${describe(error)}` };
  }

  if (!isRecord(meta)) {
    return { sourcePath, message: "frontmatter must be a mapping" };
  }

  const id = typeof meta.id === "string" && meta.id.trim() ? meta.id.trim() : basename(sourcePath, extname(sourcePath));
  if (!RULE_ID_PATTERN.test(id)) {
    return { sourcePath, message: `rule id "${id}" must match ${RULE_ID_PATTERN.source}` };
  }

  const targets = readTargets(meta.targets);
  if (!targets) {
    return { sourcePath, message: "targets must be a non-empty list of target ids" };
  }

  const overrides = readOverrides(meta.overrides, targets);
  if ("message" in overrides) {
    return { sourcePath, message: overrides.message };
  }

  const body = frontmatter.body.trim();
  if (!body && Object.keys(overrides.value).length === 0) {
    return { sourcePath, message: "rule body is empty and no per-target override supplies one" };
  }

  return { id, targets, body, overrides: overrides.value, sourcePath };
}

/** Returns the body a given target should receive, or null when the rule skips it. */
export function renderRuleForTarget(rule: AgentRule, targetId: string): string | null {
  if (!rule.targets.includes(targetId)) {
    return null;
  }

  const override = rule.overrides[targetId];
  const body = (override ?? rule.body).trim();
  return body ? body : null;
}

async function listRuleFiles(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isMissing(error)) {
      return [];
    }

    throw error;
  }
}

function splitFrontmatter(raw: string): { meta: string; body: string } | null {
  const normalized = raw.replace(/^﻿/, "");
  if (!normalized.startsWith("---")) {
    return null;
  }

  const end = normalized.indexOf("\n---", 3);
  if (end === -1) {
    return null;
  }

  const meta = normalized.slice(normalized.indexOf("\n") + 1, end);
  const afterDelimiter = normalized.indexOf("\n", end + 1);
  const body = afterDelimiter === -1 ? "" : normalized.slice(afterDelimiter + 1);
  return { meta, body };
}

function readTargets(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const targets = value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim());
  return targets.length > 0 ? [...new Set(targets)] : null;
}

function readOverrides(value: unknown, targets: readonly string[]): { value: Record<string, string> } | AgentRuleSourceError {
  if (value === undefined || value === null) {
    return { value: {} };
  }

  if (!isRecord(value)) {
    return { sourcePath: "", message: "overrides must be a mapping of target id to body" };
  }

  const overrides: Record<string, string> = {};
  for (const [targetId, body] of Object.entries(value)) {
    if (typeof body !== "string") {
      return { sourcePath: "", message: `override for "${targetId}" must be a string` };
    }

    if (!targets.includes(targetId)) {
      return { sourcePath: "", message: `override for "${targetId}" is not in targets` };
    }

    overrides[targetId] = body;
  }

  return { value: overrides };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

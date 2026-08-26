import { access, open, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { stripInlineMediaPayloads } from "../../../shared/inline-media-sanitizer.js";
import {
  resolveClaudeCodeProjectsDirectory,
  resolveCodexSessionsDirectory
} from "../agent-paths.js";
import { redactSecrets } from "./secret-redactor.js";
import type {
  OnboardingInsightSampleOptions,
  OnboardingInsightSampler,
  OnboardingSampledQuery
} from "./insight-sampler-types.js";

const JSONL_CHUNK_SIZE = 64 * 1024;

interface RecentFile {
  filePath: string;
  mtimeMs: number;
}

type JsonRecord = Record<string, unknown>;
type JsonQueryExtractor = (record: JsonRecord, fallback: {
  sourceId: string;
  filePath: string;
  lineIndex: number;
}) => OnboardingSampledQuery | null;
type JsonLineFilter = (line: string) => boolean;

export function createBuiltinOnboardingInsightSamplers(): OnboardingInsightSampler[] {
  return [
    createClaudeCodeInsightSampler({ root: resolveClaudeCodeProjectsDirectory() }),
    createCodexInsightSampler({ root: resolveCodexSessionsDirectory() })
  ];
}

export function createCodexInsightSampler(input: { root: string }): OnboardingInsightSampler {
  return createJsonlInsightSampler({
    sourceId: "codex",
    displayName: "Codex",
    root: input.root,
    matchesFile: (name) => name.startsWith("rollout-") && name.endsWith(".jsonl"),
    shouldParseLine: isPotentialCodexUserMessageLine,
    extractQuery: extractCodexQuery
  });
}

export function createClaudeCodeInsightSampler(input: { root: string }): OnboardingInsightSampler {
  return createJsonlInsightSampler({
    sourceId: "claude_code",
    displayName: "Claude Code",
    root: input.root,
    matchesFile: (name) => name.endsWith(".jsonl"),
    extractQuery: extractClaudeCodeQuery
  });
}

function createJsonlInsightSampler(input: {
  sourceId: string;
  displayName: string;
  root: string;
  matchesFile(name: string): boolean;
  shouldParseLine?: JsonLineFilter;
  extractQuery: JsonQueryExtractor;
}): OnboardingInsightSampler {
  return {
    sourceId: input.sourceId,
    displayName: input.displayName,
    async detect() {
      return pathExists(input.root);
    },
    async sampleRecentUserQueries(options) {
      if (!(await pathExists(input.root))) {
        return {
          sourceId: input.sourceId,
          displayName: input.displayName,
          recentSessionCount: 0,
          latestActivityAt: null,
          queries: [],
          errors: []
        };
      }

      const startedAt = Date.now();
      const files = await listRecentFiles(input.root, input.matchesFile, options.maxSessionFiles, options);
      const queries: OnboardingSampledQuery[] = [];
      const errors: Array<{ target: string; reason: string }> = [];
      for (const file of files) {
        if (queries.length >= options.maxQueries || deadlineReached(options, startedAt)) break;
        try {
          const records = await readRecentJsonlObjects(file.filePath, options, input.shouldParseLine);
          for (const [lineIndex, record] of records.entries()) {
            if (queries.length >= options.maxQueries) break;
            const query = input.extractQuery(record, {
              sourceId: input.sourceId,
              filePath: file.filePath,
              lineIndex
            });
            if (query) queries.push(limitSampledQuery(query, options.maxQueryChars));
          }
        } catch (error) {
          errors.push({ target: file.filePath, reason: error instanceof Error ? error.message : "read failed" });
        }
      }

      const sorted = sortQueriesRecent(queries).slice(0, options.maxQueries);
      return {
        sourceId: input.sourceId,
        displayName: input.displayName,
        recentSessionCount: files.length,
        latestActivityAt: sorted[0]?.createdAt ?? null,
        queries: sorted,
        errors
      };
    }
  };
}

async function listRecentFiles(
  root: string,
  matchesFile: (name: string) => boolean,
  limit: number,
  options: Pick<OnboardingInsightSampleOptions, "signal" | "deadlineMs">
): Promise<RecentFile[]> {
  const startedAt = Date.now();
  const files: RecentFile[] = [];

  async function walk(directory: string): Promise<void> {
    if (options.signal?.aborted || Date.now() - startedAt > options.deadlineMs) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile() && matchesFile(entry.name)) {
        try {
          files.push({ filePath: path, mtimeMs: (await stat(path)).mtimeMs });
          files.sort((left, right) => right.mtimeMs - left.mtimeMs);
          if (files.length > limit * 4) files.length = limit * 4;
        } catch {
          // Ignore unreadable candidate files.
        }
      }
    }
  }

  await walk(root);
  return files.sort((left, right) => right.mtimeMs - left.mtimeMs).slice(0, limit);
}

async function readRecentJsonlObjects(
  filePath: string,
  options: OnboardingInsightSampleOptions,
  shouldParseLine?: JsonLineFilter
): Promise<JsonRecord[]> {
  const fileStat = await stat(filePath);
  const bytesToRead = Math.min(fileStat.size, options.maxBytesPerFile);
  if (bytesToRead <= 0) return [];
  const handle = await open(filePath, "r");
  try {
    const chunks: Buffer[] = [];
    let remaining = bytesToRead;
    let position = fileStat.size;
    while (remaining > 0) {
      const size = Math.min(JSONL_CHUNK_SIZE, remaining);
      position -= size;
      const buffer = Buffer.alloc(size);
      await handle.read(buffer, 0, size, position);
      chunks.unshift(buffer);
      remaining -= size;
      if (position <= 0) break;
    }
    const lines = Buffer.concat(chunks).toString("utf8").split(/\r?\n/u);
    if (fileStat.size > bytesToRead) lines.shift();
    return lines
      .reverse()
      .map((line) => parseJsonObjectLine(line, shouldParseLine))
      .filter((record): record is JsonRecord => Boolean(record));
  } finally {
    await handle.close();
  }
}

function isPotentialCodexUserMessageLine(line: string): boolean {
  return /"type"\s*:\s*"response_item"/u.test(line) &&
    /"type"\s*:\s*"message"/u.test(line) &&
    /"role"\s*:\s*"user"/u.test(line);
}

function extractCodexQuery(record: JsonRecord, fallback: { sourceId: string; filePath: string; lineIndex: number }): OnboardingSampledQuery | null {
  const payload = recordValue(record.payload);
  if (record.type !== "response_item" || !payload || payload.type !== "message" || payload.role !== "user") return null;
  const text = contentText(payload.content);
  if (!text) return null;
  const rolloutId = rolloutIdFromPath(fallback.filePath);
  return {
    sourceId: fallback.sourceId,
    conversationId: rolloutId,
    messageId: `${rolloutId}:${fallback.lineIndex}`,
    createdAt: normalizeTimestamp(record.timestamp),
    text,
    workspacePath: stringValue(record.cwd) ?? stringValue(payload.cwd)
  };
}

function extractClaudeCodeQuery(record: JsonRecord, fallback: { sourceId: string; lineIndex: number }): OnboardingSampledQuery | null {
  if (record.type !== "user") return null;
  const message = recordValue(record.message);
  const text = message ? contentText(message.content) : null;
  if (!text) return null;
  const conversationId = stringValue(record.sessionId) ?? "unknown-session";
  return {
    sourceId: fallback.sourceId,
    conversationId,
    messageId: stringValue(record.uuid) ?? `${conversationId}:${fallback.lineIndex}`,
    createdAt: normalizeTimestamp(record.timestamp),
    text,
    workspacePath: stringValue(record.cwd)
  };
}

function limitSampledQuery(query: OnboardingSampledQuery, maxChars: number): OnboardingSampledQuery {
  const redacted = stripInlineMediaPayloads(redactSecrets(query.text)).trim();
  return { ...query, text: redacted.length <= maxChars ? redacted : `${redacted.slice(0, maxChars)}...` };
}

function sortQueriesRecent(queries: OnboardingSampledQuery[]): OnboardingSampledQuery[] {
  return [...queries].sort((left, right) =>
    Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
    left.sourceId.localeCompare(right.sourceId) ||
    left.conversationId.localeCompare(right.conversationId) ||
    left.messageId.localeCompare(right.messageId)
  );
}

function contentText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (!Array.isArray(value)) return null;
  const text = value
    .filter((item): item is JsonRecord => typeof item === "object" && item !== null && !Array.isArray(item))
    .map((item) => stringValue(item.text) ?? stringValue(item.content))
    .filter((item): item is string => Boolean(item))
    .join("\n");
  return text.trim() || null;
}

function parseJsonObjectLine(input: string, shouldParseLine?: JsonLineFilter): JsonRecord | null {
  const line = input.trim();
  if (!line || (shouldParseLine && !shouldParseLine(line))) return null;
  try {
    const parsed = JSON.parse(line) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as JsonRecord : null;
  } catch {
    return null;
  }
}

function recordValue(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value === "number") {
    const date = new Date(value > 10_000_000_000 ? value : value * 1000);
    return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
  }
  if (typeof value === "string") {
    const date = /^\d+$/u.test(value) ? new Date(Number(value)) : new Date(value);
    return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
  }
  return new Date(0).toISOString();
}

function rolloutIdFromPath(filePath: string): string {
  const name = basename(filePath).replace(/\.jsonl$/u, "");
  return name.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu)?.[0] ?? name;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function deadlineReached(options: OnboardingInsightSampleOptions, startedAt: number): boolean {
  return Boolean(options.signal?.aborted) || Date.now() - startedAt > options.deadlineMs;
}

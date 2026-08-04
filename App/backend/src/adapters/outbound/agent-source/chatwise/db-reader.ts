import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";

const SQLITE_ROW_YIELD_INTERVAL = 100;
const REQUIRED_MESSAGE_COLUMNS = ["id", "chatId", "createdAt", "content", "role"] as const;
const REQUIRED_CHAT_COLUMNS = ["id"] as const;

export interface RawChatwiseDatabaseMessage {
  messageId: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  workspacePath: string | null;
  gitRoot: string | null;
  rawMeta: Readonly<Record<string, unknown>>;
}

interface ChatwiseMessageRow {
  message_id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: number | string;
  message_model: string | null;
  chat_model: string | null;
  assistant_id: string | null;
  agent_options: string | null;
}

export async function* readChatwiseDatabase(path: string): AsyncIterable<RawChatwiseDatabaseMessage> {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const messageColumns = getTableColumns(db, "message");
    const chatColumns = getTableColumns(db, "chat");
    if (!hasColumns(messageColumns, REQUIRED_MESSAGE_COLUMNS) || !hasColumns(chatColumns, REQUIRED_CHAT_COLUMNS)) {
      return;
    }

    const statement = db.prepare(buildMessageSql(messageColumns, chatColumns));
    let rows = 0;
    for (const row of statement.iterate() as Iterable<ChatwiseMessageRow>) {
      rows += 1;
      if (rows % SQLITE_ROW_YIELD_INTERVAL === 0) await yieldToEventLoop();
      const message = toRawMessage(row);
      if (message) yield message;
    }
  } finally {
    db.close();
  }
}

function buildMessageSql(messageColumns: ReadonlySet<string>, chatColumns: ReadonlySet<string>): string {
  return `
    SELECT
      m."id" AS message_id,
      m."chatId" AS conversation_id,
      m."role" AS role,
      m."content" AS content,
      m."createdAt" AS created_at,
      ${qualifiedColumn(messageColumns, "m", "model", "message_model")},
      ${qualifiedColumn(chatColumns, "c", "model", "chat_model")},
      ${qualifiedColumn(chatColumns, "c", "assistantId", "assistant_id")},
      ${qualifiedColumn(chatColumns, "c", "agentOptions", "agent_options")}
    FROM "message" m
    LEFT JOIN "chat" c ON c."id" = m."chatId"
    WHERE m."content" IS NOT NULL
      AND m."content" != ''
    ORDER BY m."chatId" ASC, m."createdAt" ASC, m."id" ASC
  `;
}

function qualifiedColumn(columns: ReadonlySet<string>, tableAlias: string, name: string, alias: string): string {
  return `${columns.has(name) ? `${tableAlias}."${name}"` : "NULL"} AS "${alias}"`;
}

function toRawMessage(row: ChatwiseMessageRow): RawChatwiseDatabaseMessage | null {
  const role = normalizeRole(row.role);
  if (!role || typeof row.content !== "string" || row.content.length === 0) return null;
  const workspacePath = readWorkspacePath(row.agent_options);
  return {
    messageId: String(row.message_id),
    conversationId: String(row.conversation_id),
    role,
    content: row.content,
    createdAt: normalizeTimestamp(row.created_at),
    workspacePath,
    gitRoot: workspacePath ? findGitRoot(workspacePath) : null,
    rawMeta: Object.freeze({
      schemaKind: "chatwise-sqlite",
      model: row.message_model ?? row.chat_model,
      assistantId: row.assistant_id
    })
  };
}

function normalizeRole(role: string): RawChatwiseDatabaseMessage["role"] | null {
  return role === "user" || role === "assistant" ? role : null;
}

function normalizeTimestamp(value: number | string): string {
  const numeric = typeof value === "number" ? value : Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function readWorkspacePath(agentOptions: string | null): string | null {
  if (!agentOptions) return null;
  try {
    const parsed = JSON.parse(agentOptions) as unknown;
    if (!isRecord(parsed)) return null;
    const value = parsed.workDirectory;
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  } catch {
    return null;
  }
}

function findGitRoot(workspacePath: string): string | null {
  let current = workspacePath;
  while (current !== dirname(current)) {
    if (existsSync(join(current, ".git"))) return current;
    current = dirname(current);
  }
  return existsSync(join(current, ".git")) ? current : null;
}

function getTableColumns(db: DatabaseSync, tableName: string): ReadonlySet<string> {
  if (!hasTable(db, tableName)) return new Set();
  const rows = db.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

function hasTable(db: DatabaseSync, tableName: string): boolean {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function hasColumns(columns: ReadonlySet<string>, names: readonly string[]): boolean {
  return names.every((name) => columns.has(name));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

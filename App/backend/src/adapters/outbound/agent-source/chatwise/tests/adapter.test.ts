import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createChatwiseSourceAdapter, readChatwiseDatabase } from "../index.js";

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe("chatwise source adapter", () => {
  it("reads ChatWise SQLite messages without copying provider configuration", async () => {
    const fixture = createDatabaseFixture();
    const messages = await collect(readChatwiseDatabase(fixture.databasePath));

    expect(messages).toEqual([
      expect.objectContaining({
        messageId: "message-user",
        conversationId: "chat-1",
        role: "user",
        workspacePath: fixture.workspacePath,
        gitRoot: fixture.workspacePath,
        rawMeta: { schemaKind: "chatwise-sqlite", model: "deepseek-v4-flash", assistantId: "assistant-1" }
      }),
      expect.objectContaining({ messageId: "message-assistant", role: "assistant" })
    ]);
    expect(JSON.stringify(messages)).not.toContain("provider-secret");
  });

  it("redacts secrets while preserving the complete conversation window", async () => {
    const fixture = createDatabaseFixture();
    const adapter = createChatwiseSourceAdapter({ databasePath: fixture.databasePath });
    const messages = await collect(adapter.scan({ since: "2026-08-04T10:00:01.000Z" }));

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      sourceId: "chatwise",
      content: "Remember OPENAI_API_KEY=[REDACTED:openai_api_key]"
    });
  });

  it("treats a missing database as empty and respects abort", async () => {
    const missing = join(tmpdir(), crypto.randomUUID(), "app.db");
    await expect(collect(createChatwiseSourceAdapter({ databasePath: missing }).scan({}))).resolves.toEqual([]);

    const fixture = createDatabaseFixture();
    const controller = new AbortController();
    controller.abort();
    await expect(collect(createChatwiseSourceAdapter({ databasePath: fixture.databasePath }).scan({ signal: controller.signal })))
      .rejects.toMatchObject({ name: "AbortError" });
  });
});

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}

function createDatabaseFixture(): { workspacePath: string; databasePath: string } {
  tempDir = mkdtempSync(join(tmpdir(), "memmy-chatwise-source-"));
  const workspacePath = join(tempDir, "project");
  const databasePath = join(tempDir, "app.db");
  mkdirSync(join(workspacePath, ".git"), { recursive: true });
  const db = new DatabaseSync(databasePath);
  try {
    db.exec(`
      CREATE TABLE chat (id TEXT PRIMARY KEY, model TEXT, assistantId TEXT, agentOptions TEXT);
      CREATE TABLE message (id TEXT PRIMARY KEY, chatId TEXT, createdAt INTEGER, content TEXT, role TEXT, model TEXT);
      CREATE TABLE provider (id TEXT PRIMARY KEY, config TEXT);
    `);
    db.prepare("INSERT INTO chat VALUES (?, ?, ?, ?)").run("chat-1", "deepseek-v4-flash", "assistant-1", JSON.stringify({ workDirectory: workspacePath }));
    db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?, ?)").run("message-user", "chat-1", Date.parse("2026-08-04T10:00:00.000Z"), "Remember OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN", "user", null);
    db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?, ?)").run("message-assistant", "chat-1", Date.parse("2026-08-04T10:00:01.000Z"), "Done", "assistant", "deepseek-v4-flash");
    db.prepare("INSERT INTO provider VALUES (?, ?)").run("provider-1", "provider-secret");
  } finally {
    db.close();
  }
  return { workspacePath, databasePath };
}

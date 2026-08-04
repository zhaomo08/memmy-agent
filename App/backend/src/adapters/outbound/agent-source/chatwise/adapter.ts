import { access } from "node:fs/promises";
import { resolveChatwiseDatabasePath } from "../../agent-paths.js";
import { collectConversationWindow } from "../conversation-window.js";
import { redactSecrets } from "../secret-redactor.js";
import type { ConversationMessage, ScanOptions, SourceAdapter, SourceDescriptor } from "../types.js";
import { readChatwiseDatabase, type RawChatwiseDatabaseMessage } from "./db-reader.js";

const CHATWISE_SOURCE_ID = "chatwise";

export interface CreateChatwiseSourceAdapterDeps {
  databasePath?: string;
  descriptor?: SourceDescriptor;
}

export function createChatwiseSourceAdapter(deps: CreateChatwiseSourceAdapterDeps = {}): SourceAdapter {
  const databasePath = deps.databasePath ?? resolveChatwiseDatabasePath();
  const descriptor = deps.descriptor ?? Object.freeze({
    sourceId: CHATWISE_SOURCE_ID,
    displayName: "ChatWise",
    builtin: true,
    dataPath: databasePath
  });

  return {
    descriptor,

    async detect() {
      return pathExists(databasePath);
    },

    async *scan(options: ScanOptions) {
      options.signal?.throwIfAborted();
      options.onProgress?.({ sourceId: descriptor.sourceId, phase: "discover", current: 0, total: 1 });
      if (!(await pathExists(databasePath))) {
        options.onProgress?.({ sourceId: descriptor.sourceId, phase: "done", current: 0, total: 0 });
        return;
      }
      options.onProgress?.({ sourceId: descriptor.sourceId, phase: "discover", current: 1, total: 1 });
      options.onProgress?.({ sourceId: descriptor.sourceId, phase: "read", current: 0, total: 1, message: databasePath });

      const messages = await collectConversationWindow(
        readChatwiseDatabase(databasePath),
        options.since,
        options.signal,
        options.maxMessages
      );
      for (const [index, rawMessage] of messages.entries()) {
        options.signal?.throwIfAborted();
        options.onProgress?.({ sourceId: descriptor.sourceId, phase: "redact", current: index, total: messages.length });
        yield toConversationMessage(descriptor.sourceId, rawMessage);
        options.onProgress?.({ sourceId: descriptor.sourceId, phase: "emit", current: index + 1, total: messages.length });
      }

      options.onProgress?.({ sourceId: descriptor.sourceId, phase: "done", current: messages.length, total: messages.length });
    }
  };
}

function toConversationMessage(sourceId: string, rawMessage: RawChatwiseDatabaseMessage): ConversationMessage {
  return {
    messageId: rawMessage.messageId,
    sourceId,
    conversationId: rawMessage.conversationId,
    role: rawMessage.role,
    content: redactSecrets(rawMessage.content),
    createdAt: rawMessage.createdAt,
    workspacePath: rawMessage.workspacePath,
    gitRoot: rawMessage.gitRoot,
    rawMeta: rawMessage.rawMeta
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

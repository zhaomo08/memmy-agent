/** Agent source service tests. */
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createSourceRegistry } from "../../adapters/outbound/agent-source/source-registry.js";
import type {
  ConversationMessage,
  ScanOptions,
  SourceAdapter,
  SourceDescriptor
} from "../../adapters/outbound/agent-source/types.js";
import type { MemoryClient } from "../../adapters/outbound/memory-client/index.js";
import { createAgentSourceRepository, type AgentSourceRepository } from "../../infrastructure/agent-source-store/index.js";
import { createMockMemoryClient } from "../../tests/support/mock-memory-client.js";
import type { IngestionService } from "../ingestion-service.js";
import { createAgentSourceService, type AgentSourceService } from "../agent-source-service.js";
import {
  AGENT_SOURCE_ANALYTICS_EVENTS,
  buildAgentSourceConflictParams,
  buildAgentSourcePluginLifecycleParams,
  buildAgentSourceSkillLifecycleParams,
  type AgentSourceLifecycleAnalytics,
} from "../../analytics/agent-source-analytics.js";
import type { SkillDistributionService } from "../skill-distribution-service.js";

let db: DatabaseSync | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

describe("agent source service", () => {
  it("lists builtin registry sources together with a stale persisted source so it can be deleted", async () => {
    const repository = createRepository();
    repository.upsertSource({
      sourceId: "legacy-source",
      displayName: "Legacy Source",
      dataPath: "/tmp/legacy-source",
      builtin: false
    });
    const service = createService({
      repository,
      adapters: [createFakeAdapter("codex")]
    });

    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({
        sourceId: "codex",
        displayName: "Codex",
        builtin: true,
        available: true,
        status: "not_connected"
      }),
      expect.objectContaining({
        sourceId: "legacy-source",
        displayName: "Legacy Source",
        builtin: false
      })
    ]);
  });

  it("reports a persisted source no longer in the registry as non-builtin so the UI offers deletion instead of a broken skill action", async () => {
    const repository = createRepository();
    repository.upsertSource({
      sourceId: "legacy-source",
      displayName: "Legacy Source",
      dataPath: "/tmp/legacy-source",
      builtin: true
    });
    repository.setStatus("legacy-source", "skill_installed");
    const service = createService({ repository, adapters: [] });

    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({
        sourceId: "legacy-source",
        displayName: "Legacy Source",
        builtin: false,
        status: "skill_installed"
      })
    ]);
  });

  it("marks unavailable builtin sources without removing them from the list", async () => {
    const service = createService({
      adapters: [createFakeAdapter("claude_code", [], undefined, false)]
    });

    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({
        sourceId: "claude_code",
        available: false,
        status: "not_connected"
      })
    ]);
  });

  it("scans one source and returns a ScanResult", async () => {
    const repository = createRepository();
    const service = createService({
      repository,
      adapters: [createFakeAdapter("codex", createCompleteMemoryMessages("codex", 1, "2026-05-28T10:00:00.000Z"))]
    });

    const result = await service.scanOne("codex", { since: "2026-05-28T00:00:00.000Z" });

    expect(result).toEqual({
      sourceId: "codex",
      discoveredConversations: 1,
      emittedMessages: 2,
      skipped: 0,
      memoryIds: [],
      errors: []
    });
    expect(repository.listSources()[0]).toMatchObject({
      sourceId: "codex",
      lastScannedAt: "2026-05-28T10:00:00.000Z"
    });
  });

  it("imports scanned Agent skills with immutable source provenance", async () => {
    const added: Parameters<MemoryClient["addMemory"]>[0][] = [];
    const memoryClient = createMockMemoryClient();
    const service = createService({
      adapters: [createFakeAdapter("cursor", createCompleteMemoryMessages("cursor", 1, "2026-05-28T10:00:00.000Z"))],
      memoryClient: {
        ...memoryClient,
        async addMemory(input, context) {
          added.push(input);
          return memoryClient.addMemory(input, context);
        }
      },
      skillDistributionService: {
        async listSkills() {
          return [{
            sourceAgentId: "cursor",
            sourceSkillId: "review-code",
            sourceSkillPath: "/tmp/cursor/skills/review-code/SKILL.md",
            sourceSkillVersion: "v2",
            sourceContentHash: "hash-v2",
            title: "review-code",
            content: "Review changed code.",
            updatedAt: "2026-05-28T09:00:00.000Z"
          }];
        },
        async install() {},
        async uninstall() {},
        async installPlugin() {},
        async uninstallPlugin() {}
      }
    });

    await service.scanOne("cursor");

    expect(added).toEqual([
      expect.objectContaining({
        layer: "Skill",
        sourceAgentId: "cursor",
        sourceSkillId: "review-code",
        sourceSkillPath: "/tmp/cursor/skills/review-code/SKILL.md",
        sourceSkillVersion: "v2",
        sourceContentHash: "hash-v2",
        tags: ["agent-source", "cross-agent-skill", "cursor"]
      })
    ]);
  });

  it("completes the scan and advances checkpoints when every memory is skipped", async () => {
    const repository = createRepository();
    const messages = createCompleteMemoryMessages("codex", 1, "2026-05-28T10:00:00.000Z");
    const service = createService({
      repository,
      adapters: [createFakeAdapter("codex", messages)],
      ingestionService: {
        async ingest(input) {
          const collected: ConversationMessage[] = [];
          for await (const message of input) {
            collected.push(message);
          }
          return {
            attempted: collected.length,
            written: 0,
            deduped: collected.length,
            failed: 0,
            writtenMemories: 0,
            dedupedMemories: 0,
            failedMemories: 0,
            memoryIds: [],
            conversations: 1,
            completedConversationIds: ["codex-conv-1"],
            incompleteConversationIds: [],
            failedConversationIds: [],
            errors: []
          };
        }
      }
    });

    const result = await service.scanOne("codex");

    expect(result).toEqual({
      sourceId: "codex",
      discoveredConversations: 1,
      emittedMessages: 2,
      skipped: 2,
      memoryIds: [],
      errors: []
    });
    expect(repository.getConversationCheckpoint("codex", "codex-conv-1")).not.toBeNull();
    expect(repository.getScanWatermark("codex")).not.toBeNull();
    expect(repository.listSources()[0]?.messageCount).toBe(0);
  });

  it("forwards adapter scan progress through scan options", async () => {
    const phases: string[] = [];
    const service = createService({
      adapters: [
        createFakeAdapter("codex", [createMessage("codex", 1)], async function* (options) {
          options.onProgress?.({
            sourceId: "codex",
            phase: "read",
            current: 1,
            total: 1,
            message: "adapter read"
          });
          yield createMessage("codex", 1);
        })
      ]
    });

    await service.scanOne("codex", {
      onProgress: (progress) => phases.push(`${progress.phase}:${progress.message ?? ""}`)
    });

    expect(phases).toContain("scan:adapter read");
  });

  it("returns source-scoped scan errors instead of throwing the whole scan job", async () => {
    const service = createService({
      adapters: [
        createFakeAdapter("codex", [], async function* () {
          for (const message of createCompleteMemoryMessages("codex", 1, "2026-05-28T10:00:00.000Z")) {
            yield message;
          }
          throw new Error("codex database is corrupt");
        })
      ]
    });

    const result = await service.scanOne("codex");

    expect(result).toEqual({
      sourceId: "codex",
      discoveredConversations: 1,
      emittedMessages: 2,
      skipped: 0,
      memoryIds: [],
      errors: [{ conversationId: "scan", reason: "codex database is corrupt" }]
    });
  });

  it("collects scanAll sources concurrently before ingestion", async () => {
    const started: string[] = [];
    const finished: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const createSequentialAdapter = (sourceId: string): SourceAdapter =>
      createFakeAdapter(sourceId, [createMessage(sourceId, 1)], async function* (options) {
        options.signal?.throwIfAborted();
        started.push(sourceId);
        if (sourceId === "codex") {
          await firstGate;
        } else {
          releaseFirst();
        }
        yield createMessage(sourceId, 1);
        finished.push(sourceId);
      });
    const service = createService({
      adapters: [createSequentialAdapter("codex"), createSequentialAdapter("custom")]
    });

    const results = await service.scanAll();

    expect(started).toEqual(["codex", "custom"]);
    expect(finished.sort()).toEqual(["codex", "custom"]);
    expect(results.map((result) => result.sourceId)).toEqual(["codex", "custom"]);
  });

  it("skips unavailable sources during all-source scans", async () => {
    const scanned: string[] = [];
    const service = createService({
      adapters: [
        createFakeAdapter("codex", [createMessage("codex", 1)], async function* () {
          scanned.push("codex");
          yield createMessage("codex", 1);
        }),
        createFakeAdapter("claude_code", [createMessage("claude_code", 1)], async function* () {
          scanned.push("claude_code");
          yield createMessage("claude_code", 1);
        }, false)
      ]
    });

    const results = await service.scanAll();

    expect(scanned).toEqual(["codex"]);
    expect(results.map((result) => result.sourceId)).toEqual(["codex"]);
  });

  it("rejects single-source collection when the source is unavailable", async () => {
    const service = createService({
      adapters: [createFakeAdapter("claude_code", [], undefined, false)]
    });

    await expect(service.collectOne("claude_code")).rejects.toMatchObject({
      code: "agent_source_unavailable"
    });
  });

  it("rejects plugin install before touching the target when the source is unavailable", async () => {
    const calls: string[] = [];
    const service = createService({
      adapters: [createFakeAdapter("claude_code", [], undefined, false)],
      skillDistributionService: {
        async install() {
          calls.push("install");
        },
        async uninstall() {
          calls.push("uninstall");
        },
        async installPlugin() {
          calls.push("installPlugin");
        },
        async uninstallPlugin() {
          calls.push("uninstallPlugin");
        }
      }
    });

    await expect(service.installPlugin("claude_code")).rejects.toMatchObject({
      code: "agent_source_unavailable"
    });
    expect(calls).toEqual([]);
  });

  it("uses an initial bounded scan before switching a source to incremental scans", async () => {
    const repository = createRepository();
    const scanOptions: ScanOptions[] = [];
    const service = createService({
      repository,
      adapters: [
        createFakeAdapter("codex", [], async function* (options) {
          scanOptions.push(options);
          for (const message of createCompleteMemoryMessages("codex", 1, "2026-05-28T10:00:00.000Z")) {
            yield message;
          }
        })
      ]
    });

    await service.scanOne("codex");
    await service.scanOne("codex");

    expect(scanOptions[0]).toMatchObject({
      order: "recent_first",
      maxScanTargets: 1000,
      since: undefined
    });
    expect(scanOptions[0]?.maxMessages).toBeUndefined();
    expect(scanOptions[1]).toMatchObject({
      order: "source_default",
      since: "2026-05-28T10:00:02.000Z"
    });
    expect(repository.getScanWatermark("codex")).toMatchObject({
      sourceId: "codex",
      mode: "incremental",
      baselineAt: "2026-05-28T10:00:00.000Z",
      latestSeenCreatedAt: "2026-05-28T10:00:02.000Z"
    });
  });

  it("bounds first all-source scan to global recent complete memories plus absent source reserve", async () => {
    const service = createService({
      adapters: [
        createFakeAdapter("codex", createCompleteMemoryMessages("codex", 1000, "2026-06-01T00:00:00.000Z")),
        createFakeAdapter("claude_code", createCompleteMemoryMessages("claude_code", 300, "2026-05-01T00:00:00.000Z")),
        createFakeAdapter("custom", createCompleteMemoryMessages("custom", 300, "2026-04-01T00:00:00.000Z"))
      ]
    });

    const collected = await service.collectAll({ mode: "initial_subset" });

    expectMemoryCount(collected.find((source) => source.sourceId === "codex")?.messages, 1000);
    expectMemoryCount(collected.find((source) => source.sourceId === "claude_code")?.messages, 200);
    expectMemoryCount(collected.find((source) => source.sourceId === "custom")?.messages, 200);
  });

  it("bounds one initial source by complete memory count instead of raw message count", async () => {
    const service = createService({
      adapters: [
        createFakeAdapter("codex", createCompleteMemoryMessages("codex", 1200, "2026-06-01T00:00:00.000Z", {
          includeTool: true
        }))
      ]
    });

    const collected = await service.collectOne("codex", { mode: "initial_subset" });

    expectMemoryCount(collected.messages, 1000);
    expect(collected.messages).toHaveLength(3000);
  });

  it("skips incomplete turns when bounding initial memories", async () => {
    const completeMessages = createCompleteMemoryMessages("codex", 10, "2026-05-01T00:00:00.000Z");
    const incompleteMessages = createIncompleteUserMessages("codex", 5, "2026-06-01T00:00:00.000Z");
    const service = createService({
      adapters: [createFakeAdapter("codex", [...incompleteMessages, ...completeMessages])]
    });

    const collected = await service.collectOne("codex", { mode: "initial_subset" });

    expectMemoryCount(collected.messages, 10);
    expect(collected.messages.some((message) => message.messageId.includes("incomplete"))).toBe(false);
  });

  it("excludes units whose first or last message violates the complete-turn boundary", async () => {
    const valid = createCompleteMemoryMessages("codex", 1, "2026-05-01T00:00:00.000Z", {
      includeTool: true
    });
    const invalid = [
      {
        ...createMessage("codex", 20),
        messageId: "invalid-user",
        conversationId: "invalid-user-tool",
        role: "user" as const,
        content: "query"
      },
      {
        ...createMessage("codex", 21),
        messageId: "invalid-tool",
        conversationId: "invalid-user-tool",
        role: "tool" as const,
        content: "tool output"
      },
      {
        ...createMessage("codex", 22),
        messageId: "orphan-assistant",
        conversationId: "orphan-assistant",
        role: "assistant" as const,
        content: "answer without query"
      },
      {
        ...createMessage("codex", 23),
        messageId: "trailing-user",
        conversationId: "assistant-then-user",
        role: "user" as const,
        content: "query"
      },
      {
        ...createMessage("codex", 24),
        messageId: "middle-assistant",
        conversationId: "assistant-then-user",
        role: "assistant" as const,
        content: "answer"
      },
      {
        ...createMessage("codex", 25),
        messageId: "trailing-tool",
        conversationId: "assistant-then-user",
        role: "tool" as const,
        content: "late tool"
      }
    ];
    const service = createService({
      adapters: [createFakeAdapter("codex", [...invalid, ...valid])]
    });

    const collected = await service.collectOne("codex", { mode: "initial_subset" });

    expectMemoryCount(collected.messages, 1);
    expect(collected.messages.map((message) => message.messageId)).toEqual(
      valid.map((message) => message.messageId)
    );
  });

  it("collects all source messages before ingesting any raw memories", async () => {
    const events: string[] = [];
    const createAdapter = (sourceId: string): SourceAdapter =>
      createFakeAdapter(sourceId, [createMessage(sourceId, 1)], async function* () {
        events.push(`scan:${sourceId}`);
        yield createMessage(sourceId, 1);
      });
    const service = createService({
      adapters: [createAdapter("codex"), createAdapter("custom")],
      ingestionService: {
        async ingest(messages, ctx) {
          events.push(`ingest:${ctx.sourceId}`);
          let attempted = 0;
          for await (const _message of messages) {
            attempted += 1;
          }
          return {
            attempted,
            written: attempted,
            deduped: 0,
            failed: 0,
            writtenMemories: attempted,
            dedupedMemories: 0,
            failedMemories: 0,
            memoryIds: [],
            conversations: 1,
            completedConversationIds: [],
            incompleteConversationIds: [],
            failedConversationIds: [],
            errors: []
          };
        }
      }
    });

    await service.scanAll();

    expect(events).toEqual(["scan:codex", "scan:custom", "ingest:codex", "ingest:custom"]);
  });

  it("reconciles summary progress when another worker finishes the scan memories", async () => {
    const baseMemoryClient = createMockMemoryClient();
    const workerTargets: string[][] = [];
    let enqueueCalls = 0;
    const memoryClient: MemoryClient = {
      ...baseMemoryClient,
      async enqueueImportSummaries() {
        enqueueCalls += 1;
        return {
          enqueued: enqueueCalls === 1 ? 2 : 0,
          memoryIds: ["memory-a", "memory-b"],
          serverTime: "2026-05-28T10:00:00.000Z"
        };
      },
      async getMemoryProcessingStatus(memoryIds) {
        return {
          items: memoryIds.map((memoryId) => ({
            memoryId,
            state: "ready" as const,
            stage: null,
            activeJobId: null,
            attemptCount: 1,
            manualRetryCount: 0,
            retryAction: "retry" as const,
            errorCode: null,
            errorMessage: null,
            failedAt: null,
            updatedAt: "2026-05-28T10:00:00.000Z"
          })),
          serverTime: "2026-05-28T10:00:00.000Z"
        };
      },
      async runWorker(input) {
        workerTargets.push(input.targetMemoryIds ?? []);
        return baseMemoryClient.runWorker(input);
      }
    };
    const service = createService({ memoryClient });
    const progress: Array<{ current: number; total: number }> = [];

    await expect(service.processImportSummaries(["memory-a", "memory-b"], {
      progressSourceId: "codex",
      onProgress(event) {
        if (event.phase === "summarize") {
          progress.push({ current: event.current, total: event.total });
        }
      }
    })).resolves.toEqual([]);

    expect(workerTargets).toEqual([["memory-a", "memory-b"]]);
    expect(progress).toEqual([
      { current: 0, total: 2 },
      { current: 2, total: 2 }
    ]);
  });

  it("finishes an empty owned-memory batch without starting the worker", async () => {
    const baseMemoryClient = createMockMemoryClient();
    const enqueued: string[][] = [];
    let workerCalls = 0;
    const service = createService({
      memoryClient: {
        ...baseMemoryClient,
        async enqueueImportSummaries(memoryIds) {
          enqueued.push([...memoryIds]);
          return { enqueued: 0, memoryIds: [], serverTime: "2026-05-28T10:00:00.000Z" };
        },
        async runWorker(input) {
          workerCalls += 1;
          return baseMemoryClient.runWorker(input);
        }
      }
    });
    const progress: Array<{ current: number; total: number }> = [];

    await expect(service.processImportSummaries([], {
      progressSourceId: "codex",
      onProgress(event) {
        if (event.phase === "summarize") progress.push({ current: event.current, total: event.total });
      }
    })).resolves.toEqual([]);

    expect(enqueued).toEqual([[]]);
    expect(workerCalls).toBe(0);
    expect(progress).toEqual([{ current: 0, total: 0 }]);
  });

  it("treats a terminal processing failure as completed progress and reports its reason", async () => {
    const baseMemoryClient = createMockMemoryClient();
    const service = createService({
      memoryClient: {
        ...baseMemoryClient,
        async getMemoryProcessingStatus() {
          return {
            items: [{
              memoryId: "memory-failed",
              state: "failed" as const,
              stage: "embedding" as const,
              activeJobId: null,
              attemptCount: 6,
              manualRetryCount: 0,
              retryAction: "retry" as const,
              errorCode: "embedding_failed",
              errorMessage: "embedding provider unavailable",
              failedAt: "2026-05-28T10:00:00.000Z",
              updatedAt: "2026-05-28T10:00:00.000Z"
            }],
            serverTime: "2026-05-28T10:00:00.000Z"
          };
        }
      }
    });
    const progress: Array<{ current: number; total: number }> = [];

    await expect(service.processImportSummaries(["memory-failed"], {
      progressSourceId: "codex",
      onProgress(event) {
        if (event.phase === "summarize") progress.push({ current: event.current, total: event.total });
      }
    })).resolves.toEqual([{
      memoryId: "memory-failed",
      reason: "embedding provider unavailable"
    }]);
    expect(progress).toEqual([
      { current: 0, total: 1 },
      { current: 1, total: 1 }
    ]);
  });

  it("checkpoints only completed conversations and does not advance the global cursor on partial failure", async () => {
    const repository = createRepository();
    repository.upsertSource({
      sourceId: "codex",
      displayName: "Codex",
      dataPath: "/tmp/codex",
      builtin: true
    });
    const service = createService({
      repository,
      ingestionService: {
        async ingest() {
          return {
            attempted: 3,
            written: 1,
            deduped: 1,
            failed: 1,
            writtenMemories: 1,
            dedupedMemories: 0,
            failedMemories: 1,
            memoryIds: ["memory-complete"],
            conversations: 3,
            completedConversationIds: ["conversation-complete"],
            incompleteConversationIds: ["conversation-incomplete"],
            failedConversationIds: ["conversation-failed"],
            errors: [{ conversationId: "conversation-failed", reason: "write failed" }]
          };
        }
      }
    });
    const messages = [
      { ...createMessage("codex", 1), conversationId: "conversation-complete", messageId: "complete-1" },
      { ...createMessage("codex", 2), conversationId: "conversation-incomplete", messageId: "incomplete-1" },
      { ...createMessage("codex", 3), conversationId: "conversation-failed", messageId: "failed-1" }
    ];

    const [result] = await service.ingestCollected([{
      sourceId: "codex",
      scanMode: "incremental",
      scanStartedAt: "2026-05-28T09:00:00.000Z",
      conversationIds: messages.map((message) => message.conversationId),
      messages,
      errors: []
    }]);

    expect(result).toMatchObject({
      memoryIds: ["memory-complete"],
      errors: [{ conversationId: "conversation-failed", reason: "write failed" }]
    });
    expect(repository.getConversationCheckpoint("codex", "conversation-complete")).toMatchObject({
      lastMessageId: "complete-1"
    });
    expect(repository.getConversationCheckpoint("codex", "conversation-incomplete")).toBeNull();
    expect(repository.getConversationCheckpoint("codex", "conversation-failed")).toBeNull();
    expect(repository.getScanWatermark("codex")).toBeNull();
  });

  it("rescans a conversation when its content changes without changing the message cursor", async () => {
    const repository = createRepository();
    let messages = createCompleteMemoryMessages("codex", 1, "2026-05-28T10:00:02.000Z");
    const service = createService({
      repository,
      adapters: [createFakeAdapter("codex", [], async function* () {
        for (const message of messages) yield message;
      })]
    });

    await service.scanOne("codex");
    messages = messages.map((message) => message.role === "assistant"
      ? { ...message, content: "revised answer with the same id and timestamp" }
      : message);

    const revised = await service.collectOne("codex");
    expect(revised.messages.map((message) => message.content)).toContain(
      "revised answer with the same id and timestamp"
    );

    await service.ingestCollected([revised]);
    const unchanged = await service.collectOne("codex");
    expect(unchanged.messages).toEqual([]);
  });

  it("groups messages by conversation before handing them to ingestion", async () => {
    const ingestedOrder: string[] = [];
    const repository = createRepository();
    repository.upsertSource({
      sourceId: "codex",
      displayName: "Codex",
      dataPath: "/tmp/codex",
      builtin: true
    });
    const service = createService({
      repository,
      ingestionService: {
        async ingest(messages) {
          let attempted = 0;
          for await (const message of messages) {
            attempted += 1;
            ingestedOrder.push(`${message.conversationId}:${message.messageId}`);
          }
          return {
            attempted,
            written: attempted,
            deduped: 0,
            failed: 0,
            writtenMemories: attempted,
            dedupedMemories: 0,
            failedMemories: 0,
            memoryIds: [],
            conversations: 2,
            completedConversationIds: [],
            incompleteConversationIds: [],
            failedConversationIds: [],
            errors: []
          };
        }
      }
    });

    await service.ingestCollected([
      {
        sourceId: "codex",
        conversationIds: ["b", "a"],
        messages: [
          { ...createMessage("codex", 1), conversationId: "b", messageId: "b-1", createdAt: "2026-05-28T10:00:01.000Z" },
          { ...createMessage("codex", 2), conversationId: "a", messageId: "a-1", createdAt: "2026-05-28T10:00:02.000Z" },
          { ...createMessage("codex", 3), conversationId: "b", messageId: "b-2", createdAt: "2026-05-28T10:00:03.000Z" },
          { ...createMessage("codex", 4), conversationId: "a", messageId: "a-2", createdAt: "2026-05-28T10:00:04.000Z" }
        ],
        errors: []
      }
    ]);

    expect(ingestedOrder).toEqual(["a:a-1", "a:a-2", "b:b-1", "b:b-2"]);
  });

  it("delegates skill install and uninstall then updates source status", async () => {
    const repository = createRepository();
    repository.upsertSource({
      sourceId: "codex",
      displayName: "Codex",
      dataPath: "/tmp/codex",
      builtin: true
    });
    const calls: string[] = [];
    const service = createService({
      repository,
      skillDistributionService: {
        async install(sourceId) {
          calls.push(`install:${sourceId}`);
        },
        async uninstall(sourceId) {
          calls.push(`uninstall:${sourceId}`);
        },
        async installPlugin() {
          return undefined;
        },
        async uninstallPlugin() {
          return undefined;
        }
      }
    });

    await service.installSkill("codex");
    await service.uninstallSkill("codex");

    expect(calls).toEqual(["install:codex", "uninstall:codex"]);
    expect(repository.listSources()[0]?.status).toBe("not_connected");
  });

  it("delegates native plugin install then updates source status", async () => {
    const repository = createRepository();
    repository.upsertSource({
      sourceId: "codex",
      displayName: "Codex",
      dataPath: "/tmp/codex",
      builtin: true
    });
    const calls: string[] = [];
    const service = createService({
      repository,
      adapters: [createFakeAdapter("codex")],
      skillDistributionService: {
        async install(sourceId) {
          calls.push(`install:${sourceId}`);
        },
        async uninstall(sourceId) {
          calls.push(`uninstall:${sourceId}`);
        },
        async installPlugin(sourceId) {
          calls.push(`plugin:${sourceId}`);
        },
        async uninstallPlugin(sourceId) {
          calls.push(`unplugin:${sourceId}`);
        }
      }
    });

    await service.installPlugin("codex");
    await service.uninstallPlugin("codex");

    expect(calls).toEqual(["plugin:codex", "unplugin:codex"]);
    expect(repository.listSources()[0]?.status).toBe("not_connected");
  });

  it("delegates memory plugin conflict detection to the skill distribution service", async () => {
    const service = createService({
      skillDistributionService: {
        async install() {
          return undefined;
        },
        async uninstall() {
          return undefined;
        },
        async installPlugin() {
          return undefined;
        },
        async uninstallPlugin() {
          return undefined;
        },
        async detectMemoryPluginConflicts() {
          return [
            {
              sourceId: "codex",
              displayName: "Codex",
              configPath: "/tmp/codex/config.toml",
              installedPluginId: "memory-core"
            }
          ];
        }
      }
    });

    await expect(service.detectMemoryPluginConflicts()).resolves.toEqual([
      {
        sourceId: "codex",
        displayName: "Codex",
        configPath: "/tmp/codex/config.toml",
        installedPluginId: "memory-core"
      }
    ]);
  });

  it("emits agent source lifecycle and conflict analytics", async () => {
    const repository = createRepository();
    repository.upsertSource({
      sourceId: "codex",
      displayName: "Codex",
      dataPath: "/tmp/codex",
      builtin: true
    });
    const analytics = createAgentSourceAnalyticsRecorder();
    const service = createService({
      repository,
      adapters: [createFakeAdapter("codex", undefined, undefined, undefined, { displayName: "Codex", builtin: true })],
      agentSourceAnalytics: analytics.recorder,
      getScanPermission: async () => "scan_and_write_skill",
      skillDistributionService: {
        async install() {
          return undefined;
        },
        async uninstall() {
          return undefined;
        },
        async installPlugin() {
          return undefined;
        },
        async uninstallPlugin() {
          return undefined;
        },
        async detectMemoryPluginConflicts() {
          return [
            {
              sourceId: "codex",
              displayName: "Codex",
              configPath: "/tmp/codex/config.toml",
              installedPluginId: "memory-core"
            }
          ];
        }
      }
    });

    await service.installPlugin("codex", { installType: "manual" });
    await service.uninstallPlugin("codex", { installType: "manual" });
    await service.detectMemoryPluginConflicts();

    expect(analytics.events.map((event) => event.eventName)).toEqual([
      AGENT_SOURCE_ANALYTICS_EVENTS.pluginInstalled,
      AGENT_SOURCE_ANALYTICS_EVENTS.pluginUninstalled,
      AGENT_SOURCE_ANALYTICS_EVENTS.pluginConflictDetected,
    ]);
    expect(analytics.events[0]?.params).toMatchObject({
      source_id: "codex",
      source_kind: "hook",
      permission: "scan_and_write_skill",
      status_before: "not_connected",
      status_after: "plugin_installed",
      install_type: "manual",
      success: true,
    });
    expect(analytics.events[1]?.params).toMatchObject({
      source_id: "codex",
      status_after: "not_connected",
      success: true,
    });
    expect(analytics.events[2]?.params).toMatchObject({
      source_id: "codex",
      source_kind: "hook",
      permission: "scan_and_write_skill",
      installed_plugin_id: "memory-core",
    });
  });

  it("emits skill install analytics", async () => {
    const repository = createRepository();
    repository.upsertSource({
      sourceId: "claude_code",
      displayName: "Claude Code",
      dataPath: "/tmp/claude-code",
      builtin: true,
      status: "not_connected",
    });
    const analytics = createAgentSourceAnalyticsRecorder();
    const service = createService({
      repository,
      adapters: [createFakeAdapter("claude_code")],
      agentSourceAnalytics: analytics.recorder,
      getScanPermission: async () => "scan_only",
      skillDistributionService: {
        async install() {
          return undefined;
        },
        async uninstall() {
          return undefined;
        },
        async installPlugin() {
          return undefined;
        },
        async uninstallPlugin() {
          return undefined;
        },
      },
    });

    await service.installSkill("claude_code");

    expect(analytics.events).toHaveLength(1);
    expect(analytics.events[0]).toMatchObject({
      eventName: AGENT_SOURCE_ANALYTICS_EVENTS.skillInstalled,
      params: {
        source_id: "claude_code",
        source_kind: "skill",
        permission: "scan_only",
        status_before: "not_connected",
        status_after: "skill_installed",
        success: true,
      },
    });
  });

  it("emits failed plugin install analytics before rethrowing", async () => {
    const repository = createRepository();
    repository.upsertSource({
      sourceId: "codex",
      displayName: "Codex",
      dataPath: "/tmp/codex",
      builtin: true
    });
    const analytics = createAgentSourceAnalyticsRecorder();
    const service = createService({
      repository,
      adapters: [createFakeAdapter("codex", undefined, undefined, undefined, { displayName: "Codex", builtin: true })],
      agentSourceAnalytics: analytics.recorder,
      getScanPermission: async () => "scan_and_write_skill",
      skillDistributionService: {
        async install() {
          return undefined;
        },
        async uninstall() {
          return undefined;
        },
        async installPlugin() {
          throw new Error("install failed");
        },
        async uninstallPlugin() {
          return undefined;
        }
      }
    });

    await expect(service.installPlugin("codex", { installType: "auto_inject" })).rejects.toThrow("install failed");
    expect(analytics.events).toHaveLength(1);
    expect(analytics.events[0]).toMatchObject({
      eventName: AGENT_SOURCE_ANALYTICS_EVENTS.pluginInstalled,
      params: {
        source_id: "codex",
        source_kind: "hook",
        permission: "scan_and_write_skill",
        status_before: "not_connected",
        status_after: "not_connected",
        install_type: "auto_inject",
        success: false,
        error_code: "install failed",
      },
    });
  });
});

function createService(
  options: {
    repository?: AgentSourceRepository;
    adapters?: readonly SourceAdapter[];
    ingestionService?: IngestionService;
    skillDistributionService?: SkillDistributionService;
    memoryClient?: MemoryClient;
    agentSourceAnalytics?: AgentSourceLifecycleAnalytics;
    getScanPermission?: () => Promise<import("@memmy/local-api-contracts").ScanPermission>;
  } = {}
): AgentSourceService {
  return createAgentSourceService({
    sourceRegistry: createSourceRegistry(options.adapters ?? [createFakeAdapter("codex")]),
    agentSourceRepository: options.repository ?? createRepository(),
    ingestionService: options.ingestionService ?? createFakeIngestionService(),
    memoryClient: options.memoryClient ?? createMockMemoryClient(),
    agentSourceAnalytics: options.agentSourceAnalytics,
    getScanPermission: options.getScanPermission,
    skillDistributionService:
      options.skillDistributionService ??
      ({
        async install() {
          return undefined;
        },
        async uninstall() {
          return undefined;
        },
        async installPlugin() {
          return undefined;
        },
        async uninstallPlugin() {
          return undefined;
        }
      } satisfies SkillDistributionService),
    now: () => "2026-05-28T10:00:00.000Z"
  });
}

function createRepository(): AgentSourceRepository {
  db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE cloud_accounts (
      uuid TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE account_agent_sources (
      uuid            TEXT NOT NULL REFERENCES cloud_accounts(uuid) ON DELETE CASCADE,
      source_id       TEXT NOT NULL,
      display_name    TEXT NOT NULL,
      data_path       TEXT NOT NULL,
      builtin         INTEGER NOT NULL CHECK(builtin IN (0,1)),
      status          TEXT NOT NULL DEFAULT 'not_connected',
      last_scanned_at TEXT,
      sync_recipe_json TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (uuid, source_id)
    );
    CREATE TABLE account_ingestion_seen (
      uuid       TEXT NOT NULL REFERENCES cloud_accounts(uuid) ON DELETE CASCADE,
      dedup_key  TEXT NOT NULL,
      source_id  TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (uuid, dedup_key),
      FOREIGN KEY (uuid, source_id) REFERENCES account_agent_sources(uuid, source_id) ON DELETE CASCADE
    );
    CREATE TABLE account_agent_source_watermarks (
      uuid                   TEXT NOT NULL REFERENCES cloud_accounts(uuid) ON DELETE CASCADE,
      source_id              TEXT NOT NULL,
      mode                   TEXT NOT NULL CHECK(mode IN ('initial_subset','incremental','full')),
      baseline_at            TEXT,
      latest_seen_created_at TEXT,
      created_at             TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (uuid, source_id),
      FOREIGN KEY (uuid, source_id) REFERENCES account_agent_sources(uuid, source_id) ON DELETE CASCADE
    );
    CREATE TABLE account_agent_source_conversation_checkpoints (
      uuid            TEXT NOT NULL REFERENCES cloud_accounts(uuid) ON DELETE CASCADE,
      source_id       TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      last_message_id TEXT NOT NULL,
      last_created_at TEXT NOT NULL,
      content_hash    TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (uuid, source_id, conversation_id),
      FOREIGN KEY (uuid, source_id) REFERENCES account_agent_sources(uuid, source_id) ON DELETE CASCADE
    );
    INSERT INTO cloud_accounts (uuid) VALUES ('cloud-account-a');
  `);

  return createAgentSourceRepository(db);
}

function createFakeAdapter(
  sourceId: string,
  messages: readonly ConversationMessage[] = [createMessage(sourceId, 1)],
  scanImpl?: (options: ScanOptions) => AsyncIterable<ConversationMessage>,
  available = true,
  descriptorOverrides?: Partial<SourceDescriptor>
): SourceAdapter {
  const descriptor: SourceDescriptor = {
    sourceId,
    displayName: sourceId === "codex" ? "Codex" : "Custom",
    builtin: sourceId === "codex",
    dataPath: `/tmp/${sourceId}`,
    ...descriptorOverrides
  };

  return {
    descriptor,
    async detect() {
      return available;
    },
    scan(options) {
      return scanImpl ? scanImpl(options) : toAsyncIterable(messages);
    }
  };
}

function createFakeIngestionService(): IngestionService {
  return {
    async ingest(messages) {
      let attempted = 0;
      const conversationIds = new Set<string>();
      for await (const message of messages) {
        attempted += 1;
        conversationIds.add(message.conversationId);
      }

      return {
        attempted,
        written: attempted,
        deduped: 0,
        failed: 0,
        writtenMemories: attempted,
        dedupedMemories: 0,
        failedMemories: 0,
        memoryIds: [],
        conversations: 1,
        completedConversationIds: [...conversationIds],
        incompleteConversationIds: [],
        failedConversationIds: [],
        errors: []
      };
    }
  };
}

async function* toAsyncIterable(messages: readonly ConversationMessage[]): AsyncIterable<ConversationMessage> {
  for (const message of messages) {
    yield message;
  }
}

function createMessage(sourceId: string, index: number): ConversationMessage {
  return {
    messageId: `${sourceId}-msg-${index}`,
    sourceId,
    conversationId: `${sourceId}-conv-1`,
    role: "user",
    content: `message ${index}`,
    createdAt: "2026-05-28T10:00:00.000Z",
    workspacePath: null,
    gitRoot: null,
    rawMeta: Object.freeze({})
  };
}

function createCompleteMemoryMessages(
  sourceId: string,
  count: number,
  newestAt: string,
  options: { includeTool?: boolean } = {}
): ConversationMessage[] {
  const newest = Date.parse(newestAt);
  return Array.from({ length: count }, (_, index) => {
    const turnNumber = index + 1;
    const userAt = newest - index * 10_000;
    const conversationId = `${sourceId}-conv-${turnNumber}`;
    const user: ConversationMessage = {
      ...createMessage(sourceId, turnNumber),
      messageId: `${sourceId}-turn-${turnNumber}-user`,
      conversationId,
      role: "user",
      content: `query ${turnNumber}`,
      createdAt: new Date(userAt).toISOString()
    };
    const tool: ConversationMessage = {
      ...createMessage(sourceId, turnNumber),
      messageId: `${sourceId}-turn-${turnNumber}-tool`,
      conversationId,
      role: "tool",
      content: `tool ${turnNumber}`,
      createdAt: new Date(userAt + 1_000).toISOString()
    };
    const assistant: ConversationMessage = {
      ...createMessage(sourceId, turnNumber),
      messageId: `${sourceId}-turn-${turnNumber}-assistant`,
      conversationId,
      role: "assistant",
      content: `answer ${turnNumber}`,
      createdAt: new Date(userAt + 2_000).toISOString()
    };

    return options.includeTool ? [user, tool, assistant] : [user, assistant];
  }).flat();
}

function createIncompleteUserMessages(sourceId: string, count: number, newestAt: string): ConversationMessage[] {
  const newest = Date.parse(newestAt);
  return Array.from({ length: count }, (_, index) => {
    const turnNumber = index + 1;
    return {
      ...createMessage(sourceId, turnNumber),
      messageId: `${sourceId}-incomplete-${turnNumber}-user`,
      conversationId: `${sourceId}-incomplete-conv-${turnNumber}`,
      role: "user",
      content: `incomplete query ${turnNumber}`,
      createdAt: new Date(newest - index * 10_000).toISOString()
    };
  });
}

function expectMemoryCount(messages: readonly ConversationMessage[] | undefined, expected: number): void {
  expect(messages?.filter((message) => message.role === "user")).toHaveLength(expected);
}

function createAgentSourceAnalyticsRecorder(): {
  recorder: AgentSourceLifecycleAnalytics;
  events: Array<{ eventName: string; params: Record<string, unknown> }>;
} {
  const events: Array<{ eventName: string; params: Record<string, unknown> }> = [];
  return {
    events,
    recorder: {
      trackPluginInstalled(input) {
        events.push({
          eventName: AGENT_SOURCE_ANALYTICS_EVENTS.pluginInstalled,
          params: buildAgentSourcePluginLifecycleParams(input),
        });
      },
      trackPluginUninstalled(input) {
        events.push({
          eventName: AGENT_SOURCE_ANALYTICS_EVENTS.pluginUninstalled,
          params: buildAgentSourcePluginLifecycleParams(input),
        });
      },
      trackSkillInstalled(input) {
        events.push({
          eventName: AGENT_SOURCE_ANALYTICS_EVENTS.skillInstalled,
          params: buildAgentSourceSkillLifecycleParams(input),
        });
      },
      trackSkillUninstalled(input) {
        events.push({
          eventName: AGENT_SOURCE_ANALYTICS_EVENTS.skillUninstalled,
          params: buildAgentSourceSkillLifecycleParams(input),
        });
      },
      trackPluginConflictDetected(input) {
        events.push({
          eventName: AGENT_SOURCE_ANALYTICS_EVENTS.pluginConflictDetected,
          params: buildAgentSourceConflictParams(input),
        });
      },
      async flush() {
        return undefined;
      },
    },
  };
}

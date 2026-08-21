/** Agent sources contracts tests. */
import { describe, expect, it } from "vitest";
import {
  AgentSourceIdParamsSchema,
  AgentSourceScanInputSchema,
  AgentSourceScanJobResponseSchema,
  AgentSourceViewSchema,
  OkResponseSchema,
  ScanCompletedSseEventSchema,
  ScanProgressSseEventSchema,
  ScanResultSchema,
  SseEventSchema
} from "@memmy/local-api-contracts";

describe("agent source contracts", () => {
  it("parses Codex and Claude Code source views and scan results", () => {
    expect(
      AgentSourceViewSchema.parse({
        sourceId: "codex",
        displayName: "Codex",
        dataPath: "/Users/test/.codex/sessions",
        builtin: true,
        available: true,
        status: "skill_installed",
        messageCount: 12,
        lastScannedAt: "2026-05-28T10:00:00.000Z"
      })
    ).toMatchObject({
      sourceId: "codex",
      status: "skill_installed",
      messageCount: 12
    });

    expect(
      ScanResultSchema.parse({
        sourceId: "codex",
        discoveredConversations: 2,
        emittedMessages: 10,
        skipped: 1,
        errors: [{ conversationId: "conv-1", reason: "bad row" }]
      })
    ).toMatchObject({
      emittedMessages: 10,
      skipped: 1
    });

    expect(AgentSourceIdParamsSchema.parse({ sourceId: "codex" })).toEqual({ sourceId: "codex" });
    expect(AgentSourceScanInputSchema.parse(undefined)).toEqual({ sourceId: "all" });
    expect(AgentSourceScanInputSchema.parse({ sourceId: "claude_code" })).toEqual({ sourceId: "claude_code" });
    expect(AgentSourceScanJobResponseSchema.parse({ jobId: "job-1" })).toEqual({ jobId: "job-1" });
    expect(OkResponseSchema.parse({ ok: true })).toEqual({ ok: true });
  });

  it("includes agent source scan progress and completion in the SSE union", () => {
    const progress = ScanProgressSseEventSchema.parse({
      id: "event-1",
      type: "agent_source.scan_progress",
      timestamp: "2026-05-28T10:00:00.000Z",
      payload: {
        jobId: "job-1",
        sourceId: "codex",
        phase: "scan",
        current: 1,
        total: 3,
        message: "reading workspace"
      }
    });

    const completed = ScanCompletedSseEventSchema.parse({
      id: "event-2",
      type: "agent_source.scan_completed",
      timestamp: "2026-05-28T10:00:01.000Z",
      payload: {
        jobId: "job-1",
        sourceId: "codex",
        results: [
          {
            sourceId: "codex",
            discoveredConversations: 1,
            emittedMessages: 2,
            skipped: 0,
            errors: []
          }
        ]
      }
    });

    expect(SseEventSchema.parse(progress).type).toBe("agent_source.scan_progress");
    expect(SseEventSchema.parse(completed).type).toBe("agent_source.scan_completed");
  });
});

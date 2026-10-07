import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_MEMMY_CONFIG, type LlmClient } from "../../../src/index.js";
import { createMemoryServiceFixture } from "../../fixtures/memory-service-fixture.js";

const { cleanup, createTestService } = createMemoryServiceFixture();

afterEach(cleanup);

function capturingLlm(payloads: string[]): LlmClient {
  return {
    config: { ...DEFAULT_MEMMY_CONFIG.summary, provider: "host", endpoint: "http://127.0.0.1/capture", model: "capture" },
    isConfigured: () => true,
    complete: async () => "unused",
    async completeJson<T extends Record<string, unknown>>(
      messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
      options: { operation: string }
    ): Promise<T> {
      const payload = messages.find((message) => message.role === "user")?.content ?? "";
      if (options.operation === "capture.summarize") payloads.push(payload);
      const userQuote = payload.match(/\bUSER:\s*(.*?)\s+ASSISTANT:/)?.[1]?.trim() ?? "";
      return {
        create_l1: true,
        l1_summary: "summary",
        l1_evidence: [{ quote: userQuote, source_role: "user", kind: "task_outcome" }],
        create_user_memory: false,
        user_memory_types: [],
        reason: "durable task result",
        summary: "summary",
        reflection: "reflection",
        alpha: 0.8,
        usable: true,
        tags: []
      } as unknown as T;
    },
    status: () => ({ provider: "host", model: "capture", configured: true, remote: true })
  };
}

describe("MemoryService / evolution / capture summary input", () => {
  it("shows the summarizer how a long reply ended, not only how it began", async () => {
    const payloads: string[] = [];
    const llm = capturingLlm(payloads);
    const { db, service } = createTestService({ llm, skillLlm: llm });
    const session = service.openSession({
      namespace: { source: "codex", profileId: "jiang", userId: "capture-input-user" }
    });
    service.completeTurn("capture-input-turn", {
      sessionId: session.sessionId,
      query: "Deploy the card renderer",
      answer: `${"Reading the plan and running the suite before touching the server. ".repeat(60)}OUTCOME: deployed to /opt/cards on port 38001.`
    });
    service.closeSession(session.sessionId);
    for (let i = 0; i < 6; i += 1) await service.runWorkerOnce(50);

    const payload = payloads.find((entry) => entry.includes("ASSISTANT:"));
    expect(payload).toBeDefined();
    expect(payload).toContain("OUTCOME: deployed to /opt/cards on port 38001.");
    expect(payload).toMatch(/\.\.\.\[\d+ chars omitted\]\.\.\./);
    db.close();
  });
});

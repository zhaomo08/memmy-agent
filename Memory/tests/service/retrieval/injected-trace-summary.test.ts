import { afterEach, describe, expect, it } from "vitest";
import { createMemoryServiceFixture } from "../../fixtures/memory-service-fixture.js";

const { cleanup, createTestService } = createMemoryServiceFixture();

afterEach(cleanup);

describe("MemoryService / retrieval / injected trace", () => {
  it("injects the stored summary rather than a reply cut off before its outcome", async () => {
    const { db, service } = createTestService();
    const namespace = { source: "codex", profileId: "jiang", userId: "trace-summary-user" };
    const session = service.openSession({ namespace });
    const narration = "Checking the staging gateway configuration before changing anything. ".repeat(30);
    const turn = service.completeTurn("trace-summary-turn", {
      sessionId: session.sessionId,
      query: "Rotate the staging gateway certificate",
      answer: `${narration}OUTCOME: certificate rotated and verified on port 8443.`
    });
    // Capture writes the summary with a model; stand in for it here.
    const row = db.db.prepare(`SELECT properties_json FROM memories WHERE id = ?`).get(turn.l1MemoryId) as {
      properties_json: string;
    };
    const properties = JSON.parse(row.properties_json);
    properties.internal_info.summary = "Rotated the staging gateway certificate; verified on port 8443.";
    properties.internal_info.trace.summary = properties.internal_info.summary;
    db.db.prepare(`UPDATE memories SET properties_json = ? WHERE id = ?`)
      .run(JSON.stringify(properties), turn.l1MemoryId);

    const recall = await service.search({
      sessionId: session.sessionId,
      query: "staging gateway certificate",
      layers: ["L1"],
      includeInjectedContext: true
    });

    const markdown = recall.injectedContext.markdown;
    expect(markdown).toContain("Historical user statement:\n   Rotate the staging gateway certificate");
    expect(markdown).toContain("Summary of the assistant's response:\n   Rotated the staging gateway certificate; verified on port 8443.");
    expect(markdown).toContain("memmy_memory_get(id)");
    expect(markdown).not.toContain("Checking the staging gateway configuration");
    expect(markdown).not.toContain("[truncated");
    db.close();
  });

  it("keeps the end of a reply and says how much is missing when there is no summary to use", async () => {
    const { db, service } = createTestService();
    const namespace = { source: "codex", profileId: "jiang", userId: "trace-elide-user" };
    const session = service.openSession({ namespace });
    const turn = service.completeTurn("trace-elide-turn", {
      sessionId: session.sessionId,
      query: "Rotate the staging gateway certificate",
      answer: `${"Checking the staging gateway configuration before changing anything. ".repeat(30)}OUTCOME: rotated.`
    });
    const row = db.db.prepare(`SELECT properties_json FROM memories WHERE id = ?`).get(turn.l1MemoryId) as {
      properties_json: string;
    };
    const properties = JSON.parse(row.properties_json);
    properties.internal_info.summary = "";
    properties.internal_info.trace.summary = "";
    db.db.prepare(`UPDATE memories SET properties_json = ? WHERE id = ?`)
      .run(JSON.stringify(properties), turn.l1MemoryId);

    const recall = await service.search({
      sessionId: session.sessionId,
      query: "staging gateway certificate",
      layers: ["L1"],
      includeInjectedContext: true
    });

    expect(recall.injectedContext.markdown).toMatch(/\.\.\.\[truncated \d+ chars\]\.\.\./);
    expect(recall.injectedContext.markdown).toContain("OUTCOME: rotated.");
    db.close();
  });
});

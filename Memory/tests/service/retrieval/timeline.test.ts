import { afterEach, describe, expect, it } from "vitest";
import { createMemoryServiceFixture } from "../../fixtures/memory-service-fixture.js";

const { cleanup, createTestService } = createMemoryServiceFixture();

afterEach(cleanup);

describe("MemoryService / retrieval / timeline", () => {
  it("returns the traces around one, oldest first, within its own session", () => {
    const { db, service } = createTestService();
    const namespace = { source: "codex", profileId: "jiang", userId: "timeline-user" };
    const session = service.openSession({ namespace });
    const other = service.openSession({ namespace });
    const turns = ["first", "second", "third", "fourth"].map((label, index) =>
      service.completeTurn(`timeline-turn-${index}`, {
        sessionId: session.sessionId,
        query: `${label} question`,
        answer: `${label} answer`
      })
    );
    service.completeTurn("timeline-other-turn", {
      sessionId: other.sessionId,
      query: "unrelated question",
      answer: "unrelated answer"
    });

    const timeline = service.memoryTimeline(turns[2]!.l1MemoryId, { namespace, before: 1, after: 5 });

    expect(timeline.items.map((item) => item.id)).toEqual(turns.slice(1).map((turn) => turn.l1MemoryId));
    expect(timeline.items.filter((item) => item.anchor).map((item) => item.id)).toEqual([turns[2]!.l1MemoryId]);
    db.close();
  });
});

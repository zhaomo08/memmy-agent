import { afterEach, describe, expect, it } from "vitest";
import { createMemoryServiceFixture } from "../../fixtures/memory-service-fixture.js";

const { cleanup, createTestService } = createMemoryServiceFixture();

afterEach(cleanup);

/**
 * Project attribution is only useful if memories can be read back per project, so the
 * filter and the project list are pinned together.
 */
function seedProject(service: ReturnType<typeof createTestService>["service"], label: string, workspacePath: string, queries: string[]) {
  const session = service.openSession({
    sessionId: `session-${label}`,
    source: "claude_code",
    workspacePath,
    namespace: { source: "claude_code", profileId: "default", userId: "user-projects" }
  });
  queries.forEach((query, index) => {
    service.completeTurn(`turn-${label}-${index}`, {
      sessionId: session.sessionId,
      query,
      answer: `answer for ${query}`
    });
  });
  return session;
}

describe("MemoryService / read model / projects", () => {
  it("lists projects with readable labels and memory counts", () => {
    const { service } = createTestService();
    seedProject(service, "alpha", "/tmp/memmy-test-alpha", ["alpha one", "alpha two"]);
    seedProject(service, "beta", "/tmp/memmy-test-beta", ["beta one"]);

    const { projects } = service.panelProjects();
    const labels = projects.map((project) => project.label);

    expect(labels).toContain("memmy-test-alpha");
    expect(labels).toContain("memmy-test-beta");
    const alpha = projects.find((project) => project.label === "memmy-test-alpha");
    expect(alpha?.memoryCount).toBeGreaterThan(0);
    expect(alpha?.projectId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("scopes the panel list to one project", () => {
    const { service } = createTestService();
    seedProject(service, "alpha", "/tmp/memmy-test-alpha", ["alpha one", "alpha two"]);
    seedProject(service, "beta", "/tmp/memmy-test-beta", ["beta one"]);
    const { projects } = service.panelProjects();
    const alpha = projects.find((project) => project.label === "memmy-test-alpha");
    expect(alpha).toBeDefined();

    const scoped = service.panelItems({
      namespace: { source: "claude_code", profileId: "default", userId: "user-projects" },
      projectId: alpha!.projectId
    });
    const unscoped = service.panelItems({
      namespace: { source: "claude_code", profileId: "default", userId: "user-projects" }
    });

    expect(scoped.total).toBeGreaterThan(0);
    expect(scoped.total).toBeLessThan(unscoped.total);
  });

  it("omits projects that hold no memories", () => {
    const { service } = createTestService();
    service.openSession({
      sessionId: "session-empty",
      source: "claude_code",
      workspacePath: "/tmp/memmy-test-empty",
      namespace: { source: "claude_code", profileId: "default", userId: "user-projects" }
    });

    expect(service.panelProjects().projects.map((project) => project.label)).not.toContain("memmy-test-empty");
  });
});

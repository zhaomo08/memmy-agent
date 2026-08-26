import { describe, expect, it } from "vitest";
import { MEMORY_LAYER_PATHS } from "../../../outbound/memory-client/memory-layer-endpoints.js";

/**
 * The renderer never reaches the memory service directly -- every panel call is proxied by
 * the local API. A route can therefore exist in the memory service and still be invisible to
 * the UI, which is exactly how the project filter shipped hidden once: the endpoint answered
 * on :18960, the proxy had no route for it, and the filter's own catch swallowed the 404.
 */
describe("panel projects proxy", () => {
  it("maps the project list to the memory service route", () => {
    expect(MEMORY_LAYER_PATHS.panelProjects).toBe("/api/v1/panel/projects");
  });

  it("is registered on the local API alongside the other panel routes", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../routes/agent-runtime/panel.ts", import.meta.url), "utf8")
    );

    expect(source).toContain('"/api/v1/panel/projects"');
    expect(source).toContain("deps.services.panel.projects(");
  });
});

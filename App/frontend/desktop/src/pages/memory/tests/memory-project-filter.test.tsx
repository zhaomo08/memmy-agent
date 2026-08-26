import { describe, expect, it } from "vitest";
import { buildPanelItemsInput } from "../memories-sub-page.js";

/**
 * The project filter is a browsing control only. Recall stays global by design, so this
 * pins the parameter reaching the list request and nothing else.
 */
describe("memories project filter", () => {
  it("scopes the list request to the selected project", () => {
    expect(buildPanelItemsInput({ projectId: "ceb918761b0536cc" })).toMatchObject({
      projectId: "ceb918761b0536cc"
    });
  });

  it("omits the parameter when no project is selected", () => {
    expect(buildPanelItemsInput({ projectId: "" })).not.toHaveProperty("projectId");
    expect(buildPanelItemsInput({})).not.toHaveProperty("projectId");
  });

  it("combines with the source-agent filter instead of replacing it", () => {
    expect(buildPanelItemsInput({ sourceAgent: "codex", projectId: "abc123" })).toMatchObject({
      sourceAgent: "codex",
      projectId: "abc123"
    });
  });
});

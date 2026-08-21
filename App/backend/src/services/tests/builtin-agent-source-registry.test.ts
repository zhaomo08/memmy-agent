import { describe, expect, it } from "vitest";
import { createBuiltinAgentSourceRegistry } from "../builtin-agent-source-registry.js";

describe("built-in agent source registry", () => {
  it("exposes only Claude Code and Codex", () => {
    const registry = createBuiltinAgentSourceRegistry();

    expect(registry.list().map((adapter) => adapter.descriptor.sourceId)).toEqual([
      "claude_code",
      "codex"
    ]);
    expect(registry.require("claude_code").descriptor.displayName).toBe("Claude Code");
    expect(registry.require("codex").descriptor.displayName).toBe("Codex");
    expect(() => registry.require("legacy-source")).toThrow();
  });
});

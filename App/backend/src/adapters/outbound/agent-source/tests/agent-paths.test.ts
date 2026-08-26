import { afterEach, describe, expect, it } from "vitest";
import {
  resolveClaudeCodeHomeDirectory,
  resolveClaudeCodeProjectsDirectory,
  resolveCodexHomeDirectory,
  resolveCodexSessionsDirectory
} from "../../agent-paths.js";

const ENVIRONMENT_VARIABLES = ["CLAUDE_CONFIG_DIR", "CODEX_HOME"] as const;
const originalEnvironment = new Map(ENVIRONMENT_VARIABLES.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("agent paths", () => {
  it("honors Claude Code and Codex configured home directories", () => {
    process.env.CLAUDE_CONFIG_DIR = "/tmp/claude-home";
    process.env.CODEX_HOME = "/tmp/codex-home";

    expect(resolveClaudeCodeHomeDirectory()).toBe("/tmp/claude-home");
    expect(resolveCodexHomeDirectory()).toBe("/tmp/codex-home");
  });

  it.each([
    {
      platform: "darwin" as const,
      homeDirectory: "/Users/alice",
      claudeCode: "/Users/alice/.claude/projects",
      codex: "/Users/alice/.codex/sessions"
    },
    {
      platform: "win32" as const,
      homeDirectory: "C:\\Users\\alice",
      claudeCode: "C:\\Users\\alice\\.claude\\projects",
      codex: "C:\\Users\\alice\\.codex\\sessions"
    }
  ])("resolves the two supported Agent source paths on $platform", ({ platform, homeDirectory, claudeCode, codex }) => {
    const options = { platform, homeDirectory, environment: {} };
    expect(resolveClaudeCodeProjectsDirectory(options)).toBe(claudeCode);
    expect(resolveCodexSessionsDirectory(options)).toBe(codex);
  });
});

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBuiltinOnboardingInsightSamplers,
  createCodexInsightSampler
} from "../onboarding-insight-samplers.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe("onboarding insight samplers", () => {
  it("keeps only Claude Code and Codex in the first-login scan", () => {
    expect(createBuiltinOnboardingInsightSamplers().map((sampler) => sampler.sourceId)).toEqual([
      "claude_code",
      "codex"
    ]);
  });

  it("skips Codex tool records before JSON.parse during first-login sampling", async () => {
    const root = mkdtempSync(join(tmpdir(), "memmy-codex-onboarding-sampler-"));
    roots.push(root);
    const filePath = join(root, "rollout-2026-06-29T10-00-00-00000000-0000-4000-8000-000000000001.jsonl");
    const toolLine = JSON.stringify({
      type: "response_item",
      timestamp: "2026-06-29T10:00:01.000Z",
      payload: {
        type: "custom_tool_call",
        name: "deep_tool",
        input: {
          sentinel: "deep-tool-sentinel"
        }
      }
    });
    const userLine = JSON.stringify({
      type: "response_item",
      timestamp: "2026-06-29T10:00:02.000Z",
      cwd: "/tmp/project",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "首次登陆扫描要跳过 Codex tool 原始记录。" }]
      }
    });
    writeFileSync(filePath, `${toolLine}\n${userLine}\n`, "utf8");

    const parseJson = JSON.parse.bind(JSON);
    vi.spyOn(JSON, "parse").mockImplementation(((input: string, reviver?: Parameters<typeof JSON.parse>[1]) => {
      if (input.includes("deep-tool-sentinel")) {
        throw new RangeError("Maximum call stack size exceeded");
      }
      return parseJson(input, reviver);
    }) as typeof JSON.parse);

    const result = await createCodexInsightSampler({ root }).sampleRecentUserQueries({
      maxSessionFiles: 10,
      maxQueries: 10,
      maxQueryChars: 500,
      maxBytesPerFile: 64 * 1024,
      deadlineMs: 5_000
    });

    expect(result.errors).toEqual([]);
    expect(result.queries).toHaveLength(1);
    expect(result.queries[0]).toMatchObject({
      sourceId: "codex",
      text: "首次登陆扫描要跳过 Codex tool 原始记录。",
      workspacePath: "/tmp/project"
    });
  });

});

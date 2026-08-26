import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { extractRuleBlock, listRuleBlockIds, removeRuleBlock, upsertRuleBlock } from "../marker-block.js";
import { parseRuleFile, readAgentRules, renderRuleForTarget } from "../rule-source.js";
import { createAgentRuleWriter } from "../rule-writer.js";
import type { AgentInstructionsTarget } from "../types.js";

let workspace: string;
let rulesDirectory: string;
let claudeRoot: string;
let codexRoot: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "memmy-agent-rules-"));
  rulesDirectory = join(workspace, "agent-rules");
  claudeRoot = join(workspace, "claude");
  codexRoot = join(workspace, "codex");
  await mkdir(rulesDirectory, { recursive: true });
  await mkdir(claudeRoot, { recursive: true });
  await mkdir(codexRoot, { recursive: true });
});

function targets(): AgentInstructionsTarget[] {
  return [
    {
      targetId: "claude_code",
      displayName: "Claude Code",
      agentInstructionsFileName: "CLAUDE.md",
      resolveRootDirectory: async () => claudeRoot
    },
    {
      targetId: "codex",
      displayName: "Codex",
      agentInstructionsFileName: "AGENTS.md",
      resolveRootDirectory: async () => codexRoot
    }
  ];
}

async function writeRule(fileName: string, contents: string): Promise<void> {
  await writeFile(join(rulesDirectory, fileName), contents, "utf8");
}

function writer(list = targets()) {
  return createAgentRuleWriter({ targets: list, rulesDirectory });
}

/** Mirrors the writer: an agent file that was never written reads as empty, not as an error. */
async function readOrEmpty(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function readClaude(): Promise<string> {
  return readOrEmpty(join(claudeRoot, "CLAUDE.md"));
}

async function readCodex(): Promise<string> {
  return readOrEmpty(join(codexRoot, "AGENTS.md"));
}

describe("marker block", () => {
  it("pairs each rule with its own terminator so removing one leaves its neighbour intact", () => {
    let document = upsertRuleBlock("", "alpha", "first");
    document = upsertRuleBlock(document, "beta", "second");

    expect(listRuleBlockIds(document)).toEqual(["alpha", "beta"]);

    const afterRemoval = removeRuleBlock(document, "alpha");
    expect(extractRuleBlock(afterRemoval, "alpha")).toBeNull();
    expect(extractRuleBlock(afterRemoval, "beta")).toBe("second");
  });

  it("replaces a block in place rather than appending a second copy", () => {
    const first = upsertRuleBlock("intro\n", "alpha", "one");
    const second = upsertRuleBlock(first, "alpha", "two");

    expect(listRuleBlockIds(second)).toEqual(["alpha"]);
    expect(extractRuleBlock(second, "alpha")).toBe("two");
    expect(second.startsWith("intro\n")).toBe(true);
  });

  it("does not confuse a rule id with one that shares its prefix", () => {
    let document = upsertRuleBlock("", "heim", "short");
    document = upsertRuleBlock(document, "heimdall", "long");

    expect(extractRuleBlock(document, "heim")).toBe("short");
    expect(extractRuleBlock(document, "heimdall")).toBe("long");
  });
});

describe("rule source", () => {
  it("defaults the id to the file name and requires targets", () => {
    const parsed = parseRuleFile("---\ntargets: [claude_code]\n---\nbody text\n", "/rules/heimdall.md");
    expect(parsed).toMatchObject({ id: "heimdall", targets: ["claude_code"], body: "body text" });
  });

  it("reports a file with no frontmatter instead of throwing", () => {
    expect(parseRuleFile("just prose\n", "/rules/bad.md")).toMatchObject({ message: expect.stringContaining("frontmatter") });
  });

  it("rejects an override aimed at a target the rule does not list", () => {
    const parsed = parseRuleFile("---\ntargets: [claude_code]\noverrides:\n  codex: other\n---\nbody\n", "/rules/x.md");
    expect(parsed).toMatchObject({ message: expect.stringContaining("not in targets") });
  });

  it("keeps the other rules when one file is malformed", async () => {
    await writeRule("good.md", "---\ntargets: [claude_code]\n---\nkeep me\n");
    await writeRule("bad.md", "no frontmatter\n");

    const source = await readAgentRules(rulesDirectory);
    expect(source.rules.map((rule) => rule.id)).toEqual(["good"]);
    expect(source.errors).toHaveLength(1);
  });

  it("reports a duplicate id rather than silently taking the last file", async () => {
    await writeRule("a.md", "---\nid: shared\ntargets: [codex]\n---\nfirst\n");
    await writeRule("b.md", "---\nid: shared\ntargets: [codex]\n---\nsecond\n");

    const source = await readAgentRules(rulesDirectory);
    expect(source.rules).toHaveLength(1);
    expect(source.errors[0]?.message).toContain("duplicate rule id");
  });

  it("returns an empty source when the directory does not exist", async () => {
    const source = await readAgentRules(join(workspace, "absent"));
    expect(source).toEqual({ rules: [], errors: [] });
  });

  it("renders the override for the target that has one and the shared body for the rest", () => {
    const rule = parseRuleFile("---\ntargets: [claude_code, codex]\noverrides:\n  codex: codex body\n---\nshared body\n", "/rules/r.md");
    if ("message" in rule) {
      throw new Error(rule.message);
    }

    expect(renderRuleForTarget(rule, "claude_code")).toBe("shared body");
    expect(renderRuleForTarget(rule, "codex")).toBe("codex body");
    expect(renderRuleForTarget(rule, "other")).toBeNull();
  });
});

describe("rule writer", () => {
  it("writes a rule into every target it lists and no others", async () => {
    await writeRule("only-claude.md", "---\ntargets: [claude_code]\n---\nclaude only\n");
    await writer().apply();

    expect(extractRuleBlock(await readClaude(), "only-claude")).toBe("claude only");
    expect(extractRuleBlock(await readCodex(), "only-claude")).toBeNull();
    // A target with nothing to write must not get an empty instructions file conjured for it.
    expect(await readCodex()).toBe("");
  });

  it("gives each target its own rendering when an override is present", async () => {
    await writeRule("heimdall.md", "---\ntargets: [claude_code, codex]\noverrides:\n  codex: use the heimdall CLI\n---\nuse mcp__heimdall__kb_search\n");
    await writer().apply();

    expect(extractRuleBlock(await readClaude(), "heimdall")).toBe("use mcp__heimdall__kb_search");
    expect(extractRuleBlock(await readCodex(), "heimdall")).toBe("use the heimdall CLI");
  });

  it("leaves hand-written content outside its blocks byte for byte", async () => {
    const handWritten = "# My rules\n\nkeep this exactly\n\n<!-- memmy:start v=1 -->\nsomeone else's block\n<!-- memmy:end v=1 -->\n";
    await writeFile(join(claudeRoot, "CLAUDE.md"), handWritten, "utf8");
    await writeRule("added.md", "---\ntargets: [claude_code]\n---\nnew rule\n");

    await writer().apply();

    const after = await readClaude();
    expect(after.startsWith(handWritten.trimEnd())).toBe(true);
    expect(after).toContain("<!-- memmy:start v=1 -->\nsomeone else's block\n<!-- memmy:end v=1 -->");
    expect(extractRuleBlock(after, "added")).toBe("new rule");
  });

  it("is idempotent -- a second apply rewrites nothing", async () => {
    await writeRule("a.md", "---\ntargets: [claude_code, codex]\n---\nbody\n");
    await writer().apply();
    const afterFirst = await readClaude();

    const second = await writer().apply();
    expect(second.written).toHaveLength(0);
    expect(await readClaude()).toBe(afterFirst);
  });

  it("updates a block when the source body changes", async () => {
    await writeRule("a.md", "---\ntargets: [claude_code]\n---\nold\n");
    await writer().apply();
    await writeRule("a.md", "---\ntargets: [claude_code]\n---\nnew\n");

    const result = await writer().apply();
    expect(result.written).toHaveLength(1);
    expect(extractRuleBlock(await readClaude(), "a")).toBe("new");
    expect(listRuleBlockIds(await readClaude())).toEqual(["a"]);
  });

  it("removes a block once its rule stops targeting that agent", async () => {
    await writeRule("a.md", "---\ntargets: [claude_code, codex]\n---\nbody\n");
    await writer().apply();
    expect(extractRuleBlock(await readCodex(), "a")).toBe("body");

    await writeRule("a.md", "---\ntargets: [claude_code]\n---\nbody\n");
    const result = await writer().apply();

    expect(result.removed.map((removed) => removed.targetId)).toEqual(["codex"]);
    expect(extractRuleBlock(await readCodex(), "a")).toBeNull();
    expect(extractRuleBlock(await readClaude(), "a")).toBe("body");
  });

  it("reports drift without changing anything", async () => {
    await writeRule("a.md", "---\ntargets: [claude_code, codex]\n---\nbody\n");
    await writer().apply();

    await writeFile(join(codexRoot, "AGENTS.md"), upsertRuleBlock(await readCodex(), "a", "edited by hand"), "utf8");
    const before = await readCodex();

    const status = await writer().status();
    expect(status.entries).toContainEqual(expect.objectContaining({ ruleId: "a", targetId: "codex", state: "stale" }));
    expect(status.entries).toContainEqual(expect.objectContaining({ ruleId: "a", targetId: "claude_code", state: "in_sync" }));
    expect(await readCodex()).toBe(before);
  });

  it("reports a missing block for a target whose file was never written", async () => {
    await writeRule("a.md", "---\ntargets: [claude_code]\n---\nbody\n");

    const status = await writer().status();
    expect(status.entries).toEqual([expect.objectContaining({ ruleId: "a", targetId: "claude_code", state: "missing" })]);
  });

  it("skips a target whose root directory is absent and says so", async () => {
    const list: AgentInstructionsTarget[] = [
      ...targets(),
      { targetId: "ghost", displayName: "Ghost", agentInstructionsFileName: "GHOST.md", resolveRootDirectory: async () => null }
    ];
    await writeRule("a.md", "---\ntargets: [claude_code, ghost]\n---\nbody\n");

    const result = await writer(list).apply();
    expect(result.unavailableTargetIds).toEqual(["ghost"]);
    expect(extractRuleBlock(await readClaude(), "a")).toBe("body");
  });

  it("surfaces a malformed rule file through apply without blocking the good ones", async () => {
    await writeRule("good.md", "---\ntargets: [claude_code]\n---\napplied\n");
    await writeRule("bad.md", "---\ntargets: nope\n---\nbody\n");

    const result = await writer().apply();
    expect(result.errors).toHaveLength(1);
    expect(extractRuleBlock(await readClaude(), "good")).toBe("applied");
  });
});

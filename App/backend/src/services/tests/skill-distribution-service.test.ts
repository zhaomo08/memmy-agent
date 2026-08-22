/** Skill distribution service tests. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSkillTargetRegistry } from "../../adapters/outbound/skill-writer/target-registry.js";
import type { MemoryPluginConflict, SkillManifest, SkillTarget } from "../../adapters/outbound/skill-writer/types.js";
import { createSkillDistributionService } from "../skill-distribution-service.js";

describe("skill distribution service", () => {
  it("scans other Agent skills as source-attributed immutable versions", async () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), "memmy-agent-skills-"));
    try {
      mkdirSync(join(rootDirectory, "skills", "review-code"), { recursive: true });
      mkdirSync(join(rootDirectory, "skills", "memmy-memory"), { recursive: true });
      writeFileSync(
        join(rootDirectory, "skills", "review-code", "SKILL.md"),
        "---\nname: review-code\nversion: 2\n---\nReview changed code.\n",
        "utf8"
      );
      writeFileSync(join(rootDirectory, "skills", "memmy-memory", "SKILL.md"), "internal", "utf8");
      const service = createSkillDistributionService({
        targetRegistry: createSkillTargetRegistry([
          createFakeTarget({ resolveRootDirectory: () => rootDirectory })
        ])
      });

      await expect(service.listSkills?.("claude_code")).resolves.toEqual([
        expect.objectContaining({
          sourceAgentId: "claude_code",
          sourceSkillId: "review-code",
          sourceSkillVersion: "2",
          title: "review-code",
          content: expect.stringContaining("Review changed code."),
          sourceContentHash: expect.stringMatching(/^[a-f0-9]{64}$/)
        })
      ]);
    } finally {
      rmSync(rootDirectory, { recursive: true, force: true });
    }
  });

  it("renders and installs the fixed Memmy skill manifest", async () => {
    let installed: SkillManifest | undefined;
    const service = createSkillDistributionService({
      targetRegistry: createSkillTargetRegistry([createFakeTarget({ install: (manifest) => (installed = manifest) })])
    });

    await service.install("claude_code");

    expect(installed).toMatchObject({
      targetId: "claude_code",
      marker: "<!-- memmy:start v=1 -->"
    });
    expect(installed?.content).toContain("# Memmy Memory CLI Skill");
    expect(installed?.content).toContain("memmy-memory turn start");
    expect(installed?.content).toContain("memmy-memory turn complete");
    expect(installed?.content).toContain('memmy-memory search "query text"');
    expect(installed?.content).toContain("memmy-memory session open --source claude_code");
    expect(installed?.content).toContain("memmy-memory turn start --source claude_code");
    expect(installed?.content).toContain('memmy-memory turn complete "$TURN_ID" --source claude_code');
    expect(installed?.content).toContain('memmy-memory search "query text" --source claude_code');
    expect(installed?.content).toContain('memmy-memory add "The user prefers concise Chinese status updates." --title "User preference: status style" --tags user-preference --source claude_code');
    expect(installed?.content).not.toContain("--layer");
    expect(installed?.content).not.toContain("/panel/");
    expect(installed?.content).not.toContain("Panel Debugging");
  });

  it("rejects skill install when the target root directory is unavailable", async () => {
    let installCalled = false;
    const service = createSkillDistributionService({
      targetRegistry: createSkillTargetRegistry([
        createFakeTarget({
          resolveRootDirectory: () => null,
          install: () => {
            installCalled = true;
          }
        })
      ])
    });

    await expect(service.install("claude_code")).rejects.toMatchObject({
      code: "agent_source_unavailable",
      message: "Claude Code is not installed or its directory is unavailable"
    });
    expect(installCalled).toBe(false);
  });

  it("delegates uninstall to the target registry", async () => {
    const calls: string[] = [];
    const service = createSkillDistributionService({
      targetRegistry: createSkillTargetRegistry([createFakeTarget({ uninstall: (targetId) => calls.push(targetId) })])
    });

    await service.uninstall("claude_code");

    expect(calls).toEqual(["claude_code"]);
  });

  it("delegates native plugin installation to plugin-capable targets", async () => {
    const calls: string[] = [];
    const service = createSkillDistributionService({
      targetRegistry: createSkillTargetRegistry([
        createFakeTarget({
          installPlugin: (targetId) => calls.push(`plugin:${targetId}`),
          install: (manifest) => calls.push(`skill:${manifest.targetId}`)
        })
      ])
    });

    await service.installPlugin("claude_code");

    expect(calls).toEqual(["plugin:claude_code"]);
  });

  it("rejects native plugin install when the target root directory is unavailable", async () => {
    let installPluginCalled = false;
    const service = createSkillDistributionService({
      targetRegistry: createSkillTargetRegistry([
        createFakeTarget({
          resolveRootDirectory: () => null,
          installPlugin: () => {
            installPluginCalled = true;
          }
        })
      ])
    });

    await expect(service.installPlugin("claude_code")).rejects.toMatchObject({
      code: "agent_source_unavailable",
      message: "Claude Code is not installed or its directory is unavailable"
    });
    expect(installPluginCalled).toBe(false);
  });

  it("uninstalls native plugin and Skill when the target supports plugins", async () => {
    const calls: string[] = [];
    const service = createSkillDistributionService({
      targetRegistry: createSkillTargetRegistry([
        createFakeTarget({
          uninstallPlugin: (targetId) => calls.push(`plugin:${targetId}`),
          uninstall: (targetId) => calls.push(`skill:${targetId}`)
        })
      ])
    });

    await service.uninstallPlugin("claude_code");

    expect(calls).toEqual(["plugin:claude_code", "skill:claude_code"]);
  });

  it("rejects native plugin install for targets without plugin support", async () => {
    const service = createSkillDistributionService({
      targetRegistry: createSkillTargetRegistry([createFakeTarget({})])
    });

    await expect(service.installPlugin("claude_code")).rejects.toThrow("Native plugin installation is not supported");
  });

  it("rejects native plugin uninstall for targets without plugin support", async () => {
    const service = createSkillDistributionService({
      targetRegistry: createSkillTargetRegistry([createFakeTarget({})])
    });

    await expect(service.uninstallPlugin("claude_code")).rejects.toThrow("Native plugin uninstallation is not supported");
  });

  it("collects memory plugin conflicts from plugin-aware targets", async () => {
    const service = createSkillDistributionService({
      targetRegistry: createSkillTargetRegistry([
        createFakeTarget({
          detectMemoryPluginConflict: () => ({
            sourceId: "claude_code",
            displayName: "Claude Code",
            configPath: "/tmp/cursor/config.json",
            installedPluginId: "other-memory"
          })
        })
      ])
    });

    await expect(service.detectMemoryPluginConflicts?.()).resolves.toEqual([
      {
        sourceId: "claude_code",
        displayName: "Claude Code",
        configPath: "/tmp/cursor/config.json",
        installedPluginId: "other-memory"
      }
    ]);
  });
});

function createFakeTarget(overrides: {
  resolveRootDirectory?: () => string | null;
  install?: (manifest: SkillManifest) => void;
  uninstall?: (targetId: string) => void;
  installPlugin?: (targetId: string) => void;
  uninstallPlugin?: (targetId: string) => void;
  detectMemoryPluginConflict?: () => MemoryPluginConflict | null;
}): SkillTarget {
  return {
    targetId: "claude_code",
    displayName: "Claude Code",
    async resolveRootDirectory() {
      return "resolveRootDirectory" in overrides ? overrides.resolveRootDirectory?.() ?? null : "/tmp/cursor/rules";
    },
    async install(manifest) {
      overrides.install?.(manifest);
    },
    async uninstall(targetId) {
      overrides.uninstall?.(targetId);
    },
    async isInstalled() {
      return false;
    },
    installPlugin: overrides.installPlugin
      ? async (targetId) => {
          overrides.installPlugin?.(targetId);
        }
      : undefined,
    uninstallPlugin: overrides.uninstallPlugin
      ? async (targetId) => {
          overrides.uninstallPlugin?.(targetId);
        }
      : undefined,
    detectMemoryPluginConflict: overrides.detectMemoryPluginConflict
      ? async () => overrides.detectMemoryPluginConflict?.() ?? null
      : undefined
  };
}

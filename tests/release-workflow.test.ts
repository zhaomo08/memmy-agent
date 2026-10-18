import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

const workflowPath = resolve(import.meta.dirname, "../.github/workflows/release-macos.yml");
const repoRoot = resolve(import.meta.dirname, "..");
const source = readFileSync(workflowPath, "utf8");
const workflow = YAML.parse(source);
const releaseJob = workflow.jobs.release;
const packageJob = workflow.jobs.package;
const stepRun = (job: { steps: Array<Record<string, unknown>> }, name: string) =>
  String(job.steps.find((step) => step.name === name)?.run ?? "");
const packagingConfigs = [
  "electron-builder.yml",
  "electron-builder.unsigned.yml",
  "electron-builder.win.yml",
  "electron-builder.win.unsigned.yml",
];
const versionedManifests = [
  "Memory/package.json",
  "Memory/src/cli/npm/package.json",
  "App/memmy-agent/package.json",
  "App/shell/desktop/package.json",
];

function readJson(relativePath: string): {
  version?: string;
  packages?: Record<string, { version?: string }>;
} {
  return JSON.parse(readFileSync(resolve(repoRoot, relativePath), "utf8"));
}

describe("GitHub release workflow", () => {
  it("keeps every release manifest and lockfile aligned to the root version", () => {
    const version = readJson("package.json").version;

    for (const manifest of versionedManifests) {
      expect(readJson(manifest).version, manifest).toBe(version);
    }

    const rootLock = readJson("package-lock.json");
    expect(rootLock.version).toBe(version);
    expect(rootLock.packages?.[""].version).toBe(version);
    expect(rootLock.packages?.Memory.version).toBe(version);
    expect(rootLock.packages?.["App/shell/desktop"].version).toBe(version);

    const agentLock = readJson("App/memmy-agent/package-lock.json");
    expect(agentLock.version).toBe(version);
    expect(agentLock.packages?.[""].version).toBe(version);
  });

  it("publishes only from fork tags and builds the fork itself", () => {
    expect(workflow.on.push.tags).toEqual(["v*-fork.*"]);
    expect(stepRun(packageJob, "Check tag matches package.json")).toContain("-fork");
    expect(stepRun(packageJob, "Package unsigned DMG")).toContain("npm run package:mac:unsigned");
    expect(source).not.toContain("memtensor-cdn");
  });

  it("refuses to ship a stale or out-of-scope bundle", () => {
    const verify = stepRun(packageJob, "Verify bundle completeness");
    expect(verify).toContain("bundled skills do not match source");
    expect(verify).toMatch(/openclaw\|hermes.*composio/);
  });

  it("grants write access only to the release job, after packaging", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(releaseJob.permissions).toEqual({ contents: "write" });
    expect(releaseJob.needs).toBe("package");
    expect(releaseJob.if).toBe("github.ref_type == 'tag'");
    expect(stepRun(releaseJob, "Publish release")).toContain("SHA256SUMS.txt");
  });

  it("allows versioned manual release notes to be tracked", () => {
    const result = spawnSync(
      "git",
      ["check-ignore", "--quiet", "--no-index", ".github/release-notes/v1.2.3.md"],
      { cwd: repoRoot },
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
  });

  it("embeds the safe example environment required by packaged desktop runtimes", () => {
    for (const config of packagingConfigs) {
      const packagingSource = readFileSync(
        resolve(import.meta.dirname, `../App/shell/desktop/${config}`),
        "utf8",
      );
      expect(packagingSource).toMatch(/from:\s+\.\.\/\.\.\/\.\.\/\.env\.example(?:\s|$)/);
      expect(packagingSource).toMatch(/to:\s+\.env(?:\s|$)/);
    }
  });
});

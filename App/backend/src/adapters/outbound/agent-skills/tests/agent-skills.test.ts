import { lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { parseSkillManifest, renderSkillManifest } from "../manifest.js";
import { createSkillReconciler } from "../reconciler.js";
import type { SkillMountTarget } from "../types.js";

let workspace: string;
let libraryPath: string;
let manifestPath: string;
let claudeRoot: string;
let codexRoot: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "memmy-agent-skills-"));
  libraryPath = join(workspace, "library");
  manifestPath = join(workspace, "skill-manifest.yaml");
  claudeRoot = join(workspace, "claude");
  codexRoot = join(workspace, "codex");
  await mkdir(join(claudeRoot, "skills"), { recursive: true });
  await mkdir(join(codexRoot, "skills"), { recursive: true });
  await mkdir(libraryPath, { recursive: true });
});

function targets(): SkillMountTarget[] {
  return [
    { targetId: "claude_code", displayName: "Claude Code", resolveRootDirectory: async () => claudeRoot },
    { targetId: "codex", displayName: "Codex", resolveRootDirectory: async () => codexRoot }
  ];
}

function reconciler(list = targets()) {
  return createSkillReconciler({ targets: list, manifestPath, libraryPath });
}

async function addLibrarySkill(name: string): Promise<void> {
  await mkdir(join(libraryPath, name), { recursive: true });
  await writeFile(join(libraryPath, name, "SKILL.md"), `# ${name}\n`, "utf8");
}

async function mount(root: string, name: string): Promise<void> {
  await symlink(join(libraryPath, name), join(root, "skills", name));
}

async function writeManifest(body: string): Promise<void> {
  await writeFile(manifestPath, body, "utf8");
}

describe("manifest", () => {
  it("accepts a bare list of targets as shorthand for mount", () => {
    const document = parseSkillManifest("skills:\n  alpha: [claude_code, codex]\n");
    expect(document.declarations).toEqual([{ name: "alpha", mount: ["claude_code", "codex"] }]);
  });

  it("keeps the reason beside the skill it explains", () => {
    const document = parseSkillManifest("skills:\n  pdf:\n    mount: [codex]\n    why: Claude has a plugin for this\n");
    expect(document.declarations[0]).toEqual({ name: "pdf", mount: ["codex"], why: "Claude has a plugin for this" });
  });

  it("treats a skill with no mount list as deliberately mounted nowhere", () => {
    const document = parseSkillManifest("skills:\n  ghost:\n    why: machine-local\n");
    expect(document.declarations[0]).toEqual({ name: "ghost", mount: [], why: "machine-local" });
  });

  it("round-trips through render and parse", () => {
    const original = { libraryPath: "/tmp/lib", declarations: [{ name: "b", mount: ["codex"], why: "reason" }, { name: "a", mount: [] }] };
    const document = parseSkillManifest(renderSkillManifest(original));
    expect(document.libraryPath).toBe("/tmp/lib");
    expect(document.declarations).toEqual([{ name: "a", mount: [] }, { name: "b", mount: ["codex"], why: "reason" }]);
  });

  it("rejects a malformed mount list rather than guessing", () => {
    expect(() => parseSkillManifest("skills:\n  alpha:\n    mount: claude_code\n")).toThrow(/must be a list/);
  });
});

describe("status", () => {
  it("reads every skill as undeclared while no manifest exists", async () => {
    await addLibrarySkill("alpha");
    await mount(claudeRoot, "alpha");

    const status = await reconciler().status();
    expect(status.manifestMissing).toBe(true);
    expect(status.findings).toEqual([expect.objectContaining({ kind: "undeclared", name: "alpha" })]);
  });

  it("reports an undeclared skill once, not once per agent", async () => {
    await addLibrarySkill("alpha");
    await mount(claudeRoot, "alpha");
    await mount(codexRoot, "alpha");

    const status = await reconciler().status();
    expect(status.findings.filter((entry) => entry.name === "alpha")).toHaveLength(1);
  });

  it("says nothing when disk matches the manifest", async () => {
    await addLibrarySkill("alpha");
    await mount(claudeRoot, "alpha");
    await mount(codexRoot, "alpha");
    await writeManifest("skills:\n  alpha: [claude_code, codex]\n");

    expect((await reconciler().status()).findings).toEqual([]);
  });

  it("distinguishes a deliberate skip from a missing mount", async () => {
    await addLibrarySkill("pdf");
    await mount(codexRoot, "pdf");
    await writeManifest("skills:\n  pdf:\n    mount: [codex]\n    why: Claude has a plugin\n");

    // pdf is absent from Claude on purpose, so it must not be reported at all.
    expect((await reconciler().status()).findings).toEqual([]);
  });

  it("reports a declared skill that is not linked", async () => {
    await addLibrarySkill("alpha");
    await writeManifest("skills:\n  alpha: [claude_code, codex]\n");

    const findings = (await reconciler().status()).findings;
    expect(findings).toHaveLength(2);
    expect(findings.every((entry) => entry.kind === "not_mounted")).toBe(true);
  });

  it("reports a link the manifest does not declare", async () => {
    await addLibrarySkill("alpha");
    await mount(claudeRoot, "alpha");
    await writeManifest("skills:\n  alpha:\n    mount: []\n    why: retired\n");

    const findings = (await reconciler().status()).findings;
    expect(findings).toEqual([expect.objectContaining({ kind: "unexpected", detail: expect.stringContaining("retired") })]);
  });

  it("calls a real directory in the way blocked rather than trying to replace it", async () => {
    await addLibrarySkill("alpha");
    await mkdir(join(claudeRoot, "skills", "alpha"), { recursive: true });
    await writeFile(join(claudeRoot, "skills", "alpha", "SKILL.md"), "local copy\n", "utf8");
    await writeManifest("skills:\n  alpha: [claude_code]\n");

    expect((await reconciler().status()).findings).toEqual([
      expect.objectContaining({ kind: "blocked", detail: expect.stringContaining("real directory") })
    ]);
  });

  it("separates a link pointing outside the library from one pointing into it", async () => {
    const elsewhere = join(workspace, "elsewhere");
    await mkdir(elsewhere, { recursive: true });
    await addLibrarySkill("alpha");
    await symlink(elsewhere, join(codexRoot, "skills", "alpha"));
    await writeManifest("skills:\n  alpha: [codex]\n");

    const findings = (await reconciler().status()).findings;
    expect(findings).toEqual([expect.objectContaining({ kind: "blocked", detail: expect.stringContaining("foreign") })]);
  });

  it("marks a link whose destination is gone as broken", async () => {
    await addLibrarySkill("alpha");
    await symlink(join(workspace, "vanished"), join(codexRoot, "skills", "alpha"));
    await writeManifest("skills:\n  alpha: [codex]\n");

    const observation = (await reconciler().status()).observations.find(
      (entry) => entry.name === "alpha" && entry.targetId === "codex"
    );
    expect(observation?.state).toBe("broken");
  });

  it("names a target whose root is absent instead of failing", async () => {
    const list: SkillMountTarget[] = [...targets(), { targetId: "ghost", displayName: "Ghost", resolveRootDirectory: async () => null }];
    const status = await reconciler(list).status();
    expect(status.unavailableTargetIds).toEqual(["ghost"]);
  });
});

describe("reconcile", () => {
  it("creates the links the manifest declares", async () => {
    await addLibrarySkill("alpha");
    await writeManifest("skills:\n  alpha: [claude_code, codex]\n");

    const result = await reconciler().reconcile();
    expect(result.mounted).toHaveLength(2);
    expect((await lstat(join(claudeRoot, "skills", "alpha"))).isSymbolicLink()).toBe(true);
    expect(await readFile(join(codexRoot, "skills", "alpha", "SKILL.md"), "utf8")).toBe("# alpha\n");
  });

  it("links relatively so the pair survives a moved home directory", async () => {
    await addLibrarySkill("alpha");
    await writeManifest("skills:\n  alpha: [claude_code]\n");
    await reconciler().reconcile();

    expect(await readlink(join(claudeRoot, "skills", "alpha"))).not.toMatch(/^\//);
  });

  it("removes a link the manifest does not declare, leaving the library copy alone", async () => {
    await addLibrarySkill("alpha");
    await mount(claudeRoot, "alpha");
    await writeManifest("skills:\n  alpha:\n    mount: []\n");

    const result = await reconciler().reconcile();
    expect(result.unmounted).toHaveLength(1);
    await expect(lstat(join(claudeRoot, "skills", "alpha"))).rejects.toThrow();
    expect(await readFile(join(libraryPath, "alpha", "SKILL.md"), "utf8")).toBe("# alpha\n");
  });

  it("never deletes a real directory, reporting it instead", async () => {
    await addLibrarySkill("alpha");
    await mkdir(join(claudeRoot, "skills", "alpha"), { recursive: true });
    await writeFile(join(claudeRoot, "skills", "alpha", "SKILL.md"), "local copy\n", "utf8");
    await writeManifest("skills:\n  alpha: [claude_code]\n");

    const result = await reconciler().reconcile();
    expect(result.mounted).toHaveLength(0);
    expect(result.skipped).toEqual([expect.objectContaining({ kind: "blocked" })]);
    expect(await readFile(join(claudeRoot, "skills", "alpha", "SKILL.md"), "utf8")).toBe("local copy\n");
  });

  it("leaves an undeclared skill untouched -- the decision is the user's", async () => {
    await addLibrarySkill("alpha");
    await mount(claudeRoot, "alpha");
    await writeManifest("skills: {}\n");

    const result = await reconciler().reconcile();
    expect(result.mounted).toHaveLength(0);
    expect(result.unmounted).toHaveLength(0);
    expect(result.skipped).toEqual([expect.objectContaining({ kind: "undeclared" })]);
    expect((await lstat(join(claudeRoot, "skills", "alpha"))).isSymbolicLink()).toBe(true);
  });

  it("is idempotent", async () => {
    await addLibrarySkill("alpha");
    await writeManifest("skills:\n  alpha: [claude_code, codex]\n");
    await reconciler().reconcile();

    const second = await reconciler().reconcile();
    expect(second.mounted).toHaveLength(0);
    expect(second.unmounted).toHaveLength(0);
  });
});

describe("freeze", () => {
  it("turns the current layout into a manifest that then reports no drift", async () => {
    await addLibrarySkill("alpha");
    await addLibrarySkill("pdf");
    await mount(claudeRoot, "alpha");
    await mount(codexRoot, "alpha");
    await mount(codexRoot, "pdf");

    const frozen = await reconciler().freeze();
    expect(frozen.declarations).toBe(2);

    const status = await reconciler().status();
    expect(status.manifestMissing).toBe(false);
    expect(status.findings).toEqual([]);
  });

  it("records the asymmetry rather than flattening it", async () => {
    await addLibrarySkill("pdf");
    await mount(codexRoot, "pdf");
    await reconciler().freeze();

    const document = parseSkillManifest(await readFile(manifestPath, "utf8"));
    expect(document.declarations).toEqual([{ name: "pdf", mount: ["codex"] }]);
  });

  it("leaves a comment telling the reader to record why a skill is skipped", async () => {
    await addLibrarySkill("alpha");
    await reconciler().freeze();

    expect(await readFile(manifestPath, "utf8")).toContain("a decision from an oversight");
  });

  it("drift appears as soon as the layout moves away from the frozen manifest", async () => {
    await addLibrarySkill("alpha");
    await mount(claudeRoot, "alpha");
    await reconciler().freeze();
    expect((await reconciler().status()).findings).toEqual([]);

    await rm(join(claudeRoot, "skills", "alpha"), { force: true });
    expect((await reconciler().status()).findings).toEqual([expect.objectContaining({ kind: "not_mounted" })]);
  });
});

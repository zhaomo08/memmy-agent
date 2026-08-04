import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderMemmyDefaultSkillManifest } from "../../templates/memmy-default.js";
import { createChatwiseSkillTarget } from "../index.js";

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe("chatwise skill target", () => {
  it("installs the complete Memmy skill into the shared Agent Skills root", async () => {
    const rootDirectory = createRoot();
    const target = createChatwiseSkillTarget({ rootDirectory });
    await target.install(renderMemmyDefaultSkillManifest("chatwise"));

    const content = readFileSync(join(rootDirectory, "skills", "memmy-memory", "SKILL.md"), "utf8");
    expect(content).toContain("## Agent Loop");
    expect(content).toContain("--source chatwise");
    await expect(target.isInstalled("chatwise")).resolves.toBe(true);
  });

  it("removes only ChatWise's Memmy skill", async () => {
    const rootDirectory = createRoot();
    writeFileSync(join(rootDirectory, "README.md"), "keep", "utf8");
    const target = createChatwiseSkillTarget({ rootDirectory });
    await target.install(renderMemmyDefaultSkillManifest("chatwise"));
    await target.uninstall("chatwise");

    expect(existsSync(join(rootDirectory, "skills", "memmy-memory"))).toBe(false);
    expect(readFileSync(join(rootDirectory, "README.md"), "utf8")).toBe("keep");
  });
});

function createRoot(): string {
  tempDir = mkdtempSync(join(tmpdir(), "memmy-chatwise-skill-"));
  const rootDirectory = join(tempDir, ".agents");
  mkdirSync(rootDirectory, { recursive: true });
  return rootDirectory;
}

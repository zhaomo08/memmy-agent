import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { resolveChatwiseAgentHomeDirectory } from "../../agent-paths.js";
import { removeMemmySkillDirectory, replaceMemmySkillDirectory } from "../skill-directory.js";
import type { SkillTarget } from "../types.js";

const CHATWISE_TARGET_ID = "chatwise";

export interface CreateChatwiseSkillTargetDeps {
  rootDirectory?: string;
}

export function createChatwiseSkillTarget(deps: CreateChatwiseSkillTargetDeps = {}): SkillTarget {
  const rootDirectory = deps.rootDirectory ?? resolveChatwiseAgentHomeDirectory();
  return {
    targetId: CHATWISE_TARGET_ID,
    displayName: "ChatWise",

    async resolveRootDirectory() {
      try {
        return (await stat(rootDirectory)).isDirectory() ? rootDirectory : null;
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") return null;
        throw error;
      }
    },

    async install(manifest) {
      const root = await this.resolveRootDirectory();
      if (!root) throw new Error("ChatWise Agent skill root is unavailable");
      await replaceMemmySkillDirectory(root, manifest);
    },

    async uninstall() {
      const root = await this.resolveRootDirectory();
      if (root) await removeMemmySkillDirectory(root);
    },

    async isInstalled() {
      const root = await this.resolveRootDirectory();
      if (!root) return false;
      try {
        const content = await readFile(join(root, "skills", "memmy-memory", "SKILL.md"), "utf8");
        return content.includes("name: memmy-memory") && content.includes("--source chatwise");
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") return false;
        throw error;
      }
    }
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

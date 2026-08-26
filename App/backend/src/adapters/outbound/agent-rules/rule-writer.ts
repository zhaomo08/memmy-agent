/** Rule writer module. */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { extractRuleBlock, listRuleBlockIds, removeRuleBlock, upsertRuleBlock } from "./marker-block.js";
import { readAgentRules, renderRuleForTarget, resolveAgentRulesDirectory } from "./rule-source.js";
import type {
  AgentInstructionsTarget,
  AgentRuleApplyResult,
  AgentRuleSource,
  AgentRuleStatus,
  AgentRuleStatusEntry
} from "./types.js";

/** Contract for the agent rule writer. */
export interface AgentRuleWriter {
  /** Reads the source and reports how each rule stands in each target, changing nothing. */
  status(): Promise<AgentRuleStatus>;
  /** Writes every rule into its targets and removes blocks the source no longer defines. */
  apply(): Promise<AgentRuleApplyResult>;
}

/** Dependencies for {@link createAgentRuleWriter}. */
export interface CreateAgentRuleWriterDeps {
  targets: readonly AgentInstructionsTarget[];
  rulesDirectory?: string;
}

/** Creates the writer that keeps every agent's instructions file in step with the rule source. */
export function createAgentRuleWriter(deps: CreateAgentRuleWriterDeps): AgentRuleWriter {
  const rulesDirectory = deps.rulesDirectory ?? resolveAgentRulesDirectory();

  async function resolveTargetFiles(): Promise<{ files: TargetFile[]; unavailableTargetIds: string[] }> {
    const files: TargetFile[] = [];
    const unavailableTargetIds: string[] = [];

    for (const target of deps.targets) {
      const root = await target.resolveRootDirectory();
      if (!root) {
        unavailableTargetIds.push(target.targetId);
        continue;
      }

      files.push({ target, filePath: join(root, target.agentInstructionsFileName) });
    }

    return { files, unavailableTargetIds };
  }

  return Object.freeze({
    async status() {
      const source = await readAgentRules(rulesDirectory);
      const { files, unavailableTargetIds } = await resolveTargetFiles();
      const entries: AgentRuleStatusEntry[] = [];

      for (const file of files) {
        const document = await readTextFile(file.filePath);
        entries.push(...describeFile(source, file, document));
      }

      return { entries, errors: source.errors, unavailableTargetIds };
    },

    async apply() {
      const source = await readAgentRules(rulesDirectory);
      const { files, unavailableTargetIds } = await resolveTargetFiles();
      const written: AgentRuleStatusEntry[] = [];
      const removed: AgentRuleStatusEntry[] = [];

      for (const file of files) {
        const original = await readTextFile(file.filePath);
        let next = original;

        for (const rule of source.rules) {
          const body = renderRuleForTarget(rule, file.target.targetId);
          if (body === null) {
            // The rule does not target this agent. A block left from when it did is an orphan,
            // handled by the sweep below, so nothing to do here.
            continue;
          }

          if (extractRuleBlock(next, rule.id) !== body) {
            next = upsertRuleBlock(next, rule.id, body);
            written.push(entry(rule.id, file, "in_sync"));
          }
        }

        for (const ruleId of listRuleBlockIds(next)) {
          const rule = source.rules.find((candidate) => candidate.id === ruleId);
          if (rule && renderRuleForTarget(rule, file.target.targetId) !== null) {
            continue;
          }

          next = removeRuleBlock(next, ruleId);
          removed.push(entry(ruleId, file, "orphaned"));
        }

        if (next !== original) {
          await writeFileAtomically(file.filePath, next);
        }
      }

      return { written, removed, errors: source.errors, unavailableTargetIds };
    }
  });
}

interface TargetFile {
  target: AgentInstructionsTarget;
  filePath: string;
}

function describeFile(source: AgentRuleSource, file: TargetFile, document: string): AgentRuleStatusEntry[] {
  const entries: AgentRuleStatusEntry[] = [];

  for (const rule of source.rules) {
    const body = renderRuleForTarget(rule, file.target.targetId);
    if (body === null) {
      continue;
    }

    const present = extractRuleBlock(document, rule.id);
    entries.push(entry(rule.id, file, present === null ? "missing" : present === body ? "in_sync" : "stale"));
  }

  for (const ruleId of listRuleBlockIds(document)) {
    const rule = source.rules.find((candidate) => candidate.id === ruleId);
    if (rule && renderRuleForTarget(rule, file.target.targetId) !== null) {
      continue;
    }

    entries.push(entry(ruleId, file, "orphaned"));
  }

  return entries;
}

function entry(ruleId: string, file: TargetFile, state: AgentRuleStatusEntry["state"]): AgentRuleStatusEntry {
  return {
    ruleId,
    targetId: file.target.targetId,
    targetDisplayName: file.target.displayName,
    filePath: file.filePath,
    state
  };
}

async function readTextFile(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT") {
      return "";
    }

    throw error;
  }
}

async function writeFileAtomically(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = join(dirname(filePath), `.${basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, filePath);
}

/**
 * Narrows a skill target list to those that declare an instructions file. A target
 * without one (a test double, or an agent Memmy only scans) is simply not a place
 * rules can be written, so it is dropped rather than treated as an error.
 */
export function agentInstructionsTargetsFrom(
  targets: readonly { targetId: string; displayName: string; agentInstructionsFileName?: string; resolveRootDirectory(): Promise<string | null> }[]
): AgentInstructionsTarget[] {
  return targets.filter((target): target is AgentInstructionsTarget => typeof target.agentInstructionsFileName === "string" && target.agentInstructionsFileName.length > 0);
}

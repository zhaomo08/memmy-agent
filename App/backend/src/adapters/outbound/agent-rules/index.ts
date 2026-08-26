/** Agent rules module. */
export { agentInstructionsTargetsFrom, createAgentRuleWriter } from "./rule-writer.js";
export type { AgentRuleWriter, CreateAgentRuleWriterDeps } from "./rule-writer.js";
export { parseRuleFile, readAgentRules, renderRuleForTarget, resolveAgentRulesDirectory } from "./rule-source.js";
export { extractRuleBlock, listRuleBlockIds, renderRuleBlock, ruleEndMarker, ruleStartMarker } from "./marker-block.js";
export type {
  AgentInstructionsTarget,
  AgentRule,
  AgentRuleApplyResult,
  AgentRuleBlockState,
  AgentRuleSource,
  AgentRuleSourceError,
  AgentRuleStatus,
  AgentRuleStatusEntry
} from "./types.js";

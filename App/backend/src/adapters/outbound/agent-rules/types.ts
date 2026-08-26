/** Types module. */

/** A rule authored once and rendered into every agent's instructions file. */
export interface AgentRule {
  /** Stable identifier; becomes part of the marker, so renaming replaces the block. */
  id: string;
  /** Targets this rule applies to, by skill target id. */
  targets: readonly string[];
  /** Body written for every target that has no override. */
  body: string;
  /** Per-target replacement bodies, keyed by target id. */
  overrides: Readonly<Record<string, string>>;
  /** Absolute path the rule was read from, for error reporting. */
  sourcePath: string;
}

/** A rule file that could not be parsed. Surfaced instead of thrown so one bad file cannot block the rest. */
export interface AgentRuleSourceError {
  sourcePath: string;
  message: string;
}

/** Result of reading the rule directory. */
export interface AgentRuleSource {
  rules: readonly AgentRule[];
  errors: readonly AgentRuleSourceError[];
}

/** How a single rule stands in a single target's instructions file. */
export type AgentRuleBlockState =
  /** Block is present and matches what the source renders. */
  | "in_sync"
  /** Block is present but its content differs from the source. */
  | "stale"
  /** Rule targets this agent but no block is present. */
  | "missing"
  /** A block is present for a rule the source no longer defines. */
  | "orphaned";

/** Per-rule, per-target status row. */
export interface AgentRuleStatusEntry {
  ruleId: string;
  targetId: string;
  targetDisplayName: string;
  filePath: string | null;
  state: AgentRuleBlockState;
}

/** Full status across every rule and target. */
export interface AgentRuleStatus {
  entries: readonly AgentRuleStatusEntry[];
  errors: readonly AgentRuleSourceError[];
  /** Targets that are configured but whose root directory is not present on disk. */
  unavailableTargetIds: readonly string[];
}

/** What one apply() run changed. */
export interface AgentRuleApplyResult {
  written: readonly AgentRuleStatusEntry[];
  removed: readonly AgentRuleStatusEntry[];
  errors: readonly AgentRuleSourceError[];
  unavailableTargetIds: readonly string[];
}

/** The slice of a skill target the rule writer needs. */
export interface AgentInstructionsTarget {
  readonly targetId: string;
  readonly displayName: string;
  /** File the agent reads its standing instructions from, e.g. CLAUDE.md. */
  readonly agentInstructionsFileName: string;
  resolveRootDirectory(): Promise<string | null>;
}

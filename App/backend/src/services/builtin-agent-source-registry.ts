import { createClaudeCodeSourceAdapter } from "../adapters/outbound/agent-source/claude-code/index.js";
import { createCodexSourceAdapter } from "../adapters/outbound/agent-source/codex/index.js";
import { createSourceRegistry, type SourceRegistry } from "../adapters/outbound/agent-source/source-registry.js";

export function createBuiltinAgentSourceRegistry(): SourceRegistry {
  return createSourceRegistry([
    createClaudeCodeSourceAdapter(),
    createCodexSourceAdapter()
  ]);
}

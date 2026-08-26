import claudeCodeLogoUrl from "../assets/agent-logos/claude-code.svg";
import codexLogoUrl from "../assets/agent-logos/codex.svg";
import memmyRiceLogoUrl from "../assets/mascot/memmy-rice.png";

export const MEMORY_AGENT_SOURCE_VALUES = [
  "memmy-agent",
  "claude_code",
  "codex"
] as const;

const AGENT_SOURCE_DISPLAY_NAMES: Record<string, string> = {
  memmy: "Memmy",
  memmy_agent: "Memmy",
  claude_code: "Claude Code",
  codex: "Codex"
};

export const AGENT_SOURCE_LOGOS: Partial<Record<string, string>> = {
  claude_code: claudeCodeLogoUrl,
  codex: codexLogoUrl,
  memmy: memmyRiceLogoUrl,
  memmy_agent: memmyRiceLogoUrl
};

export function normalizeAgentSourceId(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/gu, "_");
}

export function agentSourceDisplayName(value: string): string {
  return AGENT_SOURCE_DISPLAY_NAMES[normalizeAgentSourceId(value)] ?? value.trim();
}

export function agentSourceLogoUrl(value: string): string | undefined {
  return AGENT_SOURCE_LOGOS[normalizeAgentSourceId(value)];
}

export function isMemmyAgentSource(value: string): boolean {
  const sourceId = normalizeAgentSourceId(value);
  return sourceId === "memmy" || sourceId === "memmy_agent";
}

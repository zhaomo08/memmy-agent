export const DIRECT_PROMPT_TERMINAL_SCRIPT = [
  "on run argv",
  "  set binaryPath to item 1 of argv",
  "  set relayPrompt to item 2 of argv",
  "  set launchCommand to \"exec \" & quoted form of binaryPath & \" \" & quoted form of relayPrompt",
  "  tell application \"Terminal\"",
  "    activate",
  "    do script launchCommand",
  "  end tell",
  "end run"
].join("\n");

export const CLAUDE_CODE_TERMINAL_SCRIPT = DIRECT_PROMPT_TERMINAL_SCRIPT;

export function claudeCodeBinaryCandidates(homeDirectory: string): string[] {
  return [`${homeDirectory}/.local/bin/claude`, `${homeDirectory}/.claude/local/claude`, "/opt/homebrew/bin/claude", "/usr/local/bin/claude"];
}

export function codexBinaryCandidates(homeDirectory: string): string[] {
  return [`${homeDirectory}/.local/bin/codex`, `${homeDirectory}/.codex/bin/codex`, "/Applications/ChatGPT.app/Contents/Resources/codex", "/opt/homebrew/bin/codex", "/usr/local/bin/codex"];
}

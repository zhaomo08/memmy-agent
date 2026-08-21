import { homedir } from "node:os";
import { isAbsolute, join, normalize, posix, resolve, win32 } from "node:path";

type AgentPathApi = Pick<typeof posix, "isAbsolute" | "join" | "normalize" | "resolve">;

interface AgentPathRuntime {
  environment: NodeJS.ProcessEnv;
  homeDirectory: string;
  pathApi: AgentPathApi;
}

export interface ResolveAgentPathOptions {
  platform?: NodeJS.Platform;
  homeDirectory?: string;
  environment?: NodeJS.ProcessEnv;
}

export function resolveClaudeCodeHomeDirectory(options: ResolveAgentPathOptions = {}): string {
  const runtime = createAgentPathRuntime(options);
  return resolveConfiguredDirectory(
    runtime.environment.CLAUDE_CONFIG_DIR,
    runtime.pathApi.join(runtime.homeDirectory, ".claude"),
    runtime
  );
}

export function resolveClaudeCodeProjectsDirectory(options: ResolveAgentPathOptions = {}): string {
  return createAgentPathRuntime(options).pathApi.join(resolveClaudeCodeHomeDirectory(options), "projects");
}

export function resolveCodexHomeDirectory(options: ResolveAgentPathOptions = {}): string {
  const runtime = createAgentPathRuntime(options);
  return resolveConfiguredDirectory(
    runtime.environment.CODEX_HOME,
    runtime.pathApi.join(runtime.homeDirectory, ".codex"),
    runtime
  );
}

export function resolveCodexSessionsDirectory(options: ResolveAgentPathOptions = {}): string {
  return createAgentPathRuntime(options).pathApi.join(resolveCodexHomeDirectory(options), "sessions");
}

export function resolveAgentPath(value: string): string {
  return resolveAgentPathWithRuntime(value, {
    environment: process.env,
    homeDirectory: homedir(),
    pathApi: { isAbsolute, join, normalize, resolve }
  });
}

function createAgentPathRuntime(options: ResolveAgentPathOptions = {}): AgentPathRuntime {
  const platform = options.platform ?? process.platform;
  return {
    environment: options.environment ?? process.env,
    homeDirectory: options.homeDirectory ?? homedir(),
    pathApi: platform === "win32" ? win32 : posix
  };
}

function resolveConfiguredDirectory(
  value: string | undefined,
  fallback: string,
  runtime: AgentPathRuntime
): string {
  return value?.trim() ? resolveAgentPathWithRuntime(value.trim(), runtime) : fallback;
}

function resolveAgentPathWithRuntime(value: string, runtime: AgentPathRuntime): string {
  const expanded = value === "~"
    ? runtime.homeDirectory
    : value.startsWith("~/") || value.startsWith("~\\")
      ? runtime.pathApi.join(runtime.homeDirectory, value.slice(2))
      : value;
  return runtime.pathApi.isAbsolute(expanded)
    ? runtime.pathApi.normalize(expanded)
    : runtime.pathApi.resolve(expanded);
}

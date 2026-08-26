/** Types module. */

/** Contract for skill manifest. */
export interface SkillManifest {
  targetId: string;
  content: string;
  marker: string;
}

/** Contract for memory plugin conflict. */
export interface MemoryPluginConflict {
  sourceId: string;
  displayName: string;
  configPath: string;
  installedPluginId: string;
}

/** Contract for skill target. */
export interface SkillTarget {
  readonly targetId: string;
  readonly displayName: string;
  /** File this agent reads its standing instructions from, e.g. CLAUDE.md. Optional so test doubles need not supply it. */
  readonly agentInstructionsFileName?: string;
  resolveRootDirectory(): Promise<string | null>;
  install(manifest: SkillManifest): Promise<void>;
  uninstall(targetId: string): Promise<void>;
  isInstalled(targetId: string): Promise<boolean>;
  installPlugin?(targetId: string): Promise<void>;
  uninstallPlugin?(targetId: string): Promise<void>;
  detectMemoryPluginConflict?(): Promise<MemoryPluginConflict | null>;
}

/** Types module. */

/** What a skill entry in the manifest declares. */
export interface SkillDeclaration {
  /** Skill directory name, shared across the library and every target. */
  name: string;
  /** Targets where this skill should be a symlink into the shared library. */
  mount: readonly string[];
  /** Why the skill is skipped where it is skipped. Free text, for the human reading the ledger. */
  why?: string;
}

/** The declared intent for the whole skill set. */
export interface SkillManifestDocument {
  /** Absolute path of the shared skill library. */
  libraryPath: string;
  declarations: readonly SkillDeclaration[];
}

/** What is actually on disk at `<target root>/skills/<name>`. */
export type SkillDiskState =
  /** A symlink resolving to the shared library's copy. The intended shape. */
  | "linked"
  /** Nothing at that path. */
  | "absent"
  /** A real directory rather than a link -- content that lives only here. */
  | "local"
  /** A symlink pointing somewhere other than the shared library. */
  | "foreign"
  /** A symlink whose destination does not exist. */
  | "broken";

/** One observed (skill, target) pair. */
export interface SkillObservation {
  name: string;
  targetId: string;
  targetDisplayName: string;
  path: string;
  state: SkillDiskState;
  /** Where a foreign or broken symlink points. */
  linkTarget?: string;
}

/** A difference between what the manifest declares and what is on disk. */
export type SkillFindingKind =
  /** Declared for this target, nothing on disk. Fixable by creating the symlink. */
  | "not_mounted"
  /** Not declared for this target, but a library symlink is present. Fixable by removing it. */
  | "unexpected"
  /** Declared, but a real directory or foreign link occupies the path. Needs a human. */
  | "blocked"
  /** Present in the library or at a target, absent from the manifest. Intent is unrecorded. */
  | "undeclared";

/** One reported difference. */
export interface SkillFinding {
  kind: SkillFindingKind;
  name: string;
  targetId: string | null;
  targetDisplayName: string | null;
  path: string | null;
  detail: string;
}

/** Everything the reconciler knows, having changed nothing. */
export interface SkillStatus {
  libraryPath: string;
  manifestPath: string;
  /** True when no manifest file exists yet, so every skill reads as undeclared. */
  manifestMissing: boolean;
  observations: readonly SkillObservation[];
  findings: readonly SkillFinding[];
  unavailableTargetIds: readonly string[];
}

/** What one reconcile run changed. */
export interface SkillReconcileResult {
  mounted: readonly SkillFinding[];
  unmounted: readonly SkillFinding[];
  /** Findings that need a person: blocked paths and undeclared skills. */
  skipped: readonly SkillFinding[];
  unavailableTargetIds: readonly string[];
}

/** The slice of a skill target the reconciler needs. */
export interface SkillMountTarget {
  readonly targetId: string;
  readonly displayName: string;
  resolveRootDirectory(): Promise<string | null>;
}

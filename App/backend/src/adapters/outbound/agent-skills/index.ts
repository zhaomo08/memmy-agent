/** Agent skills module. */
export { createSkillReconciler } from "./reconciler.js";
export type { CreateSkillReconcilerDeps, SkillReconciler } from "./reconciler.js";
export {
  parseSkillManifest,
  readSkillManifest,
  renderSkillManifest,
  resolveDefaultLibraryPath,
  resolveSkillManifestPath
} from "./manifest.js";
export type {
  SkillDeclaration,
  SkillDiskState,
  SkillFinding,
  SkillFindingKind,
  SkillManifestDocument,
  SkillMountTarget,
  SkillObservation,
  SkillReconcileResult,
  SkillStatus
} from "./types.js";

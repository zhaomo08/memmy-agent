/** Reconciler module. */
import { lstat, mkdir, readdir, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import {
  readSkillManifest,
  renderSkillManifest,
  resolveDefaultLibraryPath,
  resolveSkillManifestPath
} from "./manifest.js";
import type {
  SkillDeclaration,
  SkillFinding,
  SkillMountTarget,
  SkillObservation,
  SkillReconcileResult,
  SkillStatus
} from "./types.js";

/** Contract for the skill reconciler. */
export interface SkillReconciler {
  /** Reads the manifest and the disk, reporting every difference. Changes nothing. */
  status(): Promise<SkillStatus>;
  /** Creates declared-but-absent links and removes undeclared library links. Never touches real directories. */
  reconcile(): Promise<SkillReconcileResult>;
  /** Writes a manifest describing the current disk layout, so drift can be measured from here on. */
  freeze(): Promise<{ manifestPath: string; declarations: number }>;
}

/** Dependencies for {@link createSkillReconciler}. */
export interface CreateSkillReconcilerDeps {
  targets: readonly SkillMountTarget[];
  manifestPath?: string;
  /**
   * Skills the app installs into the same directory itself. The ledger records what the
   * user mounts by hand; a skill the app owns is not theirs to declare, and reporting it
   * as undeclared is noise they can never clear.
   */
  managedNames?: readonly string[];
  /** Overrides the library path the manifest would otherwise supply. Tests use this. */
  libraryPath?: string;
}

/** Creates the reconciler that measures the shared skill library against each agent's skills directory. */
export function createSkillReconciler(deps: CreateSkillReconcilerDeps): SkillReconciler {
  const manifestPath = deps.manifestPath ?? resolveSkillManifestPath();
  const managedNames = new Set(deps.managedNames ?? []);

  async function load(): Promise<{
    libraryPath: string;
    declarations: SkillDeclaration[];
    manifestMissing: boolean;
  }> {
    const document = await readSkillManifest(manifestPath);
    return {
      libraryPath: deps.libraryPath ?? document?.libraryPath ?? resolveDefaultLibraryPath(),
      declarations: [...(document?.declarations ?? [])],
      manifestMissing: document === null
    };
  }

  async function observe(libraryPath: string): Promise<{
    observations: SkillObservation[];
    unavailableTargetIds: string[];
    libraryNames: string[];
  }> {
    const libraryNames = await listDirectories(libraryPath);
    const observations: SkillObservation[] = [];
    const unavailableTargetIds: string[] = [];

    for (const target of deps.targets) {
      const root = await target.resolveRootDirectory();
      if (!root) {
        unavailableTargetIds.push(target.targetId);
        continue;
      }

      const skillsDirectory = join(root, "skills");
      const names = new Set([...libraryNames, ...(await listEntries(skillsDirectory))]);
      for (const name of [...names].sort()) {
        observations.push(await observeOne(target, skillsDirectory, libraryPath, name));
      }
    }

    return { observations, unavailableTargetIds, libraryNames };
  }

  return Object.freeze({
    async status() {
      const { libraryPath, declarations, manifestMissing } = await load();
      const { observations, unavailableTargetIds, libraryNames } = await observe(libraryPath);
      return {
        libraryPath,
        manifestPath,
        managedNames: [...managedNames],
        manifestMissing,
        observations,
        findings: compare(declarations, observations, libraryNames, managedNames),
        unavailableTargetIds
      };
    },

    async reconcile() {
      const { libraryPath, declarations } = await load();
      const { observations, unavailableTargetIds, libraryNames } = await observe(libraryPath);
      const findings = compare(declarations, observations, libraryNames, managedNames);
      const mounted: SkillFinding[] = [];
      const unmounted: SkillFinding[] = [];
      const skipped: SkillFinding[] = [];

      for (const finding of findings) {
        if (finding.kind === "not_mounted" && finding.path) {
          await mkdir(dirname(finding.path), { recursive: true });
          await symlink(relative(dirname(finding.path), join(libraryPath, finding.name)), finding.path);
          mounted.push(finding);
          continue;
        }

        if (finding.kind === "unexpected" && finding.path) {
          // Only ever a symlink into the library, so the skill itself survives in the library.
          await rm(finding.path, { force: true });
          unmounted.push(finding);
          continue;
        }

        skipped.push(finding);
      }

      return { mounted, unmounted, skipped, unavailableTargetIds };
    },

    async freeze() {
      const { libraryPath, declarations: existing } = await load();
      // why is the whole reason the ledger beats a directory listing, and it is the one
      // part only a person can write. Re-freezing re-reads the layout, never the prose.
      const reasons = new Map(existing.filter((entry) => entry.why).map((entry) => [entry.name, entry.why]));
      const { observations, libraryNames } = await observe(libraryPath);
      const mounts = new Map<string, string[]>();
      for (const name of libraryNames) {
        if (!managedNames.has(name)) {
          mounts.set(name, []);
        }
      }

      for (const observation of observations) {
        if (observation.state === "absent" || observation.state === "broken" || managedNames.has(observation.name)) {
          continue;
        }

        // A skill only present at one agent is still a decision worth recording, as
        // mount: [] -- otherwise it reads as undeclared forever and the ledger never settles.
        const current = mounts.get(observation.name) ?? [];
        mounts.set(observation.name, observation.state === "linked" ? [...current, observation.targetId] : current);
      }

      const declarations = [...mounts.entries()].map(([name, mount]) => {
        const why = reasons.get(name);
        return why ? { name, mount, why } : { name, mount };
      });
      await mkdir(dirname(manifestPath), { recursive: true });
      await writeFile(manifestPath, renderSkillManifest({ libraryPath, declarations }), "utf8");
      return { manifestPath, declarations: declarations.length };
    }
  });
}

async function observeOne(
  target: SkillMountTarget,
  skillsDirectory: string,
  libraryPath: string,
  name: string
): Promise<SkillObservation> {
  const path = join(skillsDirectory, name);
  const base = { name, targetId: target.targetId, targetDisplayName: target.displayName, path };

  let entry: Awaited<ReturnType<typeof lstat>>;
  try {
    entry = await lstat(path);
  } catch (error) {
    if (isMissing(error)) {
      return { ...base, state: "absent" };
    }

    throw error;
  }

  if (!entry.isSymbolicLink()) {
    return { ...base, state: "local" };
  }

  const linkTarget = await readlink(path);
  const resolved = resolve(dirname(path), linkTarget);
  const expected = join(libraryPath, name);

  if (await sameRealPath(resolved, expected)) {
    return { ...base, state: "linked", linkTarget };
  }

  return { ...base, state: (await pathExists(resolved)) ? "foreign" : "broken", linkTarget };
}

function compare(
  declarations: readonly SkillDeclaration[],
  observations: readonly SkillObservation[],
  libraryNames: readonly string[],
  managedNames: ReadonlySet<string>
): SkillFinding[] {
  const declared = new Map(declarations.map((declaration) => [declaration.name, declaration]));
  const findings: SkillFinding[] = [];
  const undeclaredReported = new Set<string>();

  for (const observation of observations) {
    // A dead link is dead whatever the manifest says. Reporting it only when a
    // declaration happens to cover it is how these two sat unnoticed for months.
    if (observation.state === "broken") {
      findings.push(finding("blocked", observation, `dead symlink to ${observation.linkTarget ?? "an unknown path"}`));
      continue;
    }

    // The app puts this one there and takes it away again. Whatever the manifest says about
    // it is not a difference worth acting on -- the app is the source of truth, not the ledger.
    if (managedNames.has(observation.name)) {
      continue;
    }

    const declaration = declared.get(observation.name);
    if (!declaration) {
      // Only report an undeclared skill once, not once per target -- the decision is per skill.
      if (!undeclaredReported.has(observation.name) && (observation.state !== "absent" || libraryNames.includes(observation.name))) {
        undeclaredReported.add(observation.name);
        findings.push({
          kind: "undeclared",
          name: observation.name,
          targetId: null,
          targetDisplayName: null,
          path: null,
          detail: libraryNames.includes(observation.name)
            ? "in the shared library but absent from the manifest"
            : `present at ${observation.targetDisplayName} but absent from both the library and the manifest`
        });
      }

      continue;
    }

    const shouldMount = declaration.mount.includes(observation.targetId);

    if (shouldMount && observation.state === "absent") {
      findings.push(finding("not_mounted", observation, "declared for this agent but not linked"));
      continue;
    }

    if (shouldMount && (observation.state === "local" || observation.state === "foreign")) {
      findings.push(
        finding("blocked", observation, `declared for this agent but the path holds a ${describeState(observation)}`)
      );
      continue;
    }

    if (!shouldMount && observation.state === "linked") {
      findings.push(
        finding("unexpected", observation, declaration.why ? `not declared for this agent (${declaration.why})` : "not declared for this agent")
      );
    }
  }

  return findings;
}

function finding(kind: SkillFinding["kind"], observation: SkillObservation, detail: string): SkillFinding {
  return {
    kind,
    name: observation.name,
    targetId: observation.targetId,
    targetDisplayName: observation.targetDisplayName,
    path: observation.path,
    detail
  };
}

function describeState(observation: SkillObservation): string {
  return observation.state === "local" ? "real directory" : `foreign symlink to ${observation.linkTarget ?? "an unknown path"}`;
}

async function listDirectories(directory: string): Promise<string[]> {
  const entries = await listEntries(directory);
  const names: string[] = [];
  for (const name of entries) {
    const stats = await lstat(join(directory, name)).catch(() => null);
    if (stats?.isDirectory() || stats?.isSymbolicLink()) {
      names.push(name);
    }
  }

  return names;
}

async function listEntries(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory);
    return entries.filter((name) => !name.startsWith(".")).sort();
  } catch (error) {
    if (isMissing(error)) {
      return [];
    }

    throw error;
  }
}

async function sameRealPath(left: string, right: string): Promise<boolean> {
  const [leftReal, rightReal] = await Promise.all([realpath(left).catch(() => null), realpath(right).catch(() => null)]);
  return leftReal !== null && leftReal === rightReal;
}

async function pathExists(path: string): Promise<boolean> {
  return (await realpath(path).catch(() => null)) !== null;
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}

/** Manifest module. */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import YAML from "yaml";

import type { SkillDeclaration, SkillManifestDocument } from "./types.js";

/** Default ledger recording which skills belong to which agent, and why. */
export function resolveSkillManifestPath(): string {
  return join(homedir(), ".memmy", "skill-manifest.yaml");
}

/** Default shared library every mounted skill links back to. */
export function resolveDefaultLibraryPath(): string {
  return join(homedir(), ".agents", "skills");
}

/** Reads the manifest. A missing file is not an error -- it means nothing is declared yet. */
export async function readSkillManifest(manifestPath = resolveSkillManifestPath()): Promise<SkillManifestDocument | null> {
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (isMissing(error)) {
      return null;
    }

    throw error;
  }

  return parseSkillManifest(raw);
}

/** Parses manifest text. Throws on malformed input, which is a configuration error worth surfacing loudly. */
export function parseSkillManifest(raw: string): SkillManifestDocument {
  const parsed = YAML.parse(raw) as unknown;
  if (parsed === null || parsed === undefined) {
    return { libraryPath: resolveDefaultLibraryPath(), declarations: [] };
  }

  if (!isRecord(parsed)) {
    throw new Error("skill manifest must be a mapping");
  }

  const libraryPath = readLibraryPath(parsed.library);
  const skills = parsed.skills;
  if (skills === undefined || skills === null) {
    return { libraryPath, declarations: [] };
  }

  if (!isRecord(skills)) {
    throw new Error("skills must be a mapping of skill name to declaration");
  }

  const declarations: SkillDeclaration[] = [];
  for (const [name, value] of Object.entries(skills)) {
    declarations.push(readDeclaration(name, value));
  }

  declarations.sort((left, right) => left.name.localeCompare(right.name));
  return { libraryPath, declarations };
}

/**
 * Renders a manifest. Used to freeze the current disk layout as the declared
 * intent, so adopting the ledger is one action rather than an afternoon of typing.
 */
export function renderSkillManifest(document: SkillManifestDocument): string {
  const skills: Record<string, { mount: string[]; why?: string }> = {};
  for (const declaration of [...document.declarations].sort((left, right) => left.name.localeCompare(right.name))) {
    skills[declaration.name] = declaration.why
      ? { mount: [...declaration.mount], why: declaration.why }
      : { mount: [...declaration.mount] };
  }

  const header = [
    "# Which skills belong to which agent, and why.",
    "#",
    "# mount: targets where the skill is a symlink into the shared library below.",
    "#        A target left out is deliberately not mounted -- say why so the next",
    "#        reader can tell a decision from an oversight.",
    "# why:   free text, shown beside the skill wherever this ledger is reported.",
    ""
  ].join("\n");

  return `${header}${YAML.stringify({ library: document.libraryPath, skills })}`;
}

function readLibraryPath(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return resolveDefaultLibraryPath();
  }

  const trimmed = value.trim();
  if (trimmed.startsWith("~/")) {
    return join(homedir(), trimmed.slice(2));
  }

  return isAbsolute(trimmed) ? trimmed : join(homedir(), trimmed);
}

function readDeclaration(name: string, value: unknown): SkillDeclaration {
  if (value === null || value === undefined) {
    return { name, mount: [] };
  }

  if (Array.isArray(value)) {
    return { name, mount: readTargets(name, value) };
  }

  if (!isRecord(value)) {
    throw new Error(`skill "${name}" must be a mapping or a list of targets`);
  }

  const why = typeof value.why === "string" && value.why.trim() ? value.why.trim() : undefined;
  const mount = value.mount === undefined || value.mount === null ? [] : readTargets(name, value.mount);
  return why ? { name, mount, why } : { name, mount };
}

function readTargets(name: string, value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`skill "${name}" mount must be a list of target ids`);
  }

  const targets = value.map((entry) => {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new Error(`skill "${name}" mount entries must be target ids`);
    }

    return entry.trim();
  });

  return [...new Set(targets)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

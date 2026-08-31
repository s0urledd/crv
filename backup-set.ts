import { access, readFile, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { inspectArtifact } from "./artifact.js";
import { containedPath, selectInputFiles } from "./file-selection.js";
import { MANIFEST_FILENAME, manifestRoot, readManifest, type CaptureManifest } from "./manifest.js";
import type { ArtifactInspection, BackupSetLayout } from "./types.js";

export interface BackupSetInspection {
  root: string;
  artifactLocations: Map<string, string>;
  artifacts: ArtifactInspection[];
  layout: BackupSetLayout;
  manifest: CaptureManifest | null;
  manifestPath: string | null;
  missingArtifactPaths: string[];
}

function classify(artifacts: ArtifactInspection[], single: boolean): BackupSetLayout {
  if (artifacts.length === 0) return "unknown";
  if (single && artifacts.length === 1 && !artifacts[0]?.roles.includes("cluster")) return "single_artifact";
  const roles = new Set(artifacts.flatMap((artifact) => artifact.roles));
  const hasCluster = roles.has("cluster");
  const hasPair = roles.has("participant") && roles.has("validator");
  const onlyIdentities = roles.has("identities") && !hasCluster && !roles.has("participant") && !roles.has("validator");
  const perDatabaseArtifacts = artifacts.filter((artifact) => artifact.format !== "cluster_dump" && artifact.roles.some((role) => role === "participant" || role === "validator"));
  if (hasCluster && perDatabaseArtifacts.length > 0) return "mixed";
  if (hasCluster) return "cluster";
  if (hasPair) return "per_database";
  if (onlyIdentities) return "identities_only";
  return artifacts.length > 1 ? "mixed" : "single_artifact";
}

async function canAccess(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function manifestFromInput(input: string): Promise<string | null> {
  const absolute = resolve(input);
  const metadata = await stat(absolute);
  if (metadata.isDirectory()) {
    const candidate = join(absolute, MANIFEST_FILENAME);
    return await canAccess(candidate) ? candidate : null;
  }
  if (!metadata.isFile() || !input.toLowerCase().endsWith(".json")) return null;
  if (basename(input) === MANIFEST_FILENAME) return absolute;
  try {
    const value = JSON.parse(await readFile(absolute, "utf8")) as Record<string, unknown>;
    return Array.isArray(value.artifacts) && typeof value.schemaVersion === "string" ? absolute : null;
  } catch {
    return null;
  }
}

async function inspectFromManifest(path: string): Promise<BackupSetInspection> {
  const manifest = await readManifest(path);
  const root = manifestRoot(path);
  const artifacts: ArtifactInspection[] = [];
  const artifactLocations = new Map<string, string>();
  const missingArtifactPaths: string[] = [];
  for (const reference of manifest.artifacts) {
    const file = await containedPath(root, reference.path);
    try {
      const metadata = await stat(file);
      if (!metadata.isFile()) {
        missingArtifactPaths.push(reference.path);
        continue;
      }
    } catch {
      missingArtifactPaths.push(reference.path);
      continue;
    }
    const artifact = await inspectArtifact(file, { displayPath: reference.path, computeSha256: true });
    artifact.roles = [...new Set([...artifact.roles.filter((role) => role !== "unknown"), ...reference.roles])];
    artifacts.push(artifact);
    artifactLocations.set(reference.path, file);
  }
  return {
    root,
    artifactLocations,
    artifacts,
    layout: classify(artifacts, false),
    manifest,
    manifestPath: path,
    missingArtifactPaths,
  };
}

export async function inspectBackupSet(input: string): Promise<BackupSetInspection> {
  const manifestPath = await manifestFromInput(input);
  if (manifestPath) return inspectFromManifest(manifestPath);

  const selected = await selectInputFiles(input);
  const artifacts: ArtifactInspection[] = [];
  const artifactLocations = new Map<string, string>();
  for (const file of selected.files) {
    const displayPath = selected.single ? input : relative(selected.root, file);
    const artifact = await inspectArtifact(file, { displayPath });
    if (artifact.format !== "unknown") {
      artifacts.push(artifact);
      artifactLocations.set(displayPath, file);
    }
  }
  return {
    root: selected.single ? resolve(input, "..") : selected.root,
    artifactLocations,
    artifacts,
    layout: classify(artifacts, selected.single),
    manifest: null,
    manifestPath: null,
    missingArtifactPaths: [],
  };
}

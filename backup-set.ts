import { readdir, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { inspectArtifact } from "./artifact.js";
import type { ArtifactInspection, BackupSetLayout } from "./types.js";

export interface BackupSetInspection {
  artifacts: ArtifactInspection[];
  layout: BackupSetLayout;
}

async function walk(directory: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name.startsWith(".")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function inputFiles(input: string): Promise<{ root: string; files: string[]; single: boolean }> {
  const absolute = resolve(input);
  const metadata = await stat(absolute);
  if (metadata.isFile()) return { root: absolute, files: [absolute], single: true };
  if (!metadata.isDirectory()) throw new Error(`not a file or directory: ${input}`);
  return { root: absolute, files: await walk(absolute), single: false };
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

export async function inspectBackupSet(input: string): Promise<BackupSetInspection> {
  const selected = await inputFiles(input);
  const artifacts: ArtifactInspection[] = [];
  for (const file of selected.files) {
    const displayPath = selected.single ? input : relative(selected.root, file);
    const artifact = await inspectArtifact(file, { displayPath });
    if (artifact.format !== "unknown") artifacts.push(artifact);
  }
  return { artifacts, layout: classify(artifacts, selected.single) };
}

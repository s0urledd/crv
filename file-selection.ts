import { readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { UnsupportedInputError } from "./errors.js";

export interface InputSelection {
  root: string;
  files: string[];
  single: boolean;
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

export async function selectInputFiles(input: string): Promise<InputSelection> {
  const absolute = resolve(input);
  const metadata = await stat(absolute);
  if (metadata.isFile()) return { root: absolute, files: [absolute], single: true };
  if (!metadata.isDirectory()) throw new UnsupportedInputError(`not a file or directory: ${input}`);
  return { root: absolute, files: await walk(absolute), single: false };
}

export function validateRelativePath(path: string): void {
  if (path.length === 0 || isAbsolute(path) || path.includes("\\")) {
    throw new UnsupportedInputError(`manifest artifact path must be a portable relative path: ${path}`);
  }
  const normalized = path.split("/");
  if (normalized.some((part) => part === "" || part === "." || part === "..")) {
    throw new UnsupportedInputError(`manifest artifact path escapes or is not normalized: ${path}`);
  }
}

export async function containedPath(root: string, portableRelativePath: string): Promise<string> {
  validateRelativePath(portableRelativePath);
  const rootReal = await realpath(root);
  const candidate = resolve(root, ...portableRelativePath.split("/"));
  try {
    const candidateReal = await realpath(candidate);
    const fromRoot = relative(rootReal, candidateReal);
    if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(fromRoot)) {
      throw new UnsupportedInputError(`manifest artifact resolves outside the backup-set root: ${portableRelativePath}`);
    }
    return candidateReal;
  } catch (error) {
    if (error instanceof UnsupportedInputError) throw error;
    return candidate;
  }
}

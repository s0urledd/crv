import { access, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { inspectArtifact } from "./artifact.js";
import { UnsupportedInputError } from "./errors.js";
import { selectInputFiles, validateRelativePath } from "./file-selection.js";
import type { ArtifactFormat, ArtifactRole } from "./types.js";

export const MANIFEST_FILENAME = "crv-manifest.json";
export const MANIFEST_SCHEMA_VERSION = "1.0" as const;

export interface ManifestArtifact {
  path: string;
  format: ArtifactFormat;
  roles: ArtifactRole[];
  sizeBytes: number;
  sha256: string;
}

export interface ManifestDeclared {
  captureStartedAt: string | null;
  validatorCompletedAt: string | null;
  participantStartedAt: string | null;
  captureCompletedAt: string | null;
  spliceVersion: string | null;
  participantDatabase: string | null;
  validatorDatabase: string | null;
  expectedParticipantId: string | null;
  physicalSynchronizerId: string | null;
  physicalSynchronizerSerial: number | null;
}

export interface CaptureManifest {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  createdAt: string;
  updatedAt: string;
  declared: ManifestDeclared;
  artifacts: ManifestArtifact[];
}

const emptyDeclared = (): ManifestDeclared => ({
  captureStartedAt: null,
  validatorCompletedAt: null,
  participantStartedAt: null,
  captureCompletedAt: null,
  spliceVersion: null,
  participantDatabase: null,
  validatorDatabase: null,
  expectedParticipantId: null,
  physicalSynchronizerId: null,
  physicalSynchronizerSerial: null,
});

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new UnsupportedInputError(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function nullableString(value: unknown, name: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0) throw new UnsupportedInputError(`${name} must be a non-empty string or null`);
  return value;
}

const RFC3339_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

export function parseRfc3339DateTime(value: string): number | null {
  const match = value.match(RFC3339_DATE_TIME);
  if (match === null) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = Number(match[7] ?? 0);
  const offsetMinute = Number(match[8] ?? 0);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maximumDay = daysInMonth[month - 1] ?? 0;
  if (
    month < 1 || month > 12 ||
    day < 1 || day > maximumDay ||
    hour > 23 || minute > 59 || second > 60 ||
    offsetHour > 23 || offsetMinute > 59
  ) return null;

  const normalized = second === 60 ? `${value.slice(0, 17)}59${value.slice(19)}` : value;
  const milliseconds = Date.parse(normalized);
  return Number.isFinite(milliseconds) ? milliseconds + (second === 60 ? 1000 : 0) : null;
}

function nullableDate(value: unknown, name: string): string | null {
  const parsed = nullableString(value, name);
  if (parsed !== null && parseRfc3339DateTime(parsed) === null) {
    throw new UnsupportedInputError(`${name} must be an RFC 3339 date-time or null; for example 2026-08-31T12:34:56Z`);
  }
  return parsed;
}

function requiredDate(value: unknown, name: string): string {
  const parsed = nullableDate(value, name);
  if (parsed === null) throw new UnsupportedInputError(name + " is required");
  return parsed;
}

function requiredString(value: unknown, name: string): string {
  const parsed = nullableString(value, name);
  if (parsed === null) throw new UnsupportedInputError(`${name} must be a non-empty string`);
  return parsed;
}

function parseDeclared(value: unknown): ManifestDeclared {
  const input = record(value, "manifest.declared");
  const serial = input.physicalSynchronizerSerial;
  if (serial !== null && (!Number.isSafeInteger(serial) || (serial as number) < 0)) {
    throw new UnsupportedInputError("manifest.declared.physicalSynchronizerSerial must be a non-negative integer or null");
  }
  return {
    captureStartedAt: nullableDate(input.captureStartedAt, "manifest.declared.captureStartedAt"),
    validatorCompletedAt: nullableDate(input.validatorCompletedAt, "manifest.declared.validatorCompletedAt"),
    participantStartedAt: nullableDate(input.participantStartedAt, "manifest.declared.participantStartedAt"),
    captureCompletedAt: nullableDate(input.captureCompletedAt, "manifest.declared.captureCompletedAt"),
    spliceVersion: nullableString(input.spliceVersion, "manifest.declared.spliceVersion"),
    participantDatabase: nullableString(input.participantDatabase, "manifest.declared.participantDatabase"),
    validatorDatabase: nullableString(input.validatorDatabase, "manifest.declared.validatorDatabase"),
    expectedParticipantId: nullableString(input.expectedParticipantId, "manifest.declared.expectedParticipantId"),
    physicalSynchronizerId: nullableString(input.physicalSynchronizerId, "manifest.declared.physicalSynchronizerId"),
    physicalSynchronizerSerial: serial as number | null,
  };
}

function parseArtifact(value: unknown, index: number): ManifestArtifact {
  const input = record(value, `manifest.artifacts[${index}]`);
  const path = requiredString(input.path, `manifest.artifacts[${index}].path`);
  validateRelativePath(path);
  if (typeof input.sizeBytes !== "number" || !Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0) {
    throw new UnsupportedInputError(`manifest.artifacts[${index}].sizeBytes must be a non-negative integer`);
  }
  const sha256 = requiredString(input.sha256, `manifest.artifacts[${index}].sha256`);
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new UnsupportedInputError(`manifest.artifacts[${index}].sha256 must be lowercase SHA-256`);
  const formats: ArtifactFormat[] = ["plain_dump", "custom_dump", "cluster_dump", "identities_json", "unknown"];
  if (!formats.includes(input.format as ArtifactFormat)) throw new UnsupportedInputError(`manifest.artifacts[${index}].format is unsupported`);
  const allowedRoles: ArtifactRole[] = ["database", "participant", "validator", "identities", "cluster", "unknown"];
  if (!Array.isArray(input.roles) || input.roles.length === 0 || !input.roles.every((role) => allowedRoles.includes(role as ArtifactRole))) {
    throw new UnsupportedInputError("manifest.artifacts[" + index + "].roles contains an unsupported role");
  }
  return {
    path,
    format: input.format as ArtifactFormat,
    roles: input.roles as ArtifactRole[],
    sizeBytes: input.sizeBytes,
    sha256,
  };
}

export async function readManifest(path: string): Promise<CaptureManifest> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new UnsupportedInputError(`could not parse manifest ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const input = record(parsed, "manifest");
  if (input.schemaVersion !== MANIFEST_SCHEMA_VERSION) throw new UnsupportedInputError(`unsupported manifest schemaVersion: ${String(input.schemaVersion)}`);
  const artifactsInput = input.artifacts;
  if (!Array.isArray(artifactsInput)) throw new UnsupportedInputError("manifest.artifacts must be an array");
  const artifacts = artifactsInput.map(parseArtifact);
  const paths = new Set(artifacts.map((artifact) => artifact.path));
  if (paths.size !== artifacts.length) throw new UnsupportedInputError("manifest contains duplicate artifact paths");
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    createdAt: requiredDate(input.createdAt, "manifest.createdAt"),
    updatedAt: requiredDate(input.updatedAt, "manifest.updatedAt"),
    declared: parseDeclared(input.declared),
    artifacts,
  };
}

async function existingManifest(path: string): Promise<CaptureManifest | null> {
  try {
    await access(path);
    return await readManifest(path);
  } catch (error) {
    if (error instanceof UnsupportedInputError) throw error;
    return null;
  }
}

export async function writeManifest(directory: string): Promise<string> {
  const root = resolve(directory);
  const metadata = await stat(root);
  if (!metadata.isDirectory()) throw new UnsupportedInputError("crv manifest requires a directory");
  const path = join(root, MANIFEST_FILENAME);
  const previous = await existingManifest(path);
  const selection = await selectInputFiles(root);
  const artifacts: ManifestArtifact[] = [];
  for (const file of selection.files) {
    if (resolve(file) === path) continue;
    const portablePath = relative(root, file).split(sep).join("/");
    const inspection = await inspectArtifact(file, { displayPath: portablePath, computeSha256: true });
    if (inspection.format === "unknown" || inspection.sha256 === null) continue;
    artifacts.push({
      path: portablePath,
      format: inspection.format,
      roles: inspection.roles,
      sizeBytes: inspection.sizeBytes,
      sha256: inspection.sha256,
    });
  }
  const now = new Date().toISOString();
  const manifest: CaptureManifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    declared: previous?.declared ?? emptyDeclared(),
    artifacts,
  };
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o644 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  return path;
}

export function manifestRoot(path: string): string {
  return dirname(resolve(path));
}

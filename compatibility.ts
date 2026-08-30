import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { UnsupportedInputError } from "./errors.js";

export type OffsetRole = "participant" | "validator";
const OFFSET_ORDER_CHECK = "backup.offset_order";

export interface OffsetShape {
  table: string;
  columns: string[];
  sha256: string;
}

export interface SchemaFamily {
  id: string;
  checks: string[];
  sourceDefinitionSha256: string;
  shapes: Record<OffsetRole, OffsetShape>;
}

export interface DrillEvidence {
  participantImage: string;
  postgresMajor: number;
  testedAt: string;
  evidence: string;
}

export interface CompatibilityData {
  schemaVersion: "1.0";
  schemaFamilies: SchemaFamily[];
  runtime: {
    participantImageRepository: string;
    postgresImage: string;
    postgresMajor: number;
    participantStartupTimeoutSeconds: number;
    drillEvidence: Record<string, DrillEvidence>;
  };
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new UnsupportedInputError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: string[], name: string): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) throw new UnsupportedInputError(`${name} contains unknown key: ${unexpected[0]}`);
}

function stringValue(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new UnsupportedInputError(`${name} must be a non-empty string`);
  return value;
}

function digest(value: unknown, name: string): string {
  const parsed = stringValue(value, name);
  if (!/^[0-9a-f]{64}$/.test(parsed)) throw new UnsupportedInputError(`${name} must be lowercase SHA-256`);
  return parsed;
}

export function artifactShapeSha256(table: string, columns: string[]): string {
  return createHash("sha256").update(`${table}|${columns.join(",")}`).digest("hex");
}

function parseShape(value: unknown, name: string): OffsetShape {
  const input = record(value, name);
  exactKeys(input, ["table", "columns", "sha256"], name);
  if (!Array.isArray(input.columns) || input.columns.length === 0 || !input.columns.every((column) => typeof column === "string" && column.length > 0)) {
    throw new UnsupportedInputError(`${name}.columns must be non-empty strings`);
  }
  const shape = {
    table: stringValue(input.table, `${name}.table`),
    columns: input.columns as string[],
    sha256: digest(input.sha256, `${name}.sha256`),
  };
  if (artifactShapeSha256(shape.table, shape.columns) !== shape.sha256) {
    throw new UnsupportedInputError(`${name}.sha256 does not match its canonical table and columns`);
  }
  return shape;
}

function parseCompatibility(value: unknown): CompatibilityData {
  const root = record(value, "compatibility");
  exactKeys(root, ["schemaVersion", "schemaFamilies", "runtime"], "compatibility");
  if (root.schemaVersion !== "1.0") throw new UnsupportedInputError(`unsupported compatibility schemaVersion: ${String(root.schemaVersion)}`);
  if (!Array.isArray(root.schemaFamilies) || root.schemaFamilies.length === 0) {
    throw new UnsupportedInputError("compatibility.schemaFamilies must be a non-empty array");
  }
  const schemaFamilies = root.schemaFamilies.map((entry, index): SchemaFamily => {
    const name = `compatibility.schemaFamilies[${index}]`;
    const family = record(entry, name);
    exactKeys(family, ["id", "checks", "sourceDefinitionSha256", "shapes"], name);
    if (!Array.isArray(family.checks) || family.checks.length === 0 || !family.checks.every((check) => typeof check === "string" && check.length > 0)) {
      throw new UnsupportedInputError(`${name}.checks must be non-empty strings`);
    }
    const shapes = record(family.shapes, `${name}.shapes`);
    exactKeys(shapes, ["participant", "validator"], `${name}.shapes`);
    return {
      id: stringValue(family.id, `${name}.id`),
      checks: family.checks as string[],
      sourceDefinitionSha256: digest(family.sourceDefinitionSha256, `${name}.sourceDefinitionSha256`),
      shapes: {
        participant: parseShape(shapes.participant, `${name}.shapes.participant`),
        validator: parseShape(shapes.validator, `${name}.shapes.validator`),
      },
    };
  });
  const ids = new Set(schemaFamilies.map((family) => family.id));
  if (ids.size !== schemaFamilies.length) throw new UnsupportedInputError("compatibility contains duplicate schema family ids");

  const runtime = record(root.runtime, "compatibility.runtime");
  exactKeys(runtime, ["participantImageRepository", "postgresImage", "postgresMajor", "participantStartupTimeoutSeconds", "drillEvidence"], "compatibility.runtime");
  const participantImageRepository = stringValue(runtime.participantImageRepository, "compatibility.runtime.participantImageRepository");
  if (!/^[a-z0-9.-]+(?::[0-9]+)?(?:\/[a-z0-9._-]+)+$/.test(participantImageRepository)) {
    throw new UnsupportedInputError("compatibility.runtime.participantImageRepository must be an untagged repository");
  }
  const postgresImage = stringValue(runtime.postgresImage, "compatibility.runtime.postgresImage");
  if (!/^[^@\s]+@sha256:[0-9a-f]{64}$/.test(postgresImage)) {
    throw new UnsupportedInputError("compatibility.runtime.postgresImage must be pinned by digest");
  }
  if (!Number.isSafeInteger(runtime.postgresMajor) || (runtime.postgresMajor as number) <= 0) {
    throw new UnsupportedInputError("compatibility.runtime.postgresMajor must be a positive integer");
  }
  const postgresMajor = runtime.postgresMajor as number;
  if (!Number.isSafeInteger(runtime.participantStartupTimeoutSeconds) || (runtime.participantStartupTimeoutSeconds as number) <= 0) {
    throw new UnsupportedInputError("compatibility.runtime.participantStartupTimeoutSeconds must be a positive integer");
  }
  const participantStartupTimeoutSeconds = runtime.participantStartupTimeoutSeconds as number;
  const evidenceInput = record(runtime.drillEvidence, "compatibility.runtime.drillEvidence");
  const drillEvidence: Record<string, DrillEvidence> = {};
  for (const [version, rawEvidence] of Object.entries(evidenceInput)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(version)) throw new UnsupportedInputError(`invalid drill evidence version tag: ${version}`);
    const name = `compatibility.runtime.drillEvidence.${version}`;
    const evidence = record(rawEvidence, name);
    exactKeys(evidence, ["participantImage", "postgresMajor", "testedAt", "evidence"], name);
    if (!Number.isSafeInteger(evidence.postgresMajor) || (evidence.postgresMajor as number) <= 0) {
      throw new UnsupportedInputError(`${name}.postgresMajor must be a positive integer`);
    }
    if ((evidence.postgresMajor as number) !== postgresMajor) {
      throw new UnsupportedInputError(`${name}.postgresMajor must match compatibility.runtime.postgresMajor`);
    }
    const participantImage = stringValue(evidence.participantImage, `${name}.participantImage`);
    const participantPrefix = `${participantImageRepository}@sha256:`;
    if (!participantImage.startsWith(participantPrefix) || !/^[0-9a-f]{64}$/.test(participantImage.slice(participantPrefix.length))) {
      throw new UnsupportedInputError(`${name}.participantImage must pin the configured repository by digest`);
    }
    const testedAt = stringValue(evidence.testedAt, `${name}.testedAt`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(testedAt)) throw new UnsupportedInputError(`${name}.testedAt must be YYYY-MM-DD`);
    drillEvidence[version] = {
      participantImage,
      postgresMajor: evidence.postgresMajor as number,
      testedAt,
      evidence: stringValue(evidence.evidence, `${name}.evidence`),
    };
  }
  return {
    schemaVersion: "1.0",
    schemaFamilies,
    runtime: { participantImageRepository, postgresImage, postgresMajor, participantStartupTimeoutSeconds, drillEvidence },
  };
}

export function loadCompatibility(path = fileURLToPath(new URL("../compatibility.json", import.meta.url))): CompatibilityData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new UnsupportedInputError(`could not read compatibility data: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseCompatibility(parsed);
}

export const compatibility = loadCompatibility();

export function offsetRoleForTable(table: string): OffsetRole | null {
  for (const family of compatibility.schemaFamilies.filter((candidate) => candidate.checks.includes(OFFSET_ORDER_CHECK))) {
    for (const role of ["participant", "validator"] as const) {
      if (family.shapes[role].table === table) return role;
    }
  }
  return null;
}

export function recognizeOffsetShape(table: string, columns: string[]): { familyId: string; role: OffsetRole } | null {
  const hash = artifactShapeSha256(table, columns);
  for (const family of compatibility.schemaFamilies.filter((candidate) => candidate.checks.includes(OFFSET_ORDER_CHECK))) {
    for (const role of ["participant", "validator"] as const) {
      const shape = family.shapes[role];
      if (shape.sha256 === hash && shape.table === table) return { familyId: family.id, role };
    }
  }
  return null;
}

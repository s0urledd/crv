import { stat } from "node:fs/promises";
import type { ArtifactInspection } from "./types.js";
import { inspectArtifact } from "./artifact.js";
import { UnsupportedInputError } from "./errors.js";

function value(input: string | number | null): string {
  return input === null ? "unknown" : String(input);
}

export function formatInspection(artifact: ArtifactInspection): string {
  const rows: Array<[string, string]> = [
    ["Path", artifact.path],
    ["Format", artifact.format],
    ["Compression", artifact.compression],
    ["Role", artifact.roles.join(", ")],
    ["Size", `${artifact.sizeBytes} bytes`],
    ["SHA-256", artifact.sha256 ?? "not computed"],
    ["Source DB", value(artifact.sourceDatabase)],
    ["Databases", artifact.databases.length === 0 ? "unknown" : artifact.databases.join(", ")],
    ["PostgreSQL source", value(artifact.postgresSourceVersion)],
    ["PostgreSQL dumper", value(artifact.postgresDumperVersion)],
    ["Archive created", value(artifact.archiveCreatedAt)],
    ["Splice version", value(artifact.spliceVersion)],
    ["Participant ID", value(artifact.participantId)],
    ["Identity structure", artifact.identityStructureValid === null ? "not applicable" : artifact.identityStructureValid ? "valid" : "invalid"],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  const output = rows.map(([label, item]) => `${label.padEnd(width)}  ${item}`);
  for (const offset of artifact.offsets) {
    const scope = offset.database ?? "per-db artifact";
    if (offset.participantLedgerEnd) output.push(`Offset[${scope}] participant ledger end: ${offset.participantLedgerEnd}`);
    if (offset.validatorLastIngested) {
      output.push(
        `Offset[${scope}] validator last ingested: ${offset.validatorLastIngested} (migration ${offset.validatorMigrationId ?? "unknown"})`,
      );
    }
  }
  for (const limitation of artifact.limitations) output.push(`Limit: ${limitation}`);
  return output.join("\n");
}

export async function runInspect(path: string, json: boolean): Promise<void> {
  let metadata;
  try {
    metadata = await stat(path);
  } catch {
    throw new UnsupportedInputError(`input path is not accessible: ${path}`);
  }
  if (metadata.isDirectory()) {
    throw new UnsupportedInputError(`crv inspect takes a file; use crv verify for a directory: ${path}`);
  }
  if (!metadata.isFile()) throw new UnsupportedInputError(`crv inspect takes a regular file: ${path}`);
  const artifact = await inspectArtifact(path);
  process.stdout.write(json ? `${JSON.stringify(artifact, null, 2)}\n` : `${formatInspection(artifact)}\n`);
}

import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, open, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { UnsupportedInputError } from "./errors.js";
import type {
  ArtifactCompression,
  ArtifactInspection,
  ArtifactRole,
  OffsetEvidence,
} from "./types.js";

interface OffsetAccumulator {
  participantLedgerEnd?: bigint;
  validatorMigrationId?: bigint;
  validatorLastIngested?: bigint;
}

interface SqlInspection {
  cluster: boolean;
  roles: Set<ArtifactRole>;
  databases: Set<string>;
  postgresSourceVersion: string | null;
  postgresDumperVersion: string | null;
  offsets: Map<string, OffsetAccumulator>;
}

interface CopyState {
  role: "participant" | "validator";
  columns: string[];
}

interface InspectionOptions {
  displayPath?: string;
  computeSha256?: boolean;
}

function emptySqlInspection(): SqlInspection {
  return {
    cluster: false,
    roles: new Set<ArtifactRole>(),
    databases: new Set<string>(),
    postgresSourceVersion: null,
    postgresDumperVersion: null,
    offsets: new Map<string, OffsetAccumulator>(),
  };
}

function databaseFromConnect(line: string): string | null {
  const quoted = line.match(/dbname='([^']+)'/);
  if (quoted?.[1]) return quoted[1];
  const simple = line.match(/^\\connect\s+(?:-reuse-previous=on\s+)?"?([^"\s]+)"?$/);
  return simple?.[1] ?? null;
}

function offsetEntry(parsed: SqlInspection, database: string | null): OffsetAccumulator {
  const key = database ?? "<per-db>";
  const existing = parsed.offsets.get(key);
  if (existing) return existing;
  const created: OffsetAccumulator = {};
  parsed.offsets.set(key, created);
  return created;
}

function parseLegacyOffset(value: string): bigint | null {
  if (!/^[0-9a-fA-F]+$/.test(value)) return null;
  try {
    return BigInt(`0x${value}`);
  } catch {
    return null;
  }
}

function copyHeader(line: string): CopyState | null {
  const match = line.match(/^COPY (participant\.lapi_parameters|validator\.store_last_ingested_offsets) \(([^)]+)\) FROM stdin;$/);
  if (!match?.[1] || !match[2]) return null;
  return {
    role: match[1].startsWith("participant.") ? "participant" : "validator",
    columns: match[2].split(",").map((column) => column.trim()),
  };
}

function consumeSqlLine(
  parsed: SqlInspection,
  line: string,
  state: { database: string | null; copy: CopyState | null },
): void {
  if (line.includes("PostgreSQL database cluster dump")) parsed.cluster = true;

  const sourceVersion = line.match(/^-- Dumped from database version (.+)$/)?.[1];
  if (sourceVersion) parsed.postgresSourceVersion = sourceVersion;
  const dumperVersion = line.match(/^-- Dumped by pg_dump(?:all)? version (.+)$/)?.[1];
  if (dumperVersion) parsed.postgresDumperVersion = dumperVersion;

  if (line.startsWith("\\connect ")) {
    state.database = databaseFromConnect(line);
    if (state.database) parsed.databases.add(state.database);
    state.copy = null;
    return;
  }

  const header = copyHeader(line);
  if (header) {
    parsed.roles.add(header.role);
    state.copy = header;
    return;
  }
  if (line === "\\.") {
    state.copy = null;
    return;
  }
  if (!state.copy || line.startsWith("--") || line.length === 0) return;

  const fields = line.split("\t");
  const entry = offsetEntry(parsed, state.database);
  if (state.copy.role === "participant") {
    const index = state.copy.columns.indexOf("ledger_end");
    const value = index < 0 ? undefined : fields[index];
    if (value && /^\d+$/.test(value)) entry.participantLedgerEnd = BigInt(value);
    return;
  }

  const migrationIndex = state.copy.columns.indexOf("migration_id");
  const offsetIndex = state.copy.columns.indexOf("last_ingested_offset");
  const migration = migrationIndex < 0 ? undefined : fields[migrationIndex];
  const rawOffset = offsetIndex < 0 ? undefined : fields[offsetIndex];
  if (!migration || !/^\d+$/.test(migration) || !rawOffset) return;
  const migrationId = BigInt(migration);
  const offset = parseLegacyOffset(rawOffset);
  if (offset === null) return;
  if (
    entry.validatorMigrationId === undefined ||
    migrationId > entry.validatorMigrationId ||
    (migrationId === entry.validatorMigrationId &&
      (entry.validatorLastIngested === undefined || offset > entry.validatorLastIngested))
  ) {
    entry.validatorMigrationId = migrationId;
    entry.validatorLastIngested = offset;
  }
}

async function parseSqlFile(path: string): Promise<SqlInspection> {
  const parsed = emptySqlInspection();
  const state: { database: string | null; copy: CopyState | null } = { database: null, copy: null };
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) consumeSqlLine(parsed, line, state);
  return parsed;
}

function parseSqlText(text: string, database: string | null): SqlInspection {
  const parsed = emptySqlInspection();
  const state: { database: string | null; copy: CopyState | null } = { database, copy: null };
  for (const line of text.split(/\r?\n/)) consumeSqlLine(parsed, line, state);
  return parsed;
}

function mergeSql(target: SqlInspection, source: SqlInspection): void {
  for (const role of source.roles) target.roles.add(role);
  for (const database of source.databases) target.databases.add(database);
  for (const [database, values] of source.offsets) {
    target.offsets.set(database, { ...target.offsets.get(database), ...values });
  }
}

function offsetEvidence(parsed: SqlInspection): OffsetEvidence[] {
  return [...parsed.offsets.entries()].map(([database, value]) => ({
    database: database === "<per-db>" ? null : database,
    ...(value.participantLedgerEnd === undefined
      ? {}
      : { participantLedgerEnd: value.participantLedgerEnd.toString(10) }),
    ...(value.validatorLastIngested === undefined
      ? {}
      : { validatorLastIngested: value.validatorLastIngested.toString(10) }),
    ...(value.validatorMigrationId === undefined
      ? {}
      : { validatorMigrationId: value.validatorMigrationId.toString(10) }),
  }));
}

export async function computeSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function firstBytes(path: string, length: number): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function compressionFromMagic(prefix: Buffer): ArtifactCompression {
  if (prefix.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b]))) return "gzip";
  if (prefix.subarray(0, 4).equals(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]))) return "zstd";
  if (prefix.subarray(0, 6).equals(Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]))) return "xz";
  if (prefix.subarray(0, 3).toString("ascii") === "BZh") return "bzip2";
  return "none";
}

async function externalDecode(command: string, args: string[], destination: string): Promise<void> {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  if (!child.stdout || !child.stderr) throw new UnsupportedInputError(`could not start ${command}`);
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    if (stderr.length < 8192) stderr += chunk;
  });
  const completion = new Promise<void>((resolve, reject) => {
    child.once("error", (error) => reject(new UnsupportedInputError(`${command} is required to inspect this artifact: ${error.message}`)));
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new UnsupportedInputError(`${command} could not decode the artifact${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
    });
  });
  await Promise.all([pipeline(child.stdout, createWriteStream(destination)), completion]);
}

async function decodeToFile(source: string, compression: Exclude<ArtifactCompression, "none" | "unknown">, destination: string): Promise<void> {
  if (compression === "gzip") {
    await pipeline(createReadStream(source), createGunzip(), createWriteStream(destination));
    return;
  }
  const commands = {
    zstd: ["zstd", ["-q", "-d", "-c", "--", source]],
    xz: ["xz", ["-d", "-c", "--", source]],
    bzip2: ["bzip2", ["-d", "-c", "--", source]],
  } as const;
  const selected = commands[compression];
  await externalDecode(selected[0], [...selected[1]], destination);
}

async function inspectIdentities(
  logicalPath: string,
  displayPath: string,
  sizeBytes: number,
  digest: string | null,
  compression: ArtifactCompression,
): Promise<ArtifactInspection | null> {
  const metadata = await stat(logicalPath);
  if (metadata.size > 16 * 1024 * 1024) return null;
  try {
    const value = JSON.parse(await readFile(logicalPath, "utf8")) as Record<string, unknown>;
    if (!("id" in value && "keys" in value && "version" in value && "authorizedStoreSnapshot" in value)) return null;
    return {
      path: displayPath,
      format: "identities_json",
      compression,
      roles: ["identities"],
      sizeBytes,
      sha256: digest,
      sourceDatabase: null,
      databases: [],
      postgresSourceVersion: null,
      postgresDumperVersion: null,
      archiveCreatedAt: null,
      spliceVersion: typeof value.version === "string" ? value.version : null,
      offsets: [],
      limitations: ["Party hint and successful re-onboarding are not intrinsic to this artifact."],
    };
  } catch {
    return null;
  }
}

function runPgRestore(args: string[]): SpawnSyncReturns<string> {
  return spawnSync("pg_restore", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

async function inspectCustom(
  logicalPath: string,
  displayPath: string,
  sizeBytes: number,
  digest: string | null,
  compression: ArtifactCompression,
): Promise<ArtifactInspection> {
  const limitations: string[] = [];
  const listing = runPgRestore(["-l", logicalPath]);
  if (listing.error || listing.status !== 0) {
    limitations.push("A compatible pg_restore is required to read this custom archive; database and offset evidence are unknown.");
    return {
      path: displayPath,
      format: "custom_dump",
      compression,
      roles: ["unknown"],
      sizeBytes,
      sha256: digest,
      sourceDatabase: null,
      databases: [],
      postgresSourceVersion: null,
      postgresDumperVersion: null,
      archiveCreatedAt: null,
      spliceVersion: null,
      offsets: [],
      limitations,
    };
  }

  const output = listing.stdout;
  const database = output.match(/^;\s+dbname:\s+(.+)$/m)?.[1]?.trim() ?? null;
  const createdAt = output.match(/^; Archive created at (.+)$/m)?.[1]?.trim() ?? null;
  const sourceVersion = output.match(/^;\s+Dumped from database version:\s+(.+)$/m)?.[1]?.trim() ?? null;
  const dumperVersion = output.match(/^;\s+Dumped by pg_dump version:\s+(.+)$/m)?.[1]?.trim() ?? null;
  const parsed = emptySqlInspection();
  for (const table of ["participant.lapi_parameters", "validator.store_last_ingested_offsets"]) {
    const extracted = runPgRestore(["-a", "-t", table, logicalPath]);
    if (extracted.status === 0 && extracted.stdout) mergeSql(parsed, parseSqlText(extracted.stdout, database));
  }
  if (parsed.roles.size === 0) limitations.push("The archive has no recognized CRV offset table or pg_restore could not extract it.");

  return {
    path: displayPath,
    format: "custom_dump",
    compression,
    roles: parsed.roles.size === 0 ? ["unknown"] : [...parsed.roles],
    sizeBytes,
    sha256: digest,
    sourceDatabase: database,
    databases: database ? [database] : [],
    postgresSourceVersion: sourceVersion,
    postgresDumperVersion: dumperVersion,
    archiveCreatedAt: createdAt,
    spliceVersion: null,
    offsets: offsetEvidence(parsed),
    limitations,
  };
}

async function inspectUncompressed(
  logicalPath: string,
  displayPath: string,
  sizeBytes: number,
  digest: string | null,
  compression: ArtifactCompression,
): Promise<ArtifactInspection> {
  const prefix = await firstBytes(logicalPath, 4096);
  if (prefix.subarray(0, 5).toString("ascii") === "PGDMP") {
    return inspectCustom(logicalPath, displayPath, sizeBytes, digest, compression);
  }
  if (prefix.toString("utf8").trimStart().startsWith("{")) {
    const identities = await inspectIdentities(logicalPath, displayPath, sizeBytes, digest, compression);
    if (identities) return identities;
  }

  const header = prefix.toString("utf8");
  if (!header.includes("PostgreSQL database dump") && !header.includes("PostgreSQL database cluster dump")) {
    return {
      path: displayPath, format: "unknown", compression, roles: ["unknown"], sizeBytes, sha256: digest,
      sourceDatabase: null, databases: [], postgresSourceVersion: null, postgresDumperVersion: null,
      archiveCreatedAt: null, spliceVersion: null, offsets: [], limitations: ["Artifact format is not recognized."],
    };
  }

  const parsed = await parseSqlFile(logicalPath);
  const recognized = parsed.cluster || parsed.roles.size > 0 || parsed.postgresDumperVersion !== null;
  if (!recognized) {
    return {
      path: displayPath,
      format: "unknown",
      compression,
      roles: ["unknown"],
      sizeBytes,
      sha256: digest,
      sourceDatabase: null,
      databases: [],
      postgresSourceVersion: null,
      postgresDumperVersion: null,
      archiveCreatedAt: null,
      spliceVersion: null,
      offsets: [],
      limitations: ["Artifact format is not recognized."],
    };
  }

  return {
    path: displayPath,
    format: parsed.cluster ? "cluster_dump" : "plain_dump",
    compression,
    roles: parsed.cluster ? ["cluster", ...parsed.roles] : parsed.roles.size === 0 ? ["unknown"] : [...parsed.roles],
    sizeBytes,
    sha256: digest,
    sourceDatabase: null,
    databases: [...parsed.databases],
    postgresSourceVersion: parsed.postgresSourceVersion,
    postgresDumperVersion: parsed.postgresDumperVersion,
    archiveCreatedAt: null,
    spliceVersion: null,
    offsets: offsetEvidence(parsed),
    limitations: parsed.cluster
      ? ["A pg_dumpall artifact is sequential, not a cross-database snapshot."]
      : ["A per-database plain dump does not reliably contain its source database name or capture time."],
  };
}

export async function inspectArtifact(path: string, options: InspectionOptions = {}): Promise<ArtifactInspection> {
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new Error(`not a regular file: ${path}`);
  const displayPath = options.displayPath ?? path;
  const rawPrefix = await firstBytes(path, 8);
  const compression = compressionFromMagic(rawPrefix);
  const digest = options.computeSha256 === true ? await computeSha256(path) : null;
  if (compression === "none") return inspectUncompressed(path, displayPath, metadata.size, digest, compression);
  if (compression === "unknown") throw new UnsupportedInputError(`unknown compression for ${displayPath}`);

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "crv-inspect-"));
  const decodedPath = join(temporaryDirectory, basename(path).replace(/\.(?:gz|zst|xz|bz2)$/i, "") || "artifact");
  try {
    await decodeToFile(path, compression, decodedPath);
    return await inspectUncompressed(decodedPath, displayPath, metadata.size, digest, compression);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

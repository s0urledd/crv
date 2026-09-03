import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseDocument } from "yaml";
import { UnsupportedInputError } from "./errors.js";

export const CONFIG_SCHEMA_VERSION = "1.0" as const;

export interface CrvConfig {
  schemaVersion: typeof CONFIG_SCHEMA_VERSION;
  deployment: {
    participantDatabase: string | null;
    validatorDatabase: string | null;
    expectedParticipantId: string | null;
  };
  network: {
    scanVersionUrl: string | null;
    sequencerHorizonSeconds: number | null;
    sequencerHorizonSource: string | null;
    backupAgeWarnFraction: number | null;
    currentPhysicalSynchronizerId: string | null;
    currentPhysicalSynchronizerSerial: number | null;
    capturedPhysicalSynchronizerUsable: boolean | null;
    capturedPhysicalSynchronizerUsabilitySource: string | null;
  };
  watch: {
    statePath: string;
    reportsPath: string;
    intervalSeconds: number;
    heartbeatUrl: string | null;
  };
}

const TEMPLATE = `# crv operator configuration
# Values are evidence inputs. Leave unknown values null; crv will explain which
# checks remain UNKNOWN. Do not put OAuth client secrets or identities key data here.
schemaVersion: "1.0"

deployment:
  # Effective CANTON_PARTICIPANT_POSTGRES_DB / Helm databaseName.
  participantDatabase: null
  # Effective validator app database name. Compose defaults to validator.
  validatorDatabase: null
  # Expected PAR:: participant identity, if supplied by trusted operator evidence.
  expectedParticipantId: null

network:
  # Optional public Scan endpoint. Verification stays offline when null.
  # Example: https://scan.example/api/scan/version
  scanVersionUrl: null
  # Effective sequencer catch-up horizon. crv never assumes 30 days silently.
  sequencerHorizonSeconds: null
  # Versioned documentation URL/reference or network-operator source.
  # Example: "SV 30-day pruning window (DA, 2026-08-31): [https://github.com/canton-foundation/canton-dev-fund/pull/750](https://github.com/canton-foundation/canton-dev-fund/pull/750)"
  sequencerHorizonSource: null
  # Optional warning threshold as a fraction of the sourced horizon (0 < value < 1).
  # Leave null to disable age warnings; crv assumes no fraction silently.
  backupAgeWarnFraction: null
  # Current active physical synchronizer evidence from participant admin or Scan.
  currentPhysicalSynchronizerId: null
  currentPhysicalSynchronizerSerial: null
  # Set only when a trusted network operator confirms the captured old physical
  # synchronizer can still be used for the first restore after an LSU.
  capturedPhysicalSynchronizerUsable: null
  capturedPhysicalSynchronizerUsabilitySource: null

watch:
  # State and reports are separate from backup artifacts.
  statePath: .crv/state.json
  reportsPath: crv-reports
  intervalSeconds: 86400
  # Optional dead-man's-switch ping. Leave commented to keep watch offline.
  # heartbeatUrl: https://monitor.example/ping/crv
`;

function object(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new UnsupportedInputError(`${name} must be a mapping`);
  return value as Record<string, unknown>;
}

function keys(input: Record<string, unknown>, allowed: string[], name: string): void {
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new UnsupportedInputError(`${name} contains unknown key: ${unknown[0]}`);
}

function nullableString(value: unknown, name: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length === 0) throw new UnsupportedInputError(`${name} must be a non-empty string or null`);
  return value;
}

function nullableAbsoluteHttpUrl(value: unknown, name: string): URL | null {
  const parsed = nullableString(value, name);
  if (parsed === null) return null;
  let url: URL;
  try { url = new URL(parsed); } catch { throw new UnsupportedInputError(`${name} must be an absolute HTTP(S) URL or null`); }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || url.search || url.hash) {
    throw new UnsupportedInputError(`${name} must be an absolute HTTP(S) URL without credentials, query, or fragment, or null`);
  }
  return url;
}

function nullableHttpUrl(value: unknown, name: string): string | null {
  const url = nullableAbsoluteHttpUrl(value, name);
  if (url === null) return null;
  if (url.pathname !== "/api/scan/version") {
    throw new UnsupportedInputError(`${name} must be an HTTP(S) /api/scan/version URL without credentials, query, or fragment`);
  }
  return url.toString();
}

function nullableHeartbeatUrl(value: unknown, name: string): string | null {
  return nullableAbsoluteHttpUrl(value, name)?.toString() ?? null;
}

function nullableInteger(value: unknown, name: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new UnsupportedInputError(`${name} must be a non-negative integer or null`);
  return value as number;
}

function nullableFraction(value: unknown, name: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new UnsupportedInputError(`${name} must be a number greater than 0 and less than 1, or null`);
  }
  return value;
}

function requiredPositiveInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new UnsupportedInputError(`${name} must be a positive integer`);
  return value as number;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new UnsupportedInputError(`${name} must be a non-empty string`);
  return value;
}

export async function loadConfig(path: string): Promise<CrvConfig> {
  const document = parseDocument(await readFile(path, "utf8"), { uniqueKeys: true });
  if (document.errors.length > 0) throw new UnsupportedInputError(`invalid crv config: ${document.errors[0]?.message ?? "YAML parse error"}`);
  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    throw new UnsupportedInputError(`invalid crv config: ${error instanceof Error ? error.message : String(error)}`);
  }
  const root = object(value, "config");
  keys(root, ["schemaVersion", "deployment", "network", "watch"], "config");
  if (root.schemaVersion !== CONFIG_SCHEMA_VERSION) throw new UnsupportedInputError(`unsupported config schemaVersion: ${String(root.schemaVersion)}`);
  const deployment = object(root.deployment ?? {}, "config.deployment");
  const network = object(root.network ?? {}, "config.network");
  const watch = object(root.watch ?? {}, "config.watch");
  keys(deployment, ["participantDatabase", "validatorDatabase", "expectedParticipantId"], "config.deployment");
  keys(network, [
    "scanVersionUrl", "sequencerHorizonSeconds", "sequencerHorizonSource", "backupAgeWarnFraction", "currentPhysicalSynchronizerId",
    "currentPhysicalSynchronizerSerial", "capturedPhysicalSynchronizerUsable",
    "capturedPhysicalSynchronizerUsabilitySource",
  ], "config.network");
  keys(watch, ["statePath", "reportsPath", "intervalSeconds", "heartbeatUrl"], "config.watch");
  const usable = network.capturedPhysicalSynchronizerUsable;
  if (usable !== null && usable !== undefined && typeof usable !== "boolean") {
    throw new UnsupportedInputError("config.network.capturedPhysicalSynchronizerUsable must be boolean or null");
  }
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    deployment: {
      participantDatabase: nullableString(deployment.participantDatabase, "config.deployment.participantDatabase"),
      validatorDatabase: nullableString(deployment.validatorDatabase, "config.deployment.validatorDatabase"),
      expectedParticipantId: nullableString(deployment.expectedParticipantId, "config.deployment.expectedParticipantId"),
    },
    network: {
      scanVersionUrl: nullableHttpUrl(network.scanVersionUrl, "config.network.scanVersionUrl"),
      sequencerHorizonSeconds: nullableInteger(network.sequencerHorizonSeconds, "config.network.sequencerHorizonSeconds"),
      sequencerHorizonSource: nullableString(network.sequencerHorizonSource, "config.network.sequencerHorizonSource"),
      backupAgeWarnFraction: nullableFraction(network.backupAgeWarnFraction, "config.network.backupAgeWarnFraction"),
      currentPhysicalSynchronizerId: nullableString(network.currentPhysicalSynchronizerId, "config.network.currentPhysicalSynchronizerId"),
      currentPhysicalSynchronizerSerial: nullableInteger(network.currentPhysicalSynchronizerSerial, "config.network.currentPhysicalSynchronizerSerial"),
      capturedPhysicalSynchronizerUsable: (usable as boolean | null | undefined) ?? null,
      capturedPhysicalSynchronizerUsabilitySource: nullableString(network.capturedPhysicalSynchronizerUsabilitySource, "config.network.capturedPhysicalSynchronizerUsabilitySource"),
    },
    watch: {
      statePath: requiredString(watch.statePath ?? ".crv/state.json", "config.watch.statePath"),
      reportsPath: requiredString(watch.reportsPath ?? "crv-reports", "config.watch.reportsPath"),
      intervalSeconds: requiredPositiveInteger(watch.intervalSeconds ?? 86400, "config.watch.intervalSeconds"),
      heartbeatUrl: nullableHeartbeatUrl(watch.heartbeatUrl, "config.watch.heartbeatUrl"),
    },
  };
}

export async function writeInitialConfig(path = "crv.yaml"): Promise<string> {
  const absolute = resolve(path);
  try {
    await writeFile(absolute, TEMPLATE, { flag: "wx", mode: 0o644 });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code === "EEXIST") throw new UnsupportedInputError(`refusing to overwrite existing config: ${absolute}`);
    throw error;
  }
  return absolute;
}

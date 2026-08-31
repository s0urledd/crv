import { inspectBackupSet, type BackupSetInspection } from "./backup-set.js";
import { checkBackupAge } from "./checks/backup-age.js";
import { checkIdentitiesStructure } from "./checks/identities-structure.js";
import { checkLsuPath } from "./checks/lsu.js";
import { checkOffsetOrder } from "./checks/offset-order.js";
import { checkReferenceDigest } from "./checks/reference-digest.js";
import { checkRequiredPath } from "./checks/required-path.js";
import { checkSelectedIdentity } from "./checks/selected-identity.js";
import { loadConfig, type CrvConfig } from "./config.js";
import { aggregate, exitCode, hasCompleteDatabasePair } from "./report/aggregate.js";
import { formatReport } from "./report/human.js";
import { REPORT_SCHEMA_VERSION, type VerificationReport } from "./types.js";
import { VERSION } from "./version.js";
import { observeBackupVersion, observeNetworkVersion } from "./versions.js";

export function buildVerificationReport(
  input: string,
  set: BackupSetInspection,
  config: CrvConfig | null,
  now = new Date(),
): VerificationReport {
  const artifacts = set.artifacts;
  const checks = [
    checkRequiredPath(artifacts),
    checkIdentitiesStructure(artifacts),
    checkReferenceDigest(artifacts, set.manifest, set.missingArtifactPaths),
    checkOffsetOrder(
      artifacts,
      set.manifest?.declared.participantDatabase ?? config?.deployment.participantDatabase ?? null,
      set.manifest?.declared.validatorDatabase ?? config?.deployment.validatorDatabase ?? null,
      set.manifest?.declared ?? null,
    ),
    checkBackupAge(artifacts, set.manifest, config, now),
    checkSelectedIdentity(artifacts, set.manifest, config),
    checkLsuPath(artifacts, set.manifest, config),
  ];
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    tool: { name: "crv", version: VERSION },
    generatedAt: now.toISOString(),
    subject: { input, manifest: set.manifestPath, layout: set.layout },
    preconditions: aggregate(checks, hasCompleteDatabasePair(artifacts)),
    versions: {
      backup: observeBackupVersion(set),
      network: { status: "UNKNOWN", value: null, source: null, commitTs: null, detail: "Network version was not queried." },
    },
    structuralRestore: {
      status: "NOT_RUN",
      sqlRestored: null,
      participantContainerHealthy: null,
      identityMatched: null,
      networkIsolated: null,
      cleanupStatus: "NOT_RUN",
      runtime: { spliceVersion: null, participantImage: null, versionEvidence: null, testedAt: null, evidence: null },
      details: [],
    },
    artifacts,
    checks,
  };
}

export async function verify(input: string, configPath?: string, now = new Date()): Promise<VerificationReport> {
  const [set, config] = await Promise.all([
    inspectBackupSet(input),
    configPath === undefined ? Promise.resolve<CrvConfig | null>(null) : loadConfig(configPath),
  ]);
  const report = buildVerificationReport(input, set, config, now);
  report.versions.network = await observeNetworkVersion(config);
  return report;
}

export async function runVerify(input: string, json: boolean, configPath?: string): Promise<number> {
  const report = await verify(input, configPath);
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : `${formatReport(report)}\n`);
  return exitCode(report.preconditions.verdict);
}

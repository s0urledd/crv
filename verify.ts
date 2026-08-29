import { inspectBackupSet } from "./backup-set.js";
import { checkBackupAge } from "./checks/backup-age.js";
import { checkIdentitiesStructure } from "./checks/identities-structure.js";
import { checkLsuPath } from "./checks/lsu.js";
import { checkOffsetOrder } from "./checks/offset-order.js";
import { checkReferenceDigest } from "./checks/reference-digest.js";
import { checkRequiredPath } from "./checks/required-path.js";
import { checkSelectedIdentity } from "./checks/selected-identity.js";
import { loadConfig, type CrvConfig } from "./config.js";
import { aggregate, exitCode } from "./report/aggregate.js";
import { formatReport } from "./report/human.js";
import { REPORT_SCHEMA_VERSION, type VerificationReport } from "./types.js";
import { VERSION } from "./version.js";

export async function verify(input: string, configPath?: string, now = new Date()): Promise<VerificationReport> {
  const [set, config] = await Promise.all([
    inspectBackupSet(input),
    configPath === undefined ? Promise.resolve<CrvConfig | null>(null) : loadConfig(configPath),
  ]);
  const artifacts = set.artifacts;
  const checks = [
    checkRequiredPath(artifacts),
    checkIdentitiesStructure(artifacts),
    checkReferenceDigest(artifacts, set.manifest, set.missingArtifactPaths),
    checkOffsetOrder(
      artifacts,
      set.manifest?.declared.participantDatabase ?? config?.deployment.participantDatabase ?? null,
      set.manifest?.declared.validatorDatabase ?? config?.deployment.validatorDatabase ?? null,
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
    preconditions: aggregate(checks),
    structuralRestore: {
      status: "NOT_RUN",
      sqlRestored: null,
      participantServing: null,
      identityMatched: null,
      networkIsolated: null,
      details: [],
    },
    artifacts,
    checks,
  };
}

export async function runVerify(input: string, json: boolean, configPath?: string): Promise<number> {
  const report = await verify(input, configPath);
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : `${formatReport(report)}\n`);
  return exitCode(report.preconditions.verdict);
}

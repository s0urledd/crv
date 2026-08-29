import { inspectBackupSet } from "./backup-set.js";
import { checkBackupAge } from "./checks/backup-age.js";
import { checkLsuPath } from "./checks/lsu.js";
import { checkOffsetOrder } from "./checks/offset-order.js";
import { checkReferenceDigest } from "./checks/reference-digest.js";
import { checkSelectedIdentity } from "./checks/selected-identity.js";
import { checkRequiredPath } from "./checks/required-path.js";
import { aggregate, exitCode } from "./report/aggregate.js";
import { formatReport } from "./report/human.js";
import { REPORT_SCHEMA_VERSION, type VerificationReport } from "./types.js";
import { VERSION } from "./version.js";

export async function verify(input: string): Promise<VerificationReport> {
  const set = await inspectBackupSet(input);
  const artifacts = set.artifacts;
  const checks = [
    checkRequiredPath(artifacts),
    checkReferenceDigest(artifacts),
    checkOffsetOrder(artifacts),
    checkBackupAge(artifacts),
    checkSelectedIdentity(artifacts),
    checkLsuPath(artifacts),
  ];
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    tool: { name: "crv", version: VERSION },
    generatedAt: new Date().toISOString(),
    subject: { input, manifest: null, layout: set.layout },
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

export async function runVerify(input: string, json: boolean): Promise<number> {
  const report = await verify(input);
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : `${formatReport(report)}\n`);
  return exitCode(report.preconditions.verdict);
}

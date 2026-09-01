import type { CrvConfig } from "../config.js";
import { parseRfc3339DateTime, type CaptureManifest } from "../manifest.js";
import type { ArtifactInspection, CheckDefinition, CheckResult } from "../types.js";

const definition: CheckDefinition = {
  id: "backup.latest_age",
  severity: "error",
  evidenceClass: "recovery_prerequisite",
  title: "Latest participant state is inside a sourced sequencer horizon",
  proves: "The captured participant state is not older than an operator-declared effective catch-up horizon that crv does not validate.",
  method: "Compare trusted capture completion time with verification time using an operator-declared, unvalidated horizon; never infer completion from file mtime.",
  remediation: "Supply capture completion and a versioned documentation-policy or network-operator horizon, or take a new backup.",
};

export function checkBackupAge(
  artifacts: ArtifactInspection[],
  manifest: CaptureManifest | null,
  config: CrvConfig | null,
  now = new Date(),
): CheckResult {
  const applicable = artifacts.some((artifact) => artifact.roles.includes("participant") || artifact.roles.includes("cluster"));
  if (!applicable) {
    return { ...definition, applicable: false, status: "UNKNOWN", summary: "Not applicable to an identities-only recovery path.", evidence: {}, requiredEvidence: [] };
  }
  const completedAt = manifest?.declared.captureCompletedAt ?? null;
  const horizon = config?.network.sequencerHorizonSeconds ?? null;
  const source = config?.network.sequencerHorizonSource ?? null;
  const warnFraction = config?.network.backupAgeWarnFraction ?? null;
  const horizonEvidence = { horizonSeconds: horizon, horizonSource: source, horizonSourceValidated: false };
  const requiredEvidence: string[] = [];
  if (completedAt === null) requiredEvidence.push("Supply the participant capture completion time in a manifest.");
  if (horizon === null || source === null) requiredEvidence.push("Supply the effective sequencer retention horizon and its source; CRV does not silently assume 30 days.");
  if (requiredEvidence.length > 0) {
    return {
      ...definition,
      applicable: true,
      status: "UNKNOWN",
      summary: "Capture completion time and a sourced sequencer horizon were not both supplied.",
      evidence: { captureCompletedAt: completedAt, ...horizonEvidence, fileMtimeUsed: false },
      requiredEvidence,
    };
  }
  const capturedMs = parseRfc3339DateTime(completedAt as string);
  if (capturedMs === null || horizon === null || horizon <= 0) {
    return {
      ...definition, applicable: true, status: "FAIL", summary: "Capture completion or sequencer horizon is invalid.",
      evidence: { captureCompletedAt: completedAt, ...horizonEvidence }, requiredEvidence: [],
    };
  }
  const rawAgeSeconds = (now.getTime() - capturedMs) / 1000;
  if (rawAgeSeconds < -300) {
    return {
      ...definition, applicable: true, status: "FAIL", summary: "Capture completion is more than five minutes in the future.",
      evidence: { captureCompletedAt: completedAt, verificationTime: now.toISOString(), ...horizonEvidence }, requiredEvidence: [],
    };
  }
  const ageSeconds = Math.max(0, rawAgeSeconds);
  const failed = ageSeconds >= horizon;
  const warningThresholdSeconds = warnFraction === null ? null : warnFraction * horizon;
  const warned = !failed && warningThresholdSeconds !== null && ageSeconds > warningThresholdSeconds;
  if (failed) {
    return {
      ...definition,
      applicable: true,
      status: "FAIL",
      summary: `Backup age ${Math.floor(ageSeconds)}s is not below the operator-declared ${horizon}s sequencer horizon; crv does not validate its source.`,
      evidence: { captureCompletedAt: completedAt, verificationTime: now.toISOString(), ageSeconds, ...horizonEvidence },
      requiredEvidence: [],
    };
  }
  if (warned) {
    return {
      ...definition,
      applicable: true,
      status: "WARN",
      summary: `Backup age ${Math.floor(ageSeconds)}s is below the operator-declared ${horizon}s sequencer horizon but exceeds the configured ${warnFraction} warning fraction (${Math.floor(warningThresholdSeconds)}s; config.network.backupAgeWarnFraction); crv does not validate the horizon source.`,
      evidence: {
        captureCompletedAt: completedAt, verificationTime: now.toISOString(), ageSeconds,
        ...horizonEvidence, warnFraction,
        warnThresholdSeconds: warningThresholdSeconds,
        warnFractionSource: "config.network.backupAgeWarnFraction",
      },
      requiredEvidence: [],
    };
  }
  return {
    ...definition,
    applicable: true,
    status: "PASS",
    summary: `Backup age ${Math.floor(ageSeconds)}s is below the operator-declared ${horizon}s sequencer horizon; crv does not validate its source.`,
    evidence: { captureCompletedAt: completedAt, verificationTime: now.toISOString(), ageSeconds, ...horizonEvidence },
    requiredEvidence: [],
  };
}

import type { CrvConfig } from "../config.js";
import type { CaptureManifest } from "../manifest.js";
import type { ArtifactInspection, CheckDefinition, CheckResult } from "../types.js";

const definition: CheckDefinition = {
  id: "backup.latest_age",
  severity: "error",
  evidenceClass: "recovery_prerequisite",
  title: "Latest participant state is inside a sourced sequencer horizon",
  proves: "The captured participant state is not older than the supplied effective catch-up horizon.",
  method: "Compare trusted capture completion time with verification time using a sourced horizon; never infer completion from file mtime.",
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
  const requiredEvidence: string[] = [];
  if (completedAt === null) requiredEvidence.push("Supply the participant capture completion time in a manifest.");
  if (horizon === null || source === null) requiredEvidence.push("Supply the effective sequencer retention horizon and its source; CRV does not silently assume 30 days.");
  if (requiredEvidence.length > 0) {
    return {
      ...definition,
      applicable: true,
      status: "UNKNOWN",
      summary: "Capture completion time and a sourced sequencer horizon were not both supplied.",
      evidence: { captureCompletedAt: completedAt, horizonSeconds: horizon, horizonSource: source, fileMtimeUsed: false },
      requiredEvidence,
    };
  }
  const capturedMs = Date.parse(completedAt as string);
  if (!Number.isFinite(capturedMs) || horizon === null || horizon <= 0) {
    return {
      ...definition, applicable: true, status: "FAIL", summary: "Capture completion or sequencer horizon is invalid.",
      evidence: { captureCompletedAt: completedAt, horizonSeconds: horizon, horizonSource: source }, requiredEvidence: [],
    };
  }
  const rawAgeSeconds = (now.getTime() - capturedMs) / 1000;
  if (rawAgeSeconds < -300) {
    return {
      ...definition, applicable: true, status: "FAIL", summary: "Capture completion is more than five minutes in the future.",
      evidence: { captureCompletedAt: completedAt, verificationTime: now.toISOString(), horizonSeconds: horizon, horizonSource: source }, requiredEvidence: [],
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
      summary: `Backup age ${Math.floor(ageSeconds)}s is not below the sourced ${horizon}s sequencer horizon.`,
      evidence: { captureCompletedAt: completedAt, verificationTime: now.toISOString(), ageSeconds, horizonSeconds: horizon, horizonSource: source },
      requiredEvidence: [],
    };
  }
  if (warned) {
    return {
      ...definition,
      applicable: true,
      status: "WARN",
      summary: `Backup age ${Math.floor(ageSeconds)}s is below the sourced ${horizon}s sequencer horizon but exceeds the configured ${warnFraction} warning fraction (${Math.floor(warningThresholdSeconds)}s; config.network.backupAgeWarnFraction).`,
      evidence: {
        captureCompletedAt: completedAt, verificationTime: now.toISOString(), ageSeconds,
        horizonSeconds: horizon, horizonSource: source, warnFraction,
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
    summary: `Backup age ${Math.floor(ageSeconds)}s is below the sourced ${horizon}s sequencer horizon.`,
    evidence: { captureCompletedAt: completedAt, verificationTime: now.toISOString(), ageSeconds, horizonSeconds: horizon, horizonSource: source },
    requiredEvidence: [],
  };
}

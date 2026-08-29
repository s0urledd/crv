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

export function checkBackupAge(artifacts: ArtifactInspection[]): CheckResult {
  const applicable = artifacts.some((artifact) => artifact.roles.includes("participant") || artifact.roles.includes("cluster"));
  if (!applicable) {
    return {
      ...definition,
      applicable: false,
      status: "UNKNOWN",
      summary: "Not applicable to an identities-only recovery path.",
      evidence: {},
      requiredEvidence: [],
    };
  }
  return {
    ...definition,
    applicable: true,
    status: "UNKNOWN",
    summary: "Capture completion time and a sourced sequencer horizon were not both supplied.",
    evidence: { fileMtimeUsed: false },
    requiredEvidence: [
      "Supply the participant capture completion time in a manifest.",
      "Supply the effective sequencer retention horizon and its source; CRV does not silently assume 30 days.",
    ],
  };
}

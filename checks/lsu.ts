import type { ArtifactInspection, CheckDefinition, CheckResult } from "../types.js";

const definition: CheckDefinition = {
  id: "network.lsu_path",
  severity: "error",
  evidenceClass: "recovery_prerequisite",
  title: "A cross-LSU backup still has a usable synchronizer path",
  proves: "If the backup predates a logical synchronizer upgrade, the captured physical synchronizer is known to remain usable for first restore.",
  method: "Compare captured and current physical synchronizer identity/serial, then evaluate trusted old-synchronizer availability evidence.",
  remediation: "Take a post-LSU backup or supply network-operator evidence that the captured physical synchronizer remains usable.",
};

export function checkLsuPath(artifacts: ArtifactInspection[]): CheckResult {
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
    summary: "Captured/current physical synchronizer identity and old-synchronizer usability were not established.",
    evidence: {},
    requiredEvidence: [
      "Supply the captured physical synchronizer ID/serial and the current active physical synchronizer ID/serial.",
      "If they differ, supply trusted network-operator evidence that the captured synchronizer remains usable.",
    ],
  };
}

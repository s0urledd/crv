import type { CrvConfig } from "../config.js";
import type { CaptureManifest } from "../manifest.js";
import type { ArtifactInspection, CheckDefinition, CheckResult } from "../types.js";

const definition: CheckDefinition = {
  id: "network.lsu_path",
  severity: "error",
  evidenceClass: "recovery_prerequisite",
  title: "A cross-LSU backup still has a usable synchronizer path",
  proves: "If the backup predates a logical synchronizer upgrade, an operator-declared assertion says the captured physical synchronizer remains usable; crv does not validate that assertion's source.",
  method: "Compare captured and current physical synchronizer identity/serial, then report operator-declared old-synchronizer usability without validating its source.",
  remediation: "Take a post-LSU backup or supply network-operator evidence that the captured physical synchronizer remains usable.",
};

export function checkLsuPath(
  artifacts: ArtifactInspection[],
  manifest: CaptureManifest | null,
  config: CrvConfig | null,
): CheckResult {
  const applicable = artifacts.some((artifact) => artifact.roles.includes("participant") || artifact.roles.includes("cluster"));
  if (!applicable) {
    return { ...definition, applicable: false, status: "UNKNOWN", summary: "Not applicable to an identities-only recovery path.", evidence: {}, requiredEvidence: [] };
  }
  const capturedId = manifest?.declared.physicalSynchronizerId ?? null;
  const capturedSerial = manifest?.declared.physicalSynchronizerSerial ?? null;
  const currentId = config?.network.currentPhysicalSynchronizerId ?? null;
  const currentSerial = config?.network.currentPhysicalSynchronizerSerial ?? null;
  const requiredEvidence: string[] = [];
  if (capturedId === null || capturedSerial === null) requiredEvidence.push("Supply the captured physical synchronizer ID and serial in the manifest.");
  if (currentId === null || currentSerial === null) requiredEvidence.push("Supply the current active physical synchronizer ID and serial from participant admin or Scan.");
  if (requiredEvidence.length > 0) {
    return {
      ...definition, applicable: true, status: "UNKNOWN", summary: "Captured and current physical synchronizer identity were not both established.",
      evidence: { capturedId, capturedSerial, currentId, currentSerial }, requiredEvidence,
    };
  }
  const crossed = capturedId !== currentId || capturedSerial !== currentSerial;
  if (!crossed) {
    return {
      ...definition, applicable: true, status: "PASS", summary: "Captured and current physical synchronizer identity/serial match.",
      evidence: { capturedId, capturedSerial, currentId, currentSerial, crossedLsu: false }, requiredEvidence: [],
    };
  }
  const usable = config?.network.capturedPhysicalSynchronizerUsable ?? null;
  const source = config?.network.capturedPhysicalSynchronizerUsabilitySource ?? null;
  if (usable === null || source === null) {
    return {
      ...definition, applicable: true, status: "UNKNOWN", summary: "The backup crossed an LSU, but old-synchronizer usability is not sourced.",
      evidence: { capturedId, capturedSerial, currentId, currentSerial, crossedLsu: true, capturedSynchronizerUsable: usable, usabilitySource: source, usabilitySourceValidated: false },
      requiredEvidence: ["Supply a network-operator source declaring that the captured physical synchronizer remains usable or is unavailable."],
    };
  }
  return {
    ...definition,
    applicable: true,
    status: usable ? "PASS" : "FAIL",
    summary: usable
      ? "The backup crossed an LSU; an operator-declared, unvalidated assertion says the captured synchronizer remains usable."
      : "The backup crossed an LSU; an operator-declared, unvalidated assertion says the captured synchronizer is unavailable.",
    evidence: { capturedId, capturedSerial, currentId, currentSerial, crossedLsu: true, capturedSynchronizerUsable: usable, usabilitySource: source, usabilitySourceValidated: false },
    requiredEvidence: [],
  };
}

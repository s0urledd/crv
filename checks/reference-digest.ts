import type { ArtifactInspection, CheckDefinition, CheckResult } from "../types.js";

const definition: CheckDefinition = {
  id: "artifact.reference_digest",
  severity: "error",
  evidenceClass: "proven_invariant",
  title: "Artifact bytes match a capture-time reference",
  proves: "The artifact has not changed since the trusted reference digest was recorded.",
  method: "Compute SHA-256 only for artifacts with a reference digest and compare exact bytes.",
  remediation: "Supply the capture manifest containing relative artifact paths, byte sizes, and SHA-256 references.",
};

export function checkReferenceDigest(artifacts: ArtifactInspection[]): CheckResult {
  return {
    ...definition,
    applicable: artifacts.length > 0,
    status: "UNKNOWN",
    summary: "No capture-time digest references were supplied.",
    evidence: { inspectedArtifacts: artifacts.length },
    requiredEvidence: ["Supply a manifest with capture-time SHA-256 and size references for each selected artifact."],
  };
}

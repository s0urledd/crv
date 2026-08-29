import type { ArtifactInspection, CheckDefinition, CheckResult } from "../types.js";

const definition: CheckDefinition = {
  id: "backup.required_path",
  severity: "error",
  evidenceClass: "proven_invariant",
  title: "A database pair or identities fallback exists",
  proves: "The set contains at least one artifact path documented for recovery.",
  method: "Find both participant and validator database evidence, or a structurally recognized identities export.",
  remediation: "Provide the missing participant/validator dump or a validator identities export.",
};

export function checkRequiredPath(artifacts: ArtifactInspection[]): CheckResult {
  const roles = new Set(artifacts.flatMap((artifact) => artifact.roles));
  const databasePair = roles.has("participant") && roles.has("validator");
  const identities = roles.has("identities");
  const pass = databasePair || identities;
  return {
    ...definition,
    applicable: true,
    status: pass ? "PASS" : "FAIL",
    summary: pass
      ? databasePair
        ? "Participant and validator database evidence are present."
        : "An identities fallback artifact is present."
      : "Neither a participant/validator database pair nor an identities fallback was found.",
    evidence: { databasePair, identitiesFallback: identities },
    requiredEvidence: [],
  };
}

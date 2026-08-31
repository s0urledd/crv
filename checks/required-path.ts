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
  const databaseArtifacts = artifacts.filter((artifact) => artifact.roles.includes("database"));
  const identities = roles.has("identities");
  if (databasePair || identities) {
    return {
      ...definition,
      applicable: true,
      status: "PASS",
      summary: databasePair
        ? "Participant and validator database evidence are present."
        : "An identities fallback artifact is present.",
      evidence: { databasePair, databaseArtifacts: databaseArtifacts.map((artifact) => artifact.path), identitiesFallback: identities },
      requiredEvidence: [],
    };
  }
  if (databaseArtifacts.length > 0) {
    return {
      ...definition,
      applicable: true,
      status: "UNKNOWN",
      summary: "Database artifacts are present, but a participant and validator pair could not be established.",
      evidence: { databasePair: false, databaseArtifacts: databaseArtifacts.map((artifact) => artifact.path), identitiesFallback: false },
      requiredEvidence: ["Identify one participant and one validator database artifact in a capture manifest, or provide dumps with a recognized intrinsic schema."],
    };
  }
  return {
    ...definition,
    applicable: true,
    status: "FAIL",
    summary: "No database artifact or identities fallback was found.",
    evidence: { databasePair: false, databaseArtifacts: [], identitiesFallback: false },
    requiredEvidence: [],
  };
}

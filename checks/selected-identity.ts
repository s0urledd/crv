import type { ArtifactInspection, CheckDefinition, CheckResult } from "../types.js";

const definition: CheckDefinition = {
  id: "deployment.selected_identity",
  severity: "error",
  evidenceClass: "proven_invariant",
  title: "Selected participant database contains the expected identity",
  proves: "The database selected by the deployment is the database carrying the backup set's expected participant identity.",
  method: "Read identity from the selected restored database and compare it with trusted set or identities-export evidence.",
  remediation: "Supply the effective participant database and expected participant ID, then run the isolated drill.",
};

export function checkSelectedIdentity(artifacts: ArtifactInspection[]): CheckResult {
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
    summary: "The effective participant database and expected participant identity were not both established.",
    evidence: {},
    requiredEvidence: [
      "Supply the effective participant database name from deployment configuration.",
      "Supply expected participant identity evidence from the identities export, manifest, or isolated restored database.",
    ],
  };
}

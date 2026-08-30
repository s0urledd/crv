import type { ArtifactInspection, CheckDefinition, CheckResult } from "../types.js";

const definition: CheckDefinition = {
  id: "identities.structure",
  severity: "error",
  evidenceClass: "structural_validation",
  title: "Identities export has the required offline structure",
  proves: "The export is parseable and contains a participant ID, version, topology snapshot, and required base64 key pairs.",
  method: "Validate JSON types, canonical participant ID prefix, strict base64, and namespace/signing/encryption key names without exposing key bytes.",
  remediation: "Replace the invalid export with a newly captured identities backup; never edit key material by hand.",
};

export function checkIdentitiesStructure(artifacts: ArtifactInspection[]): CheckResult {
  const identities = artifacts.filter((artifact) => artifact.roles.includes("identities"));
  if (identities.length === 0) {
    return {
      ...definition,
      applicable: false,
      status: "UNKNOWN",
      summary: "No identities export is present in this recovery path.",
      evidence: {},
      requiredEvidence: [],
    };
  }
  const invalid = identities.filter((artifact) => artifact.identityStructureValid !== true);
  const databasePair = artifacts.some((artifact) => artifact.roles.includes("participant") || artifact.roles.includes("cluster")) &&
    artifacts.some((artifact) => artifact.roles.includes("validator") || artifact.roles.includes("cluster"));
  const status = invalid.length === 0 ? "PASS" : databasePair ? "WARN" : "FAIL";
  return {
    ...definition,
    applicable: true,
    status,
    summary: invalid.length === 0
      ? `${identities.length} identities export(s) passed structural validation.`
      : databasePair
        ? `${invalid.length} identities export(s) are invalid; the separate database recovery path remains available.`
        : `${invalid.length} identities export(s) are invalid and no separate database recovery path is present.`,
    evidence: {
      inspected: identities.length,
      invalid: invalid.map((artifact) => artifact.path),
      keyMaterialReported: false,
    },
    requiredEvidence: [],
  };
}

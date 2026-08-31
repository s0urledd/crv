import type { CrvConfig } from "../config.js";
import type { CaptureManifest } from "../manifest.js";
import type { ArtifactInspection, CheckDefinition, CheckResult } from "../types.js";

const definition: CheckDefinition = {
  id: "deployment.selected_identity",
  severity: "error",
  evidenceClass: "proven_invariant",
  title: "Selected participant database contains the expected identity",
  proves: "The database selected by the deployment is the database carrying the backup set's expected participant identity.",
  method: "Read identity from the selected restored database and compare it with trusted set or identities-export evidence.",
  remediation: "Supply the effective participant database and expected participant ID, then run crv drill.",
};

export interface RestoredIdentityEvidence {
  database: string;
  participantId: string | null;
  rowCount: number;
}

export function checkSelectedIdentity(
  artifacts: ArtifactInspection[],
  manifest: CaptureManifest | null,
  config: CrvConfig | null,
  restored: RestoredIdentityEvidence | null = null,
): CheckResult {
  const applicable = artifacts.some((artifact) => artifact.roles.includes("participant") || artifact.roles.includes("cluster"));
  if (!applicable) {
    return { ...definition, applicable: false, status: "UNKNOWN", summary: "Not applicable to an identities-only recovery path.", evidence: {}, requiredEvidence: [] };
  }
  const identityArtifacts = artifacts
    .filter((artifact) => artifact.identityStructureValid === true && artifact.participantId !== null)
    .map((artifact) => ({ path: artifact.path, participantId: artifact.participantId as string }));
  const sources = [
    ...identityArtifacts.map((artifact) => ({ source: `artifact:${artifact.path}`, value: artifact.participantId })),
    ...(manifest?.declared.expectedParticipantId ? [{ source: "manifest:expectedParticipantId", value: manifest.declared.expectedParticipantId }] : []),
    ...(config?.deployment.expectedParticipantId ? [{ source: "config:expectedParticipantId", value: config.deployment.expectedParticipantId }] : []),
  ];
  const expectedValues = [...new Set(sources.map((source) => source.value))];
  if (expectedValues.length > 1) {
    return {
      ...definition,
      applicable: true,
      status: "FAIL",
      summary: "Trusted expected participant identity sources disagree.",
      evidence: { identitySources: sources },
      requiredEvidence: [],
    };
  }
  const expectedParticipantId = expectedValues[0] ?? null;
  const selectedDatabase = config?.deployment.participantDatabase ?? manifest?.declared.participantDatabase ?? null;
  if (restored !== null) {
    const identityMatches = expectedParticipantId !== null && restored.participantId === expectedParticipantId;
    return {
      ...definition,
      applicable: true,
      status: identityMatches ? "PASS" : "FAIL",
      summary: identityMatches
        ? "The selected restored database contains the expected participant identity."
        : "The selected restored database does not contain the expected participant identity.",
      evidence: { selectedDatabase, restoredDatabase: restored.database, expectedParticipantId, restoredParticipantId: restored.participantId, rowCount: restored.rowCount },
      requiredEvidence: [],
    };
  }
  const requiredEvidence: string[] = [];
  if (selectedDatabase === null) requiredEvidence.push("Supply the effective participant database name from deployment configuration or the capture manifest.");
  if (expectedParticipantId === null) requiredEvidence.push("Supply expected participant identity evidence from a structurally valid identities export, manifest, or operator config.");
  requiredEvidence.push("Run crv drill so CRV can read the participant ID from the selected restored database offline.");
  return {
    ...definition,
    applicable: true,
    status: "UNKNOWN",
    summary: "Fast verification cannot read participant identity from the selected database without an isolated restore.",
    evidence: { selectedDatabase, expectedParticipantId, identitySources: sources },
    requiredEvidence,
  };
}

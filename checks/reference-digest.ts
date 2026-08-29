import type { CaptureManifest } from "../manifest.js";
import type { ArtifactInspection, CheckDefinition, CheckResult } from "../types.js";

const definition: CheckDefinition = {
  id: "artifact.reference_digest",
  severity: "error",
  evidenceClass: "proven_invariant",
  title: "Artifact bytes match a capture-time reference",
  proves: "The artifact has not changed since the trusted reference digest was recorded.",
  method: "Compute SHA-256 only for artifacts with a reference digest and compare exact bytes and sizes.",
  remediation: "Replace changed/missing artifacts from trusted storage, or capture and manifest a new complete set.",
};

export function checkReferenceDigest(
  artifacts: ArtifactInspection[],
  manifest: CaptureManifest | null,
  missingArtifactPaths: string[],
): CheckResult {
  if (manifest === null) {
    if (artifacts.length === 0) {
      return { ...definition, applicable: false, status: "UNKNOWN", summary: "No recognized artifacts are present.", evidence: {}, requiredEvidence: [] };
    }
    return {
      ...definition,
      applicable: true,
      status: "UNKNOWN",
      summary: "No capture-time digest references were supplied.",
      evidence: { inspectedArtifacts: artifacts.length },
      requiredEvidence: ["Supply a manifest with capture-time SHA-256 and size references for each selected artifact."],
    };
  }

  const current = new Map(artifacts.map((artifact) => [artifact.path, artifact]));
  const mismatches: Array<Record<string, string | number | null>> = [];
  for (const reference of manifest.artifacts) {
    const artifact = current.get(reference.path);
    if (!artifact) continue;
    if (artifact.sizeBytes !== reference.sizeBytes || artifact.sha256 !== reference.sha256) {
      mismatches.push({
        path: reference.path,
        expectedSizeBytes: reference.sizeBytes,
        actualSizeBytes: artifact.sizeBytes,
        expectedSha256: reference.sha256,
        actualSha256: artifact.sha256,
      });
    }
  }
  const failed = manifest.artifacts.length === 0 || missingArtifactPaths.length > 0 || mismatches.length > 0;
  return {
    ...definition,
    applicable: true,
    status: failed ? "FAIL" : "PASS",
    summary: failed
      ? `${missingArtifactPaths.length} referenced artifact(s) are missing and ${mismatches.length} differ from capture-time references.`
      : `${manifest.artifacts.length} artifact(s) match capture-time size and SHA-256 references.`,
    evidence: {
      referencedArtifacts: manifest.artifacts.length,
      missingArtifacts: missingArtifactPaths,
      mismatches,
    },
    requiredEvidence: [],
  };
}

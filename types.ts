export const REPORT_SCHEMA_VERSION = "1.0" as const;

export type EvidenceClass =
  | "proven_invariant"
  | "recovery_prerequisite"
  | "heuristic"
  | "structural_validation"
  | "unverifiable";

export type CheckStatus = "PASS" | "FAIL" | "WARN" | "UNKNOWN";
export type CheckSeverity = "error" | "warning" | "info";
export type PreconditionsVerdict = "MET" | "AT_RISK" | "FAILED" | "INDETERMINATE";
export type StructuralStatus = "NOT_RUN" | "PASSED" | "FAILED";

export interface CheckDefinition {
  id: string;
  severity: CheckSeverity;
  evidenceClass: EvidenceClass;
  title: string;
  proves: string;
  method: string;
  remediation: string;
}

export type EvidenceValue = string | number | boolean | null | EvidenceValue[] | { [key: string]: EvidenceValue };

export interface CheckResult extends CheckDefinition {
  applicable: boolean;
  status: CheckStatus;
  summary: string;
  evidence: Record<string, EvidenceValue>;
  requiredEvidence: string[];
}

export type ArtifactFormat = "plain_dump" | "custom_dump" | "cluster_dump" | "identities_json" | "unknown";
export type ArtifactRole = "participant" | "validator" | "identities" | "cluster" | "unknown";
export type ArtifactCompression = "none" | "gzip" | "zstd" | "xz" | "bzip2" | "unknown";
export type BackupSetLayout = "single_artifact" | "per_database" | "cluster" | "identities_only" | "mixed" | "unknown";

export interface OffsetEvidence {
  database: string | null;
  participantLedgerEnd?: string;
  validatorLastIngested?: string;
  validatorMigrationId?: string;
}

export interface ArtifactInspection {
  path: string;
  format: ArtifactFormat;
  compression: ArtifactCompression;
  roles: ArtifactRole[];
  sizeBytes: number;
  sha256: string | null;
  sourceDatabase: string | null;
  databases: string[];
  postgresSourceVersion: string | null;
  postgresDumperVersion: string | null;
  archiveCreatedAt: string | null;
  spliceVersion: string | null;
  offsets: OffsetEvidence[];
  limitations: string[];
}

export interface StructuralEvidence {
  status: StructuralStatus;
  sqlRestored: boolean | null;
  participantServing: boolean | null;
  identityMatched: boolean | null;
  networkIsolated: boolean | null;
  details: string[];
}

export interface VerificationReport {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  tool: { name: "crv"; version: string };
  generatedAt: string;
  subject: { input: string; manifest: string | null; layout: BackupSetLayout };
  preconditions: {
    verdict: PreconditionsVerdict;
    pass: number;
    fail: number;
    warn: number;
    unknown: number;
  };
  structuralRestore: StructuralEvidence;
  artifacts: ArtifactInspection[];
  checks: CheckResult[];
}

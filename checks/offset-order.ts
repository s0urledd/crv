import { compatibility } from "../compatibility.js";
import type { ArtifactInspection, CheckDefinition, CheckResult } from "../types.js";

const definition: CheckDefinition = {
  id: "backup.offset_order",
  severity: "error",
  evidenceClass: "proven_invariant",
  title: "Validator offset does not exceed participant ledger end",
  proves: "Validator state does not intrinsically reference a Ledger API offset absent from the participant artifact.",
  method: "Compare validator.store_last_ingested_offsets for the latest captured migration with participant.lapi_parameters.ledger_end.",
  remediation: "Discard the inconsistent pair and use a participant backup captured after the validator backup.",
};

interface Candidate {
  artifact: string;
  database: string | null;
  value: bigint;
  migrationId?: string;
}

export interface DeclaredCaptureOrder {
  validatorCompletedAt: string | null;
  participantStartedAt: string | null;
}

interface CaptureOrderContext {
  evidence: Record<string, string | boolean | string[]>;
  limitation: string | null;
}

function captureOrderContext(declared: DeclaredCaptureOrder | null): CaptureOrderContext {
  if (declared === null || declared.validatorCompletedAt === null || declared.participantStartedAt === null) {
    return { evidence: {}, limitation: null };
  }
  const weakensGuarantee = Date.parse(declared.participantStartedAt) < Date.parse(declared.validatorCompletedAt);
  const limitation = weakensGuarantee
    ? "Declared capture order weakens the guarantee because participant capture started before the validator dump completed."
    : null;
  return {
    evidence: {
      validatorCompletedAt: declared.validatorCompletedAt,
      participantStartedAt: declared.participantStartedAt,
      participantStartedBeforeValidatorCompleted: weakensGuarantee,
      ...(limitation === null ? {} : { limitations: [limitation] }),
    },
    limitation,
  };
}

function withCaptureOrderLimitation(summary: string, context: CaptureOrderContext): string {
  return context.limitation === null ? summary : summary + " " + context.limitation;
}

function candidates(
  artifacts: ArtifactInspection[],
  key: "participantLedgerEnd" | "validatorLastIngested",
  selectedDatabase: string | null,
): Candidate[] {
  const output: Candidate[] = [];
  for (const artifact of artifacts) {
    for (const offset of artifact.offsets) {
      if (selectedDatabase !== null && offset.database !== null && offset.database !== selectedDatabase) continue;
      const raw = offset[key];
      if (raw === undefined || !/^\d+$/.test(raw)) continue;
      output.push({
        artifact: artifact.path,
        database: offset.database,
        value: BigInt(raw),
        ...(offset.validatorMigrationId === undefined ? {} : { migrationId: offset.validatorMigrationId }),
      });
    }
  }
  return output;
}

function candidateEvidence(candidate: Candidate): Record<string, string | null> {
  return {
    artifact: candidate.artifact,
    database: candidate.database,
    value: candidate.value.toString(10),
    ...(candidate.migrationId === undefined ? {} : { migrationId: candidate.migrationId }),
  };
}

export function checkOffsetOrder(
  artifacts: ArtifactInspection[],
  participantDatabase: string | null = null,
  validatorDatabase: string | null = null,
  declaredCaptureOrder: DeclaredCaptureOrder | null = null,
): CheckResult {
  const captureOrder = captureOrderContext(declaredCaptureOrder);
  const participant = candidates(artifacts, "participantLedgerEnd", participantDatabase);
  const validator = candidates(artifacts, "validatorLastIngested", validatorDatabase);
  const hasDatabaseRole = artifacts.some(
    (artifact) => artifact.roles.includes("database"),
  );
  if (!hasDatabaseRole) {
    return {
      ...definition,
      applicable: false,
      status: "UNKNOWN",
      summary: "Not applicable to an identities-only recovery path.",
      evidence: {},
      requiredEvidence: [],
    };
  }
  if (participant.length !== 1 || validator.length !== 1) {
    const unrecognizedTables = [...new Set(artifacts.flatMap((artifact) => artifact.unrecognizedOffsetTables))].sort();
    const knownFamilies = compatibility.schemaFamilies.filter((family) => family.checks.includes("backup.offset_order")).map((family) => family.id).sort();
    const requirements = [
      "Provide one participant artifact containing participant.lapi_parameters.ledger_end and one validator artifact containing validator.store_last_ingested_offsets, or an unambiguous pg_dumpall containing both.",
    ];
    if (unrecognizedTables.length > 0) {
      requirements.unshift("Review offset table(s) " + unrecognizedTables.join(", ") + " against known schema families " + knownFamilies.join(", ") + "; add a compatibility family only after review.");
    }
    if (artifacts.some((artifact) => artifact.format === "cluster_dump") && (participantDatabase === null || validatorDatabase === null)) {
      requirements.push("For a multi-database pg_dumpall, supply the captured participant and validator database names in the manifest.");
    }
    return {
      ...definition,
      applicable: true,
      status: "UNKNOWN",
      summary: withCaptureOrderLimitation(unrecognizedTables.length > 0
        ? "Offset ordering is unknown because offset-like table(s) " + unrecognizedTables.join(", ") + " do not match known schema families " + knownFamilies.join(", ") + "."
        : "Exactly one participant ledger end and one validator offset could not be selected.", captureOrder),
      evidence: {
        participantCandidates: participant.length,
        validatorCandidates: validator.length,
        selectedParticipantDatabase: participantDatabase,
        selectedValidatorDatabase: validatorDatabase,
        unrecognizedOffsetTables: unrecognizedTables,
        knownSchemaFamilies: knownFamilies,
        ...captureOrder.evidence,
      },
      requiredEvidence: requirements,
    };
  }

  const participantValue = participant[0];
  const validatorValue = validator[0];
  if (!participantValue || !validatorValue) throw new Error("offset candidate selection failed");
  const failed = validatorValue.value > participantValue.value;
  return {
    ...definition,
    applicable: true,
    status: failed ? "FAIL" : "PASS",
    summary: withCaptureOrderLimitation(failed
      ? `Validator offset ${validatorValue.value} exceeds participant ledger end ${participantValue.value}.`
      : `Validator offset ${validatorValue.value} does not exceed participant ledger end ${participantValue.value}.`, captureOrder),
    evidence: {
      participant: candidateEvidence(participantValue),
      validator: candidateEvidence(validatorValue),
      relation: failed ? ">" : "<=",
      selectedParticipantDatabase: participantDatabase,
      selectedValidatorDatabase: validatorDatabase,
      ...captureOrder.evidence,
    },
    requiredEvidence: [],
  };
}

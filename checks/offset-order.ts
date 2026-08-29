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

function candidates(artifacts: ArtifactInspection[], key: "participantLedgerEnd" | "validatorLastIngested"): Candidate[] {
  const output: Candidate[] = [];
  for (const artifact of artifacts) {
    for (const offset of artifact.offsets) {
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

export function checkOffsetOrder(artifacts: ArtifactInspection[]): CheckResult {
  const participant = candidates(artifacts, "participantLedgerEnd");
  const validator = candidates(artifacts, "validatorLastIngested");
  const hasDatabaseRole = artifacts.some(
    (artifact) => artifact.roles.includes("participant") || artifact.roles.includes("validator") || artifact.roles.includes("cluster"),
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
    return {
      ...definition,
      applicable: true,
      status: "UNKNOWN",
      summary: "Exactly one participant ledger end and one validator offset could not be selected.",
      evidence: { participantCandidates: participant.length, validatorCandidates: validator.length },
      requiredEvidence: [
        "Provide one participant artifact containing participant.lapi_parameters.ledger_end and one validator artifact containing validator.store_last_ingested_offsets, or an unambiguous pg_dumpall containing both.",
      ],
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
    summary: failed
      ? `Validator offset ${validatorValue.value} exceeds participant ledger end ${participantValue.value}.`
      : `Validator offset ${validatorValue.value} does not exceed participant ledger end ${participantValue.value}.`,
    evidence: {
      participant: candidateEvidence(participantValue),
      validator: candidateEvidence(validatorValue),
      relation: failed ? ">" : "<=",
    },
    requiredEvidence: [],
  };
}

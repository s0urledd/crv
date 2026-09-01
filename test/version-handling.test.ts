import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inspectArtifact } from "../artifact.js";
import { checkOffsetOrder } from "../checks/offset-order.js";
import { checkRequiredPath } from "../checks/required-path.js";
import { recognizeOffsetShape } from "../compatibility.js";
import { loadConfig, type CrvConfig } from "../config.js";
import { observeNetworkVersion } from "../versions.js";

function config(scanVersionUrl: string | null): CrvConfig {
  return {
    schemaVersion: "1.0",
    deployment: { participantDatabase: null, validatorDatabase: null, expectedParticipantId: null },
    network: {
      scanVersionUrl,
      sequencerHorizonSeconds: null,
      sequencerHorizonSource: null,
      backupAgeWarnFraction: null,
      currentPhysicalSynchronizerId: null,
      currentPhysicalSynchronizerSerial: null,
      capturedPhysicalSynchronizerUsable: null,
      capturedPhysicalSynchronizerUsabilitySource: null,
    },
    watch: { statePath: ".crv/state.json", reportsPath: "crv-reports", intervalSeconds: 86400 },
  };
}

test("binds D2 parsing to an exact schema family shape", () => {
  assert.deepEqual(
    recognizeOffsetShape(
      "validator.store_last_ingested_offsets",
      ["store_id", "migration_id", "last_ingested_offset"],
    ),
    { familyId: "splice-d2-offset-v1", role: "validator" },
  );
  assert.equal(
    recognizeOffsetShape(
      "validator.store_last_ingested_offsets",
      ["store_id", "migration_id", "last_ingested_offset", "future_column"],
    ),
    null,
  );
});

test("keeps a known role but makes D2 UNKNOWN for an unknown column shape", async () => {
  const root = await mkdtemp(join(tmpdir(), "crv-unknown-shape-"));
  const participantPath = join(root, "participant.sql");
  const validatorPath = join(root, "validator.sql");
  try {
    await writeFile(participantPath, `-- PostgreSQL database dump
-- Dumped from database version 14.24
-- Dumped by pg_dump version 14.24
COPY participant.lapi_parameters (ledger_end, participant_id, future_column) FROM stdin;
999\tparticipant\tfuture
\\.
`);
    await writeFile(validatorPath, `-- PostgreSQL database dump
-- Dumped from database version 14.24
-- Dumped by pg_dump version 14.24
COPY validator.store_last_ingested_offsets (store_id, migration_id, last_ingested_offset) FROM stdin;
1\t0\t000000000000000001
\\.
`);
    const participant = await inspectArtifact(participantPath);
    const validator = await inspectArtifact(validatorPath);
    assert.deepEqual(participant.roles, ["database", "participant"]);
    assert.deepEqual(participant.offsets, []);
    assert.deepEqual(participant.schemaFamilies, []);
    assert.match(participant.limitations.join(" "), /Unrecognized offset-like table/);
    assert.equal(checkOffsetOrder([participant, validator]).status, "UNKNOWN");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps network version offline unless Scan is configured", async () => {
  let called = false;
  const observation = await observeNetworkVersion(config(null), async () => {
    called = true;
    throw new Error("must not fetch");
  });
  assert.equal(called, false);
  assert.equal(observation.status, "UNKNOWN");
  assert.match(observation.detail, /remained offline/);
});

test("reports a configured public Scan version without affecting checks", async () => {
  const observation = await observeNetworkVersion(
    config("https://scan.example/api/scan/version"),
    async () => new Response(JSON.stringify({
      version: "0.6.14",
      commit_ts: "2026-08-30T00:00:00Z",
    }), { status: 200, headers: { "content-type": "application/json" } }),
  );
  assert.deepEqual(observation, {
    status: "OBSERVED",
    value: "0.6.14",
    source: "https://scan.example/api/scan/version",
    commitTs: "2026-08-30T00:00:00Z",
    detail: "Network version reported by the configured public Scan API.",
  });
});

test("reports an unreachable Scan endpoint as UNKNOWN", async () => {
  const observation = await observeNetworkVersion(
    config("https://scan.example/api/scan/version"),
    async () => { throw new Error("offline"); },
  );
  assert.equal(observation.status, "UNKNOWN");
  assert.match(observation.detail, /does not fail backup verification/);
});

test("accepts only the public Scan version path", async () => {
  const root = await mkdtemp(join(tmpdir(), "crv-scan-config-"));
  const path = join(root, "crv.yaml");
  try {
    await writeFile(path, `schemaVersion: "1.0"
network:
  scanVersionUrl: https://scan.example/not-version
`);
    await assert.rejects(() => loadConfig(path), /must be an HTTP\(S\) \/api\/scan\/version URL/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps renamed offset tables as database artifacts and degrades dependent checks", async () => {
  const root = await mkdtemp(join(tmpdir(), "crv-renamed-table-"));
  const participantPath = join(root, "participant.sql");
  const validatorPath = join(root, "validator.sql");
  try {
    const header = "-- PostgreSQL database dump\n-- Dumped from database version 14.24\n-- Dumped by pg_dump version 14.24\n";
    await writeFile(participantPath, header + "COPY participant.renamed_lapi_parameters (ledger_end, participant_id, participant_pruned_up_to_inclusive, ledger_end_sequential_id, ledger_end_string_interning_id, ledger_end_publication_time) FROM stdin;\n65\tparticipant\t\\N\t1\t1\t2026-08-30 00:00:00+00\n\\.\n");
    await writeFile(validatorPath, header + "COPY validator.store_last_ingested_offsets (store_id, migration_id, last_ingested_offset) FROM stdin;\n1\t0\t000000000000000040\n\\.\n");
    const participant = await inspectArtifact(participantPath);
    const validator = await inspectArtifact(validatorPath);
    assert.deepEqual(participant.roles, ["database"]);
    assert.deepEqual(participant.unrecognizedOffsetTables, ["participant.renamed_lapi_parameters"]);
    const requiredPath = checkRequiredPath([participant, validator]);
    assert.equal(requiredPath.status, "UNKNOWN");
    assert.notEqual(requiredPath.status, "FAIL");
    const ordering = checkOffsetOrder([participant, validator]);
    assert.equal(ordering.status, "UNKNOWN");
    assert.match(ordering.summary, /participant\.renamed_lapi_parameters/);
    assert.match(ordering.summary, /splice-d2-offset-v1/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

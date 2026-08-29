import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { inspectArtifact } from "../artifact.js";

const fixture = (...parts: string[]) => resolve(process.cwd(), "test", "fixtures", ...parts);
const identities = (keyPair: string) => ({
  id: "PAR::participant::localnet-fixture",
  version: "0.6.11",
  authorizedStoreSnapshot: "Ag==",
  keys: ["namespace", "signing", "encryption"].map((name) => ({ name, keyPair })),
});

test("inspects participant offset from a plain dump", async () => {
  const artifact = await inspectArtifact(fixture("good", "participant.sql"));
  assert.equal(artifact.format, "plain_dump");
  assert.deepEqual(artifact.roles, ["participant"]);
  assert.equal(artifact.offsets[0]?.participantLedgerEnd, "65");
  assert.equal(artifact.postgresSourceVersion, "14.24");
});

test("inspects database sections and offsets from pg_dumpall", async () => {
  const artifact = await inspectArtifact(fixture("cluster", "cluster.sql"));
  assert.equal(artifact.format, "cluster_dump");
  assert.deepEqual(artifact.databases, ["participant-app-provider", "validator-app-provider"]);
  assert.equal(artifact.offsets[0]?.participantLedgerEnd, "65");
  assert.equal(artifact.offsets[1]?.validatorLastIngested, "63");
});

test("validates identities structure without reporting key bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "crv-identities-"));
  const path = join(directory, "identities.json");
  try {
    await writeFile(path, JSON.stringify(identities("AQ==")));
    const artifact = await inspectArtifact(path);
    assert.equal(artifact.identityStructureValid, true);
    assert.equal(artifact.participantId, "PAR::participant::localnet-fixture");
    assert.doesNotMatch(JSON.stringify(artifact), /AQ==/);

    await writeFile(path, JSON.stringify(identities("not-base64")));
    const invalid = await inspectArtifact(path);
    assert.equal(invalid.identityStructureValid, false);
    assert.match(invalid.limitations.join(" "), /not strict base64/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const [compression, filename, command] of [
  ["gzip", "participant.sql.gz", null],
  ["xz", "participant.sql.xz", "xz"],
  ["bzip2", "participant.sql.bz2", "bzip2"],
  ["zstd", "participant.sql.zst", "zstd"],
] as const) {
  const available = command === null || spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0;
  test("inspects " + compression + " by magic", { skip: !available }, async () => {
    const artifact = await inspectArtifact(fixture("compressed", filename));
    assert.equal(artifact.compression, compression);
    assert.equal(artifact.offsets[0]?.participantLedgerEnd, "65");
  });
}

test("extracts custom archive offsets with pg_restore stdout mode", async () => {
  const directory = await mkdtemp(join(tmpdir(), "crv-custom-"));
  const archive = join(directory, "participant.dump");
  const executable = join(directory, "pg_restore");
  const previousPath = process.env.PATH;
  try {
    await writeFile(archive, Buffer.from("PGDMPfixture"));
    await writeFile(executable, `#!/usr/bin/env bash
set -euo pipefail
if [[ " $* " == *" -l "* ]]; then
  printf "; Archive created at 2026-08-29 00:00:00 UTC\\n;     dbname: participant-app-provider\\n;     Dumped from database version: 14.24\\n;     Dumped by pg_dump version: 14.24\\n"
elif [[ " $* " == *" -t lapi_parameters -f - "* ]]; then
  printf "COPY participant.lapi_parameters (ledger_end, participant_id) FROM stdin;\\n65\\tparticipant\\n\\\\.\\n"
elif [[ " $* " == *" -t store_last_ingested_offsets -f - "* ]]; then
  exit 0
else
  exit 9
fi
`, { mode: 0o755 });
    process.env.PATH = directory + ":" + (previousPath ?? "");
    const artifact = await inspectArtifact(archive);
    assert.equal(artifact.format, "custom_dump");
    assert.deepEqual(artifact.roles, ["participant"]);
    assert.equal(artifact.sourceDatabase, "participant-app-provider");
    assert.equal(artifact.offsets[0]?.participantLedgerEnd, "65");
  } finally {
    process.env.PATH = previousPath;
    await rm(directory, { recursive: true, force: true });
  }
});

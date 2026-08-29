import assert from "node:assert/strict";
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

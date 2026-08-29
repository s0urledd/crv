import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { inspectArtifact } from "../artifact.js";

const fixture = (...parts: string[]) => resolve(process.cwd(), "test", "fixtures", ...parts);

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

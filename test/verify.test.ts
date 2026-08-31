import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { inspectArtifact } from "../artifact.js";
import { checkOffsetOrder } from "../checks/offset-order.js";
import { exitCode } from "../report/aggregate.js";
import { verify } from "../verify.js";

const fixture = (name: string) => resolve(process.cwd(), "test", "fixtures", name);

const syntheticIdentities = () => ({
  id: "PAR::synthetic-validator::1220" + "d".repeat(64),
  version: "0.6.11",
  authorizedStoreSnapshot: "Ag==",
  keys: ["namespace", "signing", "encryption"].map((name) => ({ name, keyPair: "AQ==" })),
});

test("passes the intrinsic offset check without claiming all preconditions are met", async () => {
  const report = await verify(fixture("good"));
  assert.equal(report.preconditions.verdict, "INDETERMINATE");
  assert.equal(report.checks.find((check) => check.id === "backup.offset_order")?.status, "PASS");
  assert.equal(report.structuralRestore.status, "NOT_RUN");
});

test("fails a dangerous reversed pair before restore", async () => {
  const report = await verify(fixture("reversed"));
  assert.equal(report.preconditions.verdict, "FAILED");
  const ordering = report.checks.find((check) => check.id === "backup.offset_order");
  assert.equal(ordering?.status, "FAIL");
  assert.match(ordering?.summary ?? "", /66 exceeds participant ledger end 65/);
});

test("inspects a whole-cluster dump without claiming all preconditions are met", async () => {
  const report = await verify(fixture("cluster"));
  assert.equal(report.preconditions.verdict, "INDETERMINATE");
  assert.equal(report.artifacts[0]?.format, "cluster_dump");
});


test("requires declared database selection for multi-database pg_dumpall", async () => {
  const artifact = await inspectArtifact(resolve(fixture("cluster"), "cluster.sql"));
  artifact.offsets.push(
    { database: "participant-other", participantLedgerEnd: "100" },
    { database: "validator-other", validatorLastIngested: "99", validatorMigrationId: "0" },
  );
  assert.equal(checkOffsetOrder([artifact]).status, "UNKNOWN");
  const selected = checkOffsetOrder([artifact], "participant-app-provider", "validator-app-provider");
  assert.equal(selected.status, "PASS");
  assert.equal((selected.evidence.participant as { database: string }).database, "participant-app-provider");
});

test("caps identities-only fallback and names an incomplete database pair", async () => {
  const root = await mkdtemp(join(tmpdir(), "crv-identities-fallback-"));
  const identitiesOnly = join(root, "identities-only");
  const halfPair = join(root, "half-pair");
  try {
    await cp(fixture("good"), halfPair, { recursive: true });
    await rm(join(halfPair, "validator.sql"));
    await writeFile(join(halfPair, "identities.json"), JSON.stringify(syntheticIdentities()));
    await cp(halfPair, identitiesOnly, { recursive: true });
    await rm(join(identitiesOnly, "participant.sql"));

    const identitiesReport = await verify(identitiesOnly);
    const identitiesPath = identitiesReport.checks.find((check) => check.id === "backup.required_path");
    assert.equal(identitiesReport.subject.layout, "identities_only");
    assert.equal(identitiesPath?.status, "PASS");
    assert.equal(identitiesReport.preconditions.verdict, "INDETERMINATE");
    assert.equal(exitCode(identitiesReport.preconditions.verdict), 3);

    const halfReport = await verify(halfPair);
    const halfPath = halfReport.checks.find((check) => check.id === "backup.required_path");
    assert.equal(halfPath?.status, "PASS");
    assert.equal(halfPath?.summary, "An identities fallback artifact is present; database artifacts are present but do not form a complete pair.");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("contains a corrupt side artifact without aborting a valid pair", async () => {
  const root = await mkdtemp(join(tmpdir(), "crv-corrupt-side-artifact-"));
  try {
    await cp(fixture("good"), root, { recursive: true });
    await writeFile(join(root, "truncated.sql.gz"), Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x01]));
    const baseline = await verify(fixture("good"));
    const report = await verify(root);
    const corrupt = report.artifacts.find((artifact) => artifact.path === "truncated.sql.gz");
    assert.equal(report.preconditions.verdict, baseline.preconditions.verdict);
    assert.equal(exitCode(report.preconditions.verdict), exitCode(baseline.preconditions.verdict));
    assert.equal(corrupt?.format, "unknown");
    assert.match(corrupt?.limitations.join(" ") ?? "", /could not be inspected:/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("records declared capture order without overriding the offset invariant", async () => {
  const participant = await inspectArtifact(join(fixture("good"), "participant.sql"));
  const validator = await inspectArtifact(join(fixture("good"), "validator.sql"));
  const ordered = checkOffsetOrder([participant, validator], null, null, {
    validatorCompletedAt: "2026-08-31T00:00:00.000Z",
    participantStartedAt: "2026-08-31T00:01:00.000Z",
  });
  assert.equal(ordered.status, "PASS");
  assert.equal(ordered.evidence.validatorCompletedAt, "2026-08-31T00:00:00.000Z");
  assert.equal(ordered.evidence.participantStartedBeforeValidatorCompleted, false);
  assert.equal(ordered.evidence.limitations, undefined);

  const contradictory = checkOffsetOrder([participant, validator], null, null, {
    validatorCompletedAt: "2026-08-31T00:01:00.000Z",
    participantStartedAt: "2026-08-31T00:00:00.000Z",
  });
  assert.equal(contradictory.status, "PASS");
  assert.equal(contradictory.evidence.participantStartedBeforeValidatorCompleted, true);
  assert.match(contradictory.summary, /declared capture order weakens/i);
  assert.match(JSON.stringify(contradictory.evidence.limitations), /participant capture started before/);
});

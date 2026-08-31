import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { checkSelectedIdentity } from "../checks/selected-identity.js";
import { inspectArtifact } from "../artifact.js";
import { inspectBackupSet } from "../backup-set.js";
import { drill, drillExitCode, readRestoredParticipantIdentity } from "../isolated/drill.js";
import { cleanupStatusFromProbes } from "../isolated/docker.js";
import { DrillEnvironmentError } from "../errors.js";
import { exactDrillVersion, resolveDrillRuntime } from "../isolated/runtime.js";
import { writeManifest, type CaptureManifest } from "../manifest.js";
import { formatReport } from "../report/human.js";
import { verify } from "../verify.js";
import { observeBackupVersion } from "../versions.js";

const fixture = (name: string) => resolve(process.cwd(), "test", "fixtures", name);

test("reads an arbitrary restored participant name and requires one identity row", async () => {
  const expected = "PAR::acme-validator-7::1220" + "a".repeat(64);
  const different = "PAR::acme-validator-8::1220" + "b".repeat(64);
  const calls: string[][] = [];
  const read = async (stdout: string) => readRestoredParticipantIdentity("postgres-test", "participant-4", async (_command, args) => {
    calls.push(args);
    return { code: 0, stdout, stderr: "" };
  });
  const participant = await inspectArtifact(join(fixture("good"), "participant.sql"));
  const capture: CaptureManifest = {
    schemaVersion: "1.0",
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
    declared: {
      captureStartedAt: null, validatorCompletedAt: null, participantStartedAt: null, captureCompletedAt: null,
      spliceVersion: "0.6.11", participantDatabase: "participant-4", validatorDatabase: null,
      expectedParticipantId: expected, physicalSynchronizerId: null, physicalSynchronizerSerial: null,
    },
    artifacts: [],
  };

  const restored = await read(expected + "\n");
  assert.deepEqual(restored, { participantId: expected, rowCount: 1 });
  assert.match(calls[0]?.join(" ") ?? "", /participant\.common_node_id/);
  assert.doesNotMatch(calls[0]?.join(" ") ?? "", /identifier=.*participant/);
  const pass = checkSelectedIdentity([participant], capture, null, { database: "restored-participant", ...restored });
  assert.equal(pass.status, "PASS");
  assert.equal(pass.evidence.rowCount, 1);

  const mismatch = await read(different + "\n");
  assert.equal(checkSelectedIdentity([participant], capture, null, { database: "participant-4", ...mismatch }).status, "FAIL");

  for (const [stdout, rowCount] of [["", 0], [expected + "\n" + different + "\n", 2]] as const) {
    const ambiguous = await read(stdout);
    assert.deepEqual(ambiguous, { participantId: null, rowCount });
    const result = checkSelectedIdentity([participant], capture, null, { database: "participant-4", ...ambiguous });
    assert.equal(result.status, "FAIL");
    assert.equal(result.evidence.restoredParticipantId, null);
    assert.equal(result.evidence.rowCount, rowCount);
  }
});

test("refuses a runtime drill before Docker when exact Splice version is absent", async () => {
  await assert.rejects(() => drill(fixture("good")), /requires one exact Splice version/);
});

test("names every source in conflicting Splice version evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "crv-version-conflict-"));
  const set = join(root, "set");
  try {
    await cp(fixture("good"), set, { recursive: true });
    await writeFile(join(set, "identities_20260429_165550.json"), JSON.stringify({
      id: "PAR::synthetic-validator::1220" + "c".repeat(64),
      version: "0.5.18",
      authorizedStoreSnapshot: "Ag==",
      keys: ["namespace", "signing", "encryption"].map((name) => ({ name, keyPair: "AQ==" })),
    }));
    const manifestPath = await writeManifest(set);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    (manifest.declared as Record<string, unknown>).spliceVersion = "0.6.11";
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    const inspected = await inspectBackupSet(set);
    const expected = "0.5.18 (artifact:identities_20260429_165550.json), 0.6.11 (manifest.declared.spliceVersion)";
    assert.throws(() => exactDrillVersion(inspected), (error: unknown) =>
      error instanceof Error && error.message === "crv drill requires one exact Splice version; conflicting evidence: " + expected);
    assert.equal(observeBackupVersion(inspected).detail, "Conflicting backup-set versions: " + expected + ".");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runs an unrecorded Splice version by immutable digest and marks it unverified", async () => {
  const root = await mkdtemp(join(tmpdir(), "crv-drill-splice-version-"));
  const set = join(root, "set");
  try {
    await cp(fixture("good"), set, { recursive: true });
    const manifestPath = await writeManifest(set);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    (manifest.declared as Record<string, unknown>).spliceVersion = "0.6.10";
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    const inspected = await inspectBackupSet(set);
    const digest = "a".repeat(64);
    const calls: string[][] = [];
    const runtime = await resolveDrillRuntime(inspected, async (_command, args) => {
      calls.push(args);
      return args[0] === "pull"
        ? { code: 0, stdout: "", stderr: "" }
        : { code: 0, stdout: JSON.stringify([`ghcr.io/digital-asset/decentralized-canton-sync/docker/canton-participant@sha256:${digest}`]), stderr: "" };
    });
    assert.equal(runtime.spliceVersion, "0.6.10");
    assert.equal(runtime.versionEvidence, "UNVERIFIED");
    assert.match(runtime.participantImage, /@sha256:a{64}$/);
    assert.deepEqual(calls[0], ["pull", "ghcr.io/digital-asset/decentralized-canton-sync/docker/canton-participant:0.6.10"]);
    await assert.rejects(
      () => resolveDrillRuntime(inspected, async () => { throw new Error("daemon unavailable"); }),
      (error: unknown) => error instanceof DrillEnvironmentError,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses a runtime drill before Docker when PostgreSQL source version is unknown", async () => {
  const root = await mkdtemp(join(tmpdir(), "crv-drill-version-"));
  try {
    for (const name of ["participant.sql", "validator.sql"]) {
      const source = await readFile(join(fixture("good"), name), "utf8");
      await writeFile(join(root, name), source.replace(/^-- Dumped from database version .+\n/m, ""));
    }
    const manifestPath = await writeManifest(root);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    const declared = manifest.declared as Record<string, unknown>;
    declared.spliceVersion = "0.6.11";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await assert.rejects(() => drill(root), /requires PostgreSQL source version evidence/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("human report exposes structural failure and cleanup evidence", async () => {
  const report = await verify(fixture("good"));
  report.structuralRestore = {
    status: "FAILED",
    sqlRestored: false,
    participantContainerHealthy: false,
    identityMatched: null,
    networkIsolated: true,
    cleanupStatus: "VERIFIED_ABSENT",
    runtime: { spliceVersion: "0.6.9", participantImage: "repo@sha256:test", versionEvidence: "UNVERIFIED", testedAt: null, evidence: null },
    details: ["drillError=psql rejected truncated COPY", "cleanup=VERIFIED_ABSENT"],
  };
  const output = formatReport(report);
  assert.match(output, /SQL restored: NO/);
  assert.match(output, /Participant container healthcheck: NO/);
  assert.match(output, /Cleanup status: VERIFIED_ABSENT/);
  assert.match(output, /Identity matched: UNKNOWN/);
  assert.match(output, /psql rejected truncated COPY/);
  assert.match(output, /cleanup=VERIFIED_ABSENT/);
  assert.match(output, /Artifact limitation \[participant.sql\]:/);
  assert.match(output, /Remediation for backup.latest_age:/);
});

test("cleanup verification distinguishes absent, present, and failed probes", () => {
  const empty = { code: 0, stdout: "", stderr: "" };
  assert.equal(cleanupStatusFromProbes([empty, empty]), "VERIFIED_ABSENT");
  const failed = { code: 1, stdout: "", stderr: "daemon unavailable" };
  assert.equal(cleanupStatusFromProbes([empty, failed]), "COULD_NOT_VERIFY");
  const present = { code: 0, stdout: "crv-resource\n", stderr: "" };
  assert.equal(cleanupStatusFromProbes([empty, present]), "VERIFIED_PRESENT");
});

test("environment execution failure has its own status, headline, and exit code", async () => {
  const report = await verify(fixture("good"));
  report.structuralRestore.status = "ENVIRONMENT_ERROR";
  report.structuralRestore.cleanupStatus = "COULD_NOT_VERIFY";
  report.structuralRestore.details = ["environmentError=Docker daemon unavailable"];
  const output = formatReport(report);
  assert.match(output, /ENVIRONMENT_ERROR \(the drill environment prevented execution\)/);
  assert.equal(drillExitCode(report), 70);
  report.structuralRestore.status = "FAILED";
  assert.equal(drillExitCode(report), 2);
});

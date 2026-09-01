import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { UnsupportedInputError } from "../errors.js";
import { MANIFEST_FILENAME, readManifest, writeManifest } from "../manifest.js";
import { verify } from "../verify.js";

const fixture = (...parts: string[]) => resolve(process.cwd(), "test", "fixtures", ...parts);

async function snapshot(path: string): Promise<{ digest: string; size: number; mode: number; mtimeMs: number }> {
  const [bytes, metadata] = await Promise.all([readFile(path), stat(path)]);
  return { digest: createHash("sha256").update(bytes).digest("hex"), size: metadata.size, mode: metadata.mode, mtimeMs: metadata.mtimeMs };
}

async function copyGoodSet(): Promise<{ directory: string; participant: string; validator: string }> {
  const directory = await mkdtemp(join(tmpdir(), "crv-manifest-"));
  const participant = join(directory, "participant.sql");
  const validator = join(directory, "validator.sql");
  await Promise.all([cp(fixture("good", "participant.sql"), participant), cp(fixture("good", "validator.sql"), validator)]);
  return { directory, participant, validator };
}

test("writes relative digest references without mutating artifacts", async () => {
  const set = await copyGoodSet();
  try {
    const before = await Promise.all([snapshot(set.participant), snapshot(set.validator)]);
    const path = await writeManifest(set.directory);
    const manifest = await readManifest(path);
    const after = await Promise.all([snapshot(set.participant), snapshot(set.validator)]);
    assert.deepEqual(after, before);
    assert.deepEqual(manifest.artifacts.map((artifact) => artifact.path), ["participant.sql", "validator.sql"]);
    assert.ok(manifest.artifacts.every((artifact) => /^[0-9a-f]{64}$/.test(artifact.sha256)));
    assert.equal(manifest.declared.captureCompletedAt, null);

    const report = await verify(set.directory);
    assert.equal(report.subject.manifest, path);
    assert.equal(report.checks.find((check) => check.id === "artifact.reference_digest")?.status, "PASS");
    assert.equal(report.preconditions.verdict, "INDETERMINATE");
  } finally {
    await rm(set.directory, { recursive: true, force: true });
  }
});

test("requires RFC 3339 date-time manifest timestamps", async () => {
  const set = await copyGoodSet();
  try {
    const path = await writeManifest(set.directory);
    const manifest = await readManifest(path);

    manifest.declared.captureCompletedAt = "2026-08-31T12:34:56Z";
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.equal((await readManifest(path)).declared.captureCompletedAt, "2026-08-31T12:34:56Z");

    manifest.declared.captureCompletedAt = "2026-08-31T14:34:56+02:00";
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.equal((await readManifest(path)).declared.captureCompletedAt, "2026-08-31T14:34:56+02:00");

    manifest.declared.captureCompletedAt = "2026-08-31T23:59:60Z";
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.equal((await readManifest(path)).declared.captureCompletedAt, "2026-08-31T23:59:60Z");

    for (const invalid of ["2026-02-30T12:34:56Z", "2026-08-31T24:00:00Z"]) {
      manifest.declared.captureCompletedAt = invalid;
      await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
      await assert.rejects(() => readManifest(path), /must be an RFC 3339 date-time/);
    }

    manifest.declared.captureCompletedAt = "2026-08-31";
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
    await assert.rejects(
      () => readManifest(path),
      /manifest\.declared\.captureCompletedAt must be an RFC 3339 date-time or null; for example 2026-08-31T12:34:56Z/,
    );
  } finally {
    await rm(set.directory, { recursive: true, force: true });
  }
});

test("fails changed and missing manifest artifacts", async () => {
  const changed = await copyGoodSet();
  try {
    await writeManifest(changed.directory);
    await writeFile(changed.validator, "changed\n");
    const changedReport = await verify(changed.directory);
    assert.equal(changedReport.checks.find((check) => check.id === "artifact.reference_digest")?.status, "FAIL");
    assert.equal(changedReport.preconditions.verdict, "FAILED");
  } finally {
    await rm(changed.directory, { recursive: true, force: true });
  }

  const missing = await copyGoodSet();
  try {
    await writeManifest(missing.directory);
    await unlink(missing.participant);
    const missingReport = await verify(missing.directory);
    const digest = missingReport.checks.find((check) => check.id === "artifact.reference_digest");
    assert.equal(digest?.status, "FAIL");
    assert.deepEqual(digest?.evidence.missingArtifacts, ["participant.sql"]);
  } finally {
    await rm(missing.directory, { recursive: true, force: true });
  }
});

test("refresh preserves declared provenance instead of inventing capture times", async () => {
  const set = await copyGoodSet();
  try {
    const path = await writeManifest(set.directory);
    const manifest = await readManifest(path);
    manifest.declared.captureCompletedAt = "2026-08-29T06:00:00.000Z";
    manifest.declared.participantDatabase = "participant-4";
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
    await writeManifest(set.directory);
    const refreshed = await readManifest(path);
    assert.equal(refreshed.declared.captureCompletedAt, "2026-08-29T06:00:00.000Z");
    assert.equal(refreshed.declared.participantDatabase, "participant-4");
  } finally {
    await rm(set.directory, { recursive: true, force: true });
  }
});

test("rejects manifest traversal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "crv-manifest-"));
  const path = join(directory, MANIFEST_FILENAME);
  try {
    await writeFile(path, JSON.stringify({
      schemaVersion: "1.0",
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:00.000Z",
      declared: {
        captureStartedAt: null, validatorCompletedAt: null, participantStartedAt: null, captureCompletedAt: null,
        spliceVersion: null, participantDatabase: null, validatorDatabase: null, expectedParticipantId: null,
        physicalSynchronizerId: null, physicalSynchronizerSerial: null,
      },
      artifacts: [{ path: "../outside.sql", format: "plain_dump", roles: ["participant"], sizeBytes: 1, sha256: "0".repeat(64) }],
    }));
    await assert.rejects(() => verify(path), UnsupportedInputError);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

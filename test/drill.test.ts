import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { inspectBackupSet } from "../backup-set.js";
import { drill } from "../isolated/drill.js";
import { resolveDrillRuntime } from "../isolated/runtime.js";
import { writeManifest } from "../manifest.js";
import { formatReport } from "../report/human.js";
import { verify } from "../verify.js";

const fixture = (name: string) => resolve(process.cwd(), "test", "fixtures", name);

test("refuses a runtime drill before Docker when exact Splice version is absent", async () => {
  await assert.rejects(() => drill(fixture("good")), /requires one exact Splice version/);
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
    participantServing: false,
    identityMatched: null,
    networkIsolated: true,
    runtime: { spliceVersion: "0.6.9", participantImage: "repo@sha256:test", versionEvidence: "UNVERIFIED", testedAt: null, evidence: null },
    details: ["drillError=psql rejected truncated COPY", "cleanup=verified-no-resources-remain"],
  };
  const output = formatReport(report);
  assert.match(output, /SQL restored: NO/);
  assert.match(output, /Identity matched: UNKNOWN/);
  assert.match(output, /psql rejected truncated COPY/);
  assert.match(output, /cleanup=verified-no-resources-remain/);
});

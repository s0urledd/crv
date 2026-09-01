import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { inspectArtifact } from "../artifact.js";
import { checkBackupAge } from "../checks/backup-age.js";
import { checkLsuPath } from "../checks/lsu.js";
import { loadConfig, writeInitialConfig, type CrvConfig } from "../config.js";
import { UnsupportedInputError } from "../errors.js";
import type { CaptureManifest } from "../manifest.js";
import { aggregate, exitCode } from "../report/aggregate.js";

const fixture = (...parts: string[]) => resolve(process.cwd(), "test", "fixtures", ...parts);
const declared = (): CaptureManifest["declared"] => ({
  captureStartedAt: null,
  validatorCompletedAt: null,
  participantStartedAt: null,
  captureCompletedAt: null,
  spliceVersion: null,
  participantDatabase: null,
  validatorDatabase: null,
  expectedParticipantId: null,
  physicalSynchronizerId: null,
  physicalSynchronizerSerial: null,
});
const manifest = (): CaptureManifest => ({
  schemaVersion: "1.0",
  createdAt: "2026-08-29T00:00:00.000Z",
  updatedAt: "2026-08-29T00:00:00.000Z",
  declared: declared(),
  artifacts: [],
});
const config = (): CrvConfig => ({
  schemaVersion: "1.0",
  deployment: { participantDatabase: null, validatorDatabase: null, expectedParticipantId: null },
  network: {
    scanVersionUrl: null,
    sequencerHorizonSeconds: null,
    sequencerHorizonSource: null,
    backupAgeWarnFraction: null,
    currentPhysicalSynchronizerId: null,
    currentPhysicalSynchronizerSerial: null,
    capturedPhysicalSynchronizerUsable: null,
    capturedPhysicalSynchronizerUsabilitySource: null,
  },
  watch: { statePath: ".crv/state.json", reportsPath: "crv-reports", intervalSeconds: 86400 },
});

test("age uses supplied horizon and fails at the boundary", async () => {
  const artifact = await inspectArtifact(fixture("good", "participant.sql"));
  const capture = manifest();
  capture.declared.captureCompletedAt = "2026-08-29T00:00:00.000Z";
  const settings = config();
  settings.network.sequencerHorizonSeconds = 3600;
  settings.network.sequencerHorizonSource = "network-operator-policy-2026-08";
  assert.equal(checkBackupAge([artifact], capture, settings, new Date("2026-08-29T00:59:59.000Z")).status, "PASS");
  assert.equal(checkBackupAge([artifact], capture, settings, new Date("2026-08-29T01:00:00.000Z")).status, "FAIL");
});

test("age remains UNKNOWN when horizon has no source", async () => {
  const artifact = await inspectArtifact(fixture("good", "participant.sql"));
  const capture = manifest();
  capture.declared.captureCompletedAt = "2026-08-29T00:00:00.000Z";
  const settings = config();
  settings.network.sequencerHorizonSeconds = 2592000;
  const result = checkBackupAge([artifact], capture, settings, new Date("2026-08-29T01:00:00.000Z"));
  assert.equal(result.status, "UNKNOWN");
  assert.match(result.requiredEvidence.join(" "), /source/);
});

test("configured age warning produces AT_RISK and exit 1 only above its boundary", async () => {
  const artifact = await inspectArtifact(fixture("good", "participant.sql"));
  const capture = manifest();
  capture.declared.captureCompletedAt = "2026-08-29T00:00:00.000Z";
  const settings = config();
  settings.network.sequencerHorizonSeconds = 100;
  settings.network.sequencerHorizonSource = "network-operator-policy-2026-08";
  settings.network.backupAgeWarnFraction = 0.8;

  const boundary = checkBackupAge([artifact], capture, settings, new Date("2026-08-29T00:01:20.000Z"));
  assert.equal(boundary.status, "PASS");
  const warning = checkBackupAge([artifact], capture, settings, new Date("2026-08-29T00:01:21.000Z"));
  assert.equal(warning.status, "WARN");
  assert.match(warning.summary, /81s.*100s.*0\.8.*config\.network\.backupAgeWarnFraction/);
  const preconditions = aggregate([warning]);
  assert.equal(preconditions.verdict, "AT_RISK");
  assert.equal(exitCode(preconditions.verdict), 1);

  settings.network.backupAgeWarnFraction = null;
  assert.equal(checkBackupAge([artifact], capture, settings, new Date("2026-08-29T00:01:21.000Z")).status, "PASS");
});

test("LSU passes matching identity and requires sourced usability after a change", async () => {
  const artifact = await inspectArtifact(fixture("good", "participant.sql"));
  const capture = manifest();
  capture.declared.physicalSynchronizerId = "sync-old";
  capture.declared.physicalSynchronizerSerial = 1;
  const settings = config();
  settings.network.currentPhysicalSynchronizerId = "sync-old";
  settings.network.currentPhysicalSynchronizerSerial = 1;
  assert.equal(checkLsuPath([artifact], capture, settings).status, "PASS");

  settings.network.currentPhysicalSynchronizerId = "sync-new";
  settings.network.currentPhysicalSynchronizerSerial = 2;
  assert.equal(checkLsuPath([artifact], capture, settings).status, "UNKNOWN");
  settings.network.capturedPhysicalSynchronizerUsable = false;
  settings.network.capturedPhysicalSynchronizerUsabilitySource = "network-operator-incident-42";
  assert.equal(checkLsuPath([artifact], capture, settings).status, "FAIL");
});

test("init-config is runnable, strict, and refuses overwrite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "crv-config-"));
  const path = join(directory, "crv.yaml");
  try {
    await writeInitialConfig(path);
    const parsed = await loadConfig(path);
    assert.equal(parsed.watch.statePath, ".crv/state.json");
    assert.equal(parsed.network.sequencerHorizonSeconds, null);
    assert.equal(parsed.network.backupAgeWarnFraction, null);
    await assert.rejects(() => writeInitialConfig(path), UnsupportedInputError);

    await writeFile(path, 'schemaVersion: "1.0"\nnetwork:\n  typo: 30\n');
    await assert.rejects(() => loadConfig(path), /unknown key/);

    for (const fraction of [0, 1, -0.1, 1.1]) {
      await writeFile(path, `schemaVersion: "1.0"\nnetwork:\n  backupAgeWarnFraction: ${fraction}\n`);
      await assert.rejects(
        () => loadConfig(path),
        /config\.network\.backupAgeWarnFraction must be a number greater than 0 and less than 1, or null/,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

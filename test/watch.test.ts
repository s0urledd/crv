import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { runWatchCycle } from "../watch.js";

const fixture = (name: string) => resolve(process.cwd(), "test", "fixtures", name);
const configText = `schemaVersion: "1.0"
deployment:
  participantDatabase: null
  validatorDatabase: null
  expectedParticipantId: null
network:
  sequencerHorizonSeconds: null
  sequencerHorizonSource: null
  currentPhysicalSynchronizerId: null
  currentPhysicalSynchronizerSerial: null
  capturedPhysicalSynchronizerUsable: null
  capturedPhysicalSynchronizerUsabilitySource: null
watch:
  statePath: state/watch.json
  reportsPath: reports
  intervalSeconds: 3600
`;

test("watch writes report and state beside config, then detects regression", async () => {
  const directory = await mkdtemp(join(tmpdir(), "crv-watch-"));
  const configPath = join(directory, "crv.yaml");
  const input = fixture("good");
  try {
    await writeFile(configPath, configText);
    const first = await runWatchCycle(input, configPath, undefined, new Date("2026-08-29T12:00:00.000Z"));
    assert.equal(first.report.preconditions.verdict, "INDETERMINATE");
    assert.equal(first.regression, false);
    assert.ok(first.reportPath.startsWith(join(directory, "reports")));
    assert.equal(first.statePath, join(directory, "state", "watch.json"));
    const report = JSON.parse(await readFile(first.reportPath, "utf8")) as { schemaVersion: string };
    assert.equal(report.schemaVersion, "1.0");

    await writeFile(first.statePath, JSON.stringify({
      schemaVersion: "1.0",
      subject: input,
      lastVerdict: "MET",
      lastReport: "previous.json",
      lastRunAt: "2026-08-29T11:00:00.000Z",
    }));
    const second = await runWatchCycle(input, configPath, undefined, new Date("2026-08-29T13:00:00.000Z"));
    assert.equal(second.previousVerdict, "MET");
    assert.equal(second.regression, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("watch rejects corrupt state instead of resetting the baseline", async () => {
  const directory = await mkdtemp(join(tmpdir(), "crv-watch-"));
  const configPath = join(directory, "crv.yaml");
  const statePath = join(directory, "state", "watch.json");
  try {
    await writeFile(configPath, configText);
    await mkdir(join(directory, "state"), { recursive: true });
    await writeFile(statePath, "not-json\n");
    await assert.rejects(
      () => runWatchCycle(fixture("good"), configPath, undefined, new Date("2026-08-29T12:00:00.000Z")),
      /invalid watch state JSON/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

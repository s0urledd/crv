import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { exitCode } from "../report/aggregate.js";
import { runWatchCycle } from "../watch.js";

const fixture = (name: string) => resolve(process.cwd(), "test", "fixtures", name);

function configText(
  heartbeatUrl: string | null = null,
  statePath = "state/watch.json",
  reportsPath = "reports",
): string {
  return `schemaVersion: "1.0"
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
  statePath: ${statePath}
  reportsPath: ${reportsPath}
  intervalSeconds: 3600
  heartbeatUrl: ${heartbeatUrl === null ? "null" : JSON.stringify(heartbeatUrl)}
`;
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
}

test("watch writes report and state beside config, then detects regression", async () => {
  const directory = await mkdtemp(join(tmpdir(), "crv-watch-"));
  const configPath = join(directory, "crv.yaml");
  const input = fixture("good");
  try {
    await writeFile(configPath, configText());
    const first = await runWatchCycle(input, configPath, undefined, new Date("2026-08-29T12:00:00.000Z"));
    assert.equal(first.report.preconditions.verdict, "INDETERMINATE");
    assert.equal(first.regression, false);
    assert.ok(first.reportPath.startsWith(join(directory, "reports")));
    assert.equal(first.statePath, join(directory, "state", "watch.json"));
    const report = JSON.parse(await readFile(first.reportPath, "utf8")) as { schemaVersion: string };
    assert.equal(report.schemaVersion, "1.2");

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
    await writeFile(configPath, configText());
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

test("watch pings the base URL once and appends fail only for FAILED", async () => {
  const directory = await mkdtemp(join(tmpdir(), "crv-watch-heartbeat-"));
  const requests: Array<{ path: string; reportPresent: boolean }> = [];
  const goodReport = join(directory, "reports-good", "2026-08-29T12-00-00.000Z-indeterminate.json");
  const failedReport = join(directory, "reports-failed", "2026-08-29T13-00-00.000Z-failed.json");
  const server = createServer((request, response) => {
    const path = request.url ?? "";
    requests.push({
      path,
      reportPresent: existsSync(path === "/ping/fail" ? failedReport : goodReport),
    });
    response.writeHead(204);
    response.end();
  });
  try {
    const origin = await listen(server);
    const goodConfig = join(directory, "good.yaml");
    const failedConfig = join(directory, "failed.yaml");
    await Promise.all([
      writeFile(goodConfig, configText(`${origin}/ping`, "state/good.json", "reports-good")),
      writeFile(failedConfig, configText(`${origin}/ping/`, "state/failed.json", "reports-failed")),
    ]);

    const good = await runWatchCycle(fixture("good"), goodConfig, undefined, new Date("2026-08-29T12:00:00.000Z"));
    const failed = await runWatchCycle(fixture("reversed"), failedConfig, undefined, new Date("2026-08-29T13:00:00.000Z"));
    assert.equal(good.report.preconditions.verdict, "INDETERMINATE");
    assert.equal(failed.report.preconditions.verdict, "FAILED");
    assert.deepEqual(requests, [
      { path: "/ping", reportPresent: true },
      { path: "/ping/fail", reportPresent: true },
    ]);

    for (const statePath of [good.statePath, failed.statePath]) {
      const state = JSON.parse(await readFile(statePath, "utf8")) as { lastHeartbeat: { at: string; ok: boolean } };
      assert.equal(state.lastHeartbeat.ok, true);
      assert.equal(Number.isNaN(Date.parse(state.lastHeartbeat.at)), false);
    }
  } finally {
    if (server.listening) await close(server);
    await rm(directory, { recursive: true, force: true });
  }
});

test("an unreachable heartbeat changes only watch state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "crv-watch-heartbeat-"));
  const probe = createServer();
  try {
    const unavailable = await listen(probe);
    await close(probe);
    const offlineConfig = join(directory, "offline.yaml");
    const heartbeatConfig = join(directory, "heartbeat.yaml");
    await Promise.all([
      writeFile(offlineConfig, configText(null, "state/offline.json", "reports-offline")),
      writeFile(heartbeatConfig, configText(`${unavailable}/ping`, "state/heartbeat.json", "reports-heartbeat")),
    ]);

    const now = new Date("2026-08-29T12:00:00.000Z");
    const offline = await runWatchCycle(fixture("good"), offlineConfig, undefined, now);
    const heartbeat = await runWatchCycle(fixture("good"), heartbeatConfig, undefined, now);
    assert.deepEqual(heartbeat.report, offline.report);
    assert.equal(exitCode(heartbeat.report.preconditions.verdict), exitCode(offline.report.preconditions.verdict));

    const offlineState = JSON.parse(await readFile(offline.statePath, "utf8")) as Record<string, unknown>;
    const heartbeatState = JSON.parse(await readFile(heartbeat.statePath, "utf8")) as {
      lastHeartbeat: { at: string; ok: boolean };
    };
    assert.equal("lastHeartbeat" in offlineState, false);
    assert.equal(heartbeatState.lastHeartbeat.ok, false);
  } finally {
    if (probe.listening) await close(probe);
    await rm(directory, { recursive: true, force: true });
  }
});

test("heartbeat stays outside inspect, verify, manifest, and drill", async () => {
  const paths = [
    "inspect.ts",
    "verify.ts",
    "manifest.ts",
    "isolated/docker.ts",
    "isolated/drill.ts",
    "isolated/runtime.ts",
  ];
  const sources = await Promise.all(paths.map((path) => readFile(resolve(process.cwd(), path), "utf8")));
  for (const [index, source] of sources.entries()) {
    assert.doesNotMatch(source, /heartbeat/i, paths[index]);
  }
});

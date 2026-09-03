import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { UnsupportedInputError } from "./errors.js";
import { loadConfig, type CrvConfig } from "./config.js";
import { exitCode } from "./report/aggregate.js";
import { formatReport } from "./report/human.js";
import type { PreconditionsVerdict, VerificationReport } from "./types.js";
import { verify } from "./verify.js";

interface WatchState {
  schemaVersion: "1.0";
  subject: string;
  lastVerdict: PreconditionsVerdict;
  lastHeartbeat?: {
    at: string;
    ok: boolean;
  };
  lastReport: string;
  lastRunAt: string;
}

export interface WatchCycle {
  report: VerificationReport;
  reportPath: string;
  statePath: string;
  previousVerdict: PreconditionsVerdict | null;
  regression: boolean;
}

function configuredPath(configPath: string, value: string): string {
  return isAbsolute(value) ? value : resolve(dirname(resolve(configPath)), value);
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, contents, { flag: "wx", mode: 0o644 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function heartbeatTarget(base: string, verdict: PreconditionsVerdict): string {
  if (verdict !== "FAILED") return base;
  const target = new URL(base);
  target.pathname = `${target.pathname.replace(/\/+$/, "")}/fail`;
  return target.toString();
}

async function sendHeartbeat(base: string, verdict: PreconditionsVerdict): Promise<{ at: string; ok: boolean }> {
  const at = new Date().toISOString();
  let ok = false;
  try {
    const response = await fetch(heartbeatTarget(base, verdict), {
      method: "GET",
      signal: AbortSignal.timeout(10_000),
    });
    ok = response.ok;
    if (response.body !== null) await response.body.cancel().catch(() => undefined);
  } catch {
    // Heartbeats are observational; their failure must not alter backup evidence.
  }
  process.stderr.write(`crv watch: heartbeat ${ok ? "ok" : "failed"}\n`);
  return { at, ok };
}

async function previousState(path: string, subject: string): Promise<WatchState | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") return null;
    throw error;
  }
  let value: Partial<WatchState>;
  try {
    value = JSON.parse(text) as Partial<WatchState>;
  } catch {
    throw new UnsupportedInputError("invalid watch state JSON: " + path);
  }
  const verdicts: PreconditionsVerdict[] = ["MET", "AT_RISK", "FAILED", "INDETERMINATE"];
  if (value.schemaVersion !== "1.0" || value.subject !== subject || !verdicts.includes(value.lastVerdict as PreconditionsVerdict)) {
    throw new UnsupportedInputError("watch state does not match schema or subject: " + path);
  }
  if (value.lastHeartbeat !== undefined && (
    typeof value.lastHeartbeat !== "object"
    || value.lastHeartbeat === null
    || typeof value.lastHeartbeat.at !== "string"
    || typeof value.lastHeartbeat.ok !== "boolean"
  )) {
    throw new UnsupportedInputError("watch state does not match schema or subject: " + path);
  }
  return value as WatchState;
}

function rank(verdict: PreconditionsVerdict): number {
  switch (verdict) {
    case "MET": return 0;
    case "AT_RISK": return 1;
    case "INDETERMINATE": return 2;
    case "FAILED": return 3;
  }
}

export async function runWatchCycle(
  input: string,
  configPath: string,
  config?: CrvConfig,
  now = new Date(),
): Promise<WatchCycle> {
  const settings = config ?? await loadConfig(configPath);
  const statePath = configuredPath(configPath, settings.watch.statePath);
  const reportsPath = configuredPath(configPath, settings.watch.reportsPath);
  const report = await verify(input, configPath, now);
  const filename = `${report.generatedAt.replaceAll(":", "-")}-${report.preconditions.verdict.toLowerCase()}.json`;
  const reportPath = join(reportsPath, filename);
  const previous = await previousState(statePath, input);
  const regression = previous !== null && rank(report.preconditions.verdict) > rank(previous.lastVerdict);
  await atomicWrite(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const lastHeartbeat = settings.watch.heartbeatUrl === null
    ? null
    : await sendHeartbeat(settings.watch.heartbeatUrl, report.preconditions.verdict);
  const state: WatchState = {
    schemaVersion: "1.0",
    subject: input,
    lastVerdict: report.preconditions.verdict,
    lastReport: reportPath,
    lastRunAt: report.generatedAt,
    ...(lastHeartbeat === null ? {} : { lastHeartbeat }),
  };
  await atomicWrite(statePath, `${JSON.stringify(state, null, 2)}\n`);
  return {
    report,
    reportPath,
    statePath,
    previousVerdict: previous?.lastVerdict ?? null,
    regression,
  };
}

export async function runWatch(input: string, configPath: string, json: boolean): Promise<number> {
  const config = await loadConfig(configPath);
  while (true) {
    const cycle = await runWatchCycle(input, configPath, config);
    process.stdout.write(json ? `${JSON.stringify(cycle.report, null, 2)}\n` : `${formatReport(cycle.report)}\n`);
    if (cycle.regression) process.stderr.write(`crv watch: regression from ${cycle.previousVerdict} to ${cycle.report.preconditions.verdict}\n`);
    const code = exitCode(cycle.report.preconditions.verdict);
    if (code !== 0) return code;
    await delay(config.watch.intervalSeconds * 1000);
  }
}

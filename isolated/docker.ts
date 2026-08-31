import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { createGunzip } from "node:zlib";
import { DrillEnvironmentError } from "../errors.js";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import type { ArtifactCompression, CleanupStatus } from "../types.js";

export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

function appendBounded(current: string, chunk: Buffer | string): string {
  if (current.length >= 32768) return current;
  return (current + chunk.toString()).slice(0, 32768);
}

export async function runProcess(command: string, args: string[], allowFailure = false): Promise<ProcessResult> {
  return await new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => { stdout = appendBounded(stdout, chunk); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = appendBounded(stderr, chunk); });
    child.once("error", reject);
    child.once("close", (code) => {
      const result = { code: code ?? 1, stdout, stderr };
      if (!allowFailure && result.code !== 0) reject(new Error(`${command} ${args[0] ?? ""} failed: ${stderr.trim() || stdout.trim() || `exit ${result.code}`}`));
      else resolve(result);
    });
  });
}

function externalDecodedStream(command: string, args: string[]): { stream: Readable; completion: Promise<void> } {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  if (!child.stdout || !child.stderr) throw new Error(`could not start ${command}`);
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr = appendBounded(stderr, chunk); });
  const completion = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} decode failed: ${stderr.trim() || `exit ${code ?? 1}`}`)));
  });
  return { stream: child.stdout, completion };
}

function decodedStream(path: string, compression: ArtifactCompression): { stream: Readable; completion: Promise<void> } {
  if (compression === "none") return { stream: createReadStream(path), completion: Promise.resolve() };
  if (compression === "gzip") return { stream: createReadStream(path).pipe(createGunzip()), completion: Promise.resolve() };
  if (compression === "zstd") return externalDecodedStream("zstd", ["-q", "-d", "-c", "--", path]);
  if (compression === "xz") return externalDecodedStream("xz", ["-d", "-c", "--", path]);
  if (compression === "bzip2") return externalDecodedStream("bzip2", ["-d", "-c", "--", path]);
  throw new Error(`unsupported compression: ${compression}`);
}

export async function streamDockerInput(args: string[], path: string, compression: ArtifactCompression): Promise<void> {
  const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
  if (!child.stdin) throw new Error("docker stdin is unavailable");
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => { stdout = appendBounded(stdout, chunk); });
  child.stderr?.on("data", (chunk: Buffer) => { stderr = appendBounded(stderr, chunk); });
  const dockerCompletion = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`docker exec failed: ${stderr.trim() || stdout.trim() || `exit ${code ?? 1}`}`)));
  });
  const decoded = decodedStream(path, compression);
  try {
    await Promise.all([pipeline(decoded.stream, child.stdin), decoded.completion, dockerCompletion]);
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }
}

export class DrillResources {
  readonly id = `crv-drill-${process.pid}-${randomBytes(4).toString("hex")}`;
  readonly postgres = `${this.id}-postgres`;
  readonly participant = `${this.id}-participant`;
  readonly network = `${this.id}-network`;
  readonly volume = `${this.id}-postgres-data`;

  async create(): Promise<void> {
    await runProcess("docker", ["network", "create", "--internal", "--label", `crv.run=${this.id}`, this.network]);
    await runProcess("docker", ["volume", "create", "--label", `crv.run=${this.id}`, this.volume]);
  }

  async waitHealthy(container: string, timeoutSeconds: number): Promise<void> {
    const deadline = Date.now() + timeoutSeconds * 1000;
    while (Date.now() < deadline) {
      const result = await runProcess("docker", ["inspect", container, "--format", "{{if .State.Health}}{{.State.Health.Status}}{{else if .State.Running}}running{{else}}stopped{{end}}"], true);
      if (result.code !== 0) {
        throw new DrillEnvironmentError("could not query Docker health for " + container + ": " + (result.stderr.trim() || result.stdout.trim() || "exit " + result.code));
      }
      if (result.stdout.trim() === "healthy") return;
      await delay(500);
    }
    throw new Error(`${container} did not become healthy within ${timeoutSeconds}s`);
  }

  async cleanup(): Promise<CleanupStatus> {
    await Promise.allSettled([
      runProcess("docker", ["rm", "-f", "-v", this.participant, this.postgres], true),
      runProcess("docker", ["network", "rm", this.network], true),
      runProcess("docker", ["volume", "rm", "-f", this.volume], true),
    ]);
    try {
      const probes = await Promise.all([
        runProcess("docker", ["container", "ls", "-a", "--filter", "name=" + this.participant, "--format", "{{.Names}}"], true),
        runProcess("docker", ["container", "ls", "-a", "--filter", "name=" + this.postgres, "--format", "{{.Names}}"], true),
        runProcess("docker", ["network", "ls", "--filter", "name=" + this.network, "--format", "{{.Name}}"], true),
        runProcess("docker", ["volume", "ls", "--filter", "name=" + this.volume, "--format", "{{.Name}}"], true),
      ]);
      return cleanupStatusFromProbes(probes);
    } catch {
      return "COULD_NOT_VERIFY";
    }
  }
}

export function cleanupStatusFromProbes(probes: ProcessResult[]): CleanupStatus {
  if (probes.some((probe) => probe.code !== 0)) return "COULD_NOT_VERIFY";
  return probes.some((probe) => probe.stdout.trim().length > 0) ? "VERIFIED_PRESENT" : "VERIFIED_ABSENT";
}

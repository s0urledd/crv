import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import { writeManifest } from "../manifest.js";

const cli = resolve(process.cwd(), "dist", "cli.js");
const fixture = (...parts: string[]): string => resolve(process.cwd(), "test", "fixtures", ...parts);

interface FileSnapshot {
  path: string;
  size: number;
  mtimeMs: number;
  sha256: string;
}

async function snapshotDirectory(root: string): Promise<FileSnapshot[]> {
  const files: FileSnapshot[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      const portable = relative(root, absolute).split("\\").join("/");
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) {
        const [bytes, metadata] = await Promise.all([readFile(absolute), stat(absolute)]);
        files.push({
          path: portable,
          size: metadata.size,
          mtimeMs: metadata.mtimeMs,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
      }
    }
  }
  await walk(root);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function copyGoodSet(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await Promise.all([
    cp(fixture("good", "participant.sql"), join(directory, "participant.sql")),
    cp(fixture("good", "validator.sql"), join(directory, "validator.sql")),
  ]);
}

function run(args: string[], env: NodeJS.ProcessEnv = process.env): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    [cli, ...args],
    { encoding: "utf8", env },
  );
  return { status: result.status, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

async function assertUnchanged(before: FileSnapshot[], directory: string): Promise<void> {
  assert.deepEqual(await snapshotDirectory(directory), before);
}

test("inspect, verify, watch, and docker-less drill do not modify their input set", async () => {
  const root = await mkdtemp(join(tmpdir(), "crv-input-immutability-"));
  const directory = join(root, "set");
  try {
    await copyGoodSet(directory);
    const manifestPath = await writeManifest(directory);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      declared: { spliceVersion: string | null; participantDatabase: string | null; validatorDatabase: string | null };
    };
    manifest.declared.spliceVersion = "0.7.5";
    manifest.declared.participantDatabase = "participant-app-provider";
    manifest.declared.validatorDatabase = "validator-app-provider";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const configPath = join(root, "crv.yaml");
    await writeFile(configPath, JSON.stringify({
      schemaVersion: "1.0",
      watch: { statePath: join(root, "state.json"), reportsPath: join(root, "reports"), intervalSeconds: 60 },
    }));
    const emptyPath = join(root, "empty-path");
    await mkdir(emptyPath);
    const before = await snapshotDirectory(directory);

    const inspect = run(["inspect", join(directory, "participant.sql"), "--json"]);
    assert.equal(inspect.status, 0, inspect.stderr);
    await assertUnchanged(before, directory);

    const verify = run(["verify", directory, "--config", configPath, "--json"]);
    assert.equal(verify.status, 3, verify.stderr);
    await assertUnchanged(before, directory);

    const watch = run(["watch", directory, "--config", configPath, "--json"]);
    assert.equal(watch.status, 3, watch.stderr);
    await assertUnchanged(before, directory);

    const drill = run(["drill", directory, "--config", configPath, "--json"], { ...process.env, PATH: emptyPath });
    assert.equal(drill.status, 70, drill.stderr);
    await assertUnchanged(before, directory);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("manifest adds only crv-manifest.json and preserves every artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "crv-manifest-immutability-"));
  const directory = join(root, "set");
  try {
    await copyGoodSet(directory);
    const before = await snapshotDirectory(directory);
    const result = run(["manifest", directory]);
    assert.equal(result.status, 0, result.stderr);
    const after = await snapshotDirectory(directory);
    assert.deepEqual(after.filter((entry) => entry.path !== "crv-manifest.json"), before);
    assert.deepEqual(after.filter((entry) => !before.some((previous) => previous.path === entry.path)).map((entry) => entry.path), ["crv-manifest.json"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("input snapshot guard detects an added marker", async () => {
  const root = await mkdtemp(join(tmpdir(), "crv-input-guard-"));
  const directory = join(root, "set");
  const marker = join(directory, "unexpected-write");
  try {
    await copyGoodSet(directory);
    const before = await snapshotDirectory(directory);
    await writeFile(marker, "marker\n");
    await assert.rejects(() => assertUnchanged(before, directory));
    await rm(marker);
    await assertUnchanged(before, directory);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

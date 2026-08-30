import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { inspectArtifact } from "../artifact.js";
import { writeManifest } from "../manifest.js";
import { verify } from "../verify.js";

const fixture = (...parts: string[]) => resolve(process.cwd(), "test", "fixtures", ...parts);

const requireFromTest = createRequire(import.meta.url);
const Ajv2020 = requireFromTest("ajv/dist/2020.js").default as typeof import("ajv/dist/2020.js").default;
const addFormats = requireFromTest("ajv-formats").default as typeof import("ajv-formats").default;

async function snapshot(path: string): Promise<{ digest: string; size: number; mode: number; mtimeMs: number }> {
  const [bytes, metadata] = await Promise.all([readFile(path), stat(path)]);
  return {
    digest: createHash("sha256").update(bytes).digest("hex"),
    size: metadata.size,
    mode: metadata.mode,
    mtimeMs: metadata.mtimeMs,
  };
}

test("inspects gzip by magic without hashing or mutating the input", async () => {
  const directory = await mkdtemp(join(tmpdir(), "crv-test-"));
  const target = join(directory, "dated-backup.bin");
  try {
    await writeFile(target, gzipSync(await readFile(fixture("good", "participant.sql"))));
    const before = await snapshot(target);
    const artifact = await inspectArtifact(target);
    const after = await snapshot(target);
    assert.equal(artifact.compression, "gzip");
    assert.equal(artifact.format, "plain_dump");
    assert.equal(artifact.offsets[0]?.participantLedgerEnd, "65");
    assert.equal(artifact.sha256, null);
    assert.deepEqual(after, before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("walks nested date layouts and reports paths relative to the set root", async () => {
  const directory = await mkdtemp(join(tmpdir(), "crv-test-"));
  const dated = join(directory, "2026-08-29", "0600");
  try {
    await mkdir(dated, { recursive: true });
    await Promise.all([
      cp(fixture("good", "participant.sql"), join(dated, "participant.backup")),
      cp(fixture("good", "validator.sql"), join(dated, "validator.backup")),
    ]);
    const report = await verify(directory);
    assert.equal(report.subject.layout, "per_database");
    assert.deepEqual(report.artifacts.map((artifact) => artifact.path), [
      "2026-08-29/0600/participant.backup",
      "2026-08-29/0600/validator.backup",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("fast verify preserves input bytes, mode, size, and modification time", async () => {
  const paths = [fixture("good", "participant.sql"), fixture("good", "validator.sql")];
  const before = await Promise.all(paths.map(snapshot));
  await verify(fixture("good"));
  const after = await Promise.all(paths.map(snapshot));
  assert.deepEqual(after, before);
});

test("every applicable UNKNOWN names evidence that would resolve it", async () => {
  const report = await verify(fixture("good"));
  const unknown = report.checks.filter((check) => check.applicable && check.status === "UNKNOWN");
  assert.ok(unknown.length > 0);
  for (const check of unknown) assert.ok(check.requiredEvidence.length > 0, check.id);
  for (const check of report.checks.filter((candidate) => candidate.status !== "UNKNOWN")) {
    assert.deepEqual(check.requiredEvidence, [], check.id);
  }
});

test("generated report and manifest conform to report v1.1 and manifest v1 JSON schemas", async () => {
  const reportSchema = JSON.parse(await readFile(fixture("..", "..", "docs", "report-schema-v1.1.json"), "utf8")) as object;
  const manifestSchema = JSON.parse(await readFile(fixture("..", "..", "docs", "manifest-schema-v1.json"), "utf8")) as object;
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true, strict: true });
  addFormats(ajv);
  const validateReport = ajv.compile(reportSchema);
  const validateManifest = ajv.compile(manifestSchema);

  const report = await verify(fixture("good"));
  assert.equal(validateReport(report), true, JSON.stringify(validateReport.errors));
  for (const version of ["0.6.9", "0.6.14"]) {
    const raw = JSON.parse(await readFile(fixture("..", "..", "docs", "raw", `v0.1-drill-${version}.json`), "utf8")) as unknown;
    assert.equal(validateReport(raw), true, `${version}: ${JSON.stringify(validateReport.errors)}`);
  }

  const temporary = await mkdtemp(join(tmpdir(), "crv-schema-"));
  const set = join(temporary, "set");
  try {
    await cp(fixture("good"), set, { recursive: true });
    const manifestPath = await writeManifest(set);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
    assert.equal(validateManifest(manifest), true, JSON.stringify(validateManifest.errors));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { writeManifest } from "../manifest.js";

const cli = resolve(process.cwd(), "dist", "cli.js");
const fixture = (...parts: string[]): string => resolve(process.cwd(), "test", "fixtures", ...parts);

test("verify reports a nonexistent input as unsupported", async () => {
  const root = await mkdtemp(join(tmpdir(), "crv-cli-missing-"));
  const missing = join(root, "not-present");
  try {
    const result = spawnSync(
      process.execPath,
      [cli, "verify", missing],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 65);
    assert.ok(result.stderr.includes("input path is not accessible: " + missing));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verify rejects a bare manifest date with exit 65 and names the field", async () => {
  const root = await mkdtemp(join(tmpdir(), "crv-cli-date-"));
  try {
    await Promise.all([
      cp(fixture("good", "participant.sql"), join(root, "participant.sql")),
      cp(fixture("good", "validator.sql"), join(root, "validator.sql")),
    ]);
    const path = await writeManifest(root);
    const manifest = JSON.parse(await readFile(path, "utf8")) as { declared: { captureCompletedAt: string | null } };
    manifest.declared.captureCompletedAt = "2026-08-31";
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);

    const result = spawnSync(process.execPath, [cli, "verify", root], { encoding: "utf8" });
    assert.equal(result.status, 65);
    assert.match(result.stderr, /manifest\.declared\.captureCompletedAt must be an RFC 3339 date-time or null; for example 2026-08-31T12:34:56Z/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("inspect directs directory inputs to verify", () => {
  const result = spawnSync(process.execPath, [cli, "inspect", "."], { encoding: "utf8" });
  assert.equal(result.status, 65);
  assert.match(result.stderr, /crv inspect takes a file; use crv verify for a directory: \./);
});

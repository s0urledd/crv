import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const cli = resolve(process.cwd(), "dist", "cli.js");

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

test("inspect directs directory inputs to verify", () => {
  const result = spawnSync(process.execPath, [cli, "inspect", "."], { encoding: "utf8" });
  assert.equal(result.status, 65);
  assert.match(result.stderr, /crv inspect takes a file; use crv verify for a directory: \./);
});

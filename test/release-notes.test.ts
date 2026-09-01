import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

test("release notes are generated from compatibility data", () => {
  const result = spawnSync(process.execPath, ["scripts/render-release-notes.mjs", "--check"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);

  const compatibility = JSON.parse(readFileSync("compatibility.json", "utf8")) as {
    runtime: { drillEvidence: Record<string, unknown> };
  };
  const notes = readFileSync("docs/release-v0.1.0.md", "utf8");
  for (const version of Object.keys(compatibility.runtime.drillEvidence)) {
    const label = "Splice `" + version + "`";
    assert.ok(notes.includes(label), "release notes omit " + label);
  }
});

import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { drill } from "../isolated/drill.js";
import { formatReport } from "../report/human.js";
import { verify } from "../verify.js";

const fixture = (name: string) => resolve(process.cwd(), "test", "fixtures", name);

test("refuses a runtime drill before Docker when exact Splice version is absent", async () => {
  await assert.rejects(() => drill(fixture("good")), /requires one exact Splice version/);
});

test("human report exposes structural failure and cleanup evidence", async () => {
  const report = await verify(fixture("good"));
  report.structuralRestore = {
    status: "FAILED",
    sqlRestored: false,
    participantServing: false,
    identityMatched: null,
    networkIsolated: true,
    details: ["drillError=psql rejected truncated COPY", "cleanup=verified-no-resources-remain"],
  };
  const output = formatReport(report);
  assert.match(output, /SQL restored: NO/);
  assert.match(output, /Identity matched: UNKNOWN/);
  assert.match(output, /psql rejected truncated COPY/);
  assert.match(output, /cleanup=verified-no-resources-remain/);
});

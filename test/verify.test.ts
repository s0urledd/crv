import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { verify } from "../verify.js";

const fixture = (name: string) => resolve(process.cwd(), "test", "fixtures", name);

test("passes the intrinsic offset check without claiming all preconditions are met", async () => {
  const report = await verify(fixture("good"));
  assert.equal(report.preconditions.verdict, "INDETERMINATE");
  assert.equal(report.checks.find((check) => check.id === "backup.offset_order")?.status, "PASS");
  assert.equal(report.structuralRestore.status, "NOT_RUN");
});

test("fails a dangerous reversed pair before restore", async () => {
  const report = await verify(fixture("reversed"));
  assert.equal(report.preconditions.verdict, "FAILED");
  const ordering = report.checks.find((check) => check.id === "backup.offset_order");
  assert.equal(ordering?.status, "FAIL");
  assert.match(ordering?.summary ?? "", /66 exceeds participant ledger end 65/);
});

test("inspects a whole-cluster dump without claiming all preconditions are met", async () => {
  const report = await verify(fixture("cluster"));
  assert.equal(report.preconditions.verdict, "INDETERMINATE");
  assert.equal(report.artifacts[0]?.format, "cluster_dump");
});

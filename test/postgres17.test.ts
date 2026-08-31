import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { drill } from "../isolated/drill.js";
import { writeManifest } from "../manifest.js";
import { verify } from "../verify.js";

const fixture = resolve(process.cwd(), "test", "fixtures", "postgres17");
const guide = "https://docs.canton.network/global-synchronizer/production-operations/validator-postgres-migration";

test("fast verify inspects PostgreSQL 17 dumps without a runtime gate", async () => {
  const report = await verify(fixture);
  assert.deepEqual(report.artifacts.map((artifact) => artifact.postgresSourceVersion), ["17.11 (Debian 17.11-1.pgdg13+2)", "17.11 (Debian 17.11-1.pgdg13+2)"]);
  assert.equal(report.checks.find((check) => check.id === "backup.offset_order")?.status, "PASS");
  assert.equal(report.preconditions.verdict, "INDETERMINATE");
});

test("drill refuses PostgreSQL 17 with both majors and the official migration guide", async () => {
  const root = await mkdtemp(join(tmpdir(), "crv-postgres17-"));
  try {
    await cp(fixture, root, { recursive: true });
    const manifestPath = await writeManifest(root);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    (manifest.declared as Record<string, unknown>).spliceVersion = "0.6.11";
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    await assert.rejects(
      () => drill(root),
      (error: unknown) => error instanceof Error &&
        error.message === `crv drill runtime is pinned to PostgreSQL major 14; participant.sql reports PostgreSQL major 17 (17.11 (Debian 17.11-1.pgdg13+2)). See ${guide}`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

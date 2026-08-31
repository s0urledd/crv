import assert from "node:assert/strict";
import test from "node:test";
import { classifyCompatibilitySchema } from "../compatibility-watch.js";

const version = "0.7.5";
const table = "apps/common/src/main/resources/db/migration/canton-network/postgres/stable/V001__create_schema.sql";
const known = "a".repeat(64);

test("classifies an unchanged compatibility schema", () => {
  const result = classifyCompatibilitySchema(version, table, known, [known]);
  assert.equal(result.outcome, "unchanged");
  assert.match(result.message, /0\.7\.5: unchanged schema/);
  assert.match(result.message, /candidate for TESTED after a drill/);
});

test("classifies a changed compatibility schema with its table and hash", () => {
  const changed = "b".repeat(64);
  const result = classifyCompatibilitySchema(version, table, changed, [known]);
  assert.equal(result.outcome, "changed");
  assert.ok(result.message.includes(table));
  assert.ok(result.message.includes(changed));
});

test("classifies an unfetchable compatibility schema", () => {
  const result = classifyCompatibilitySchema(version, table, null, [known]);
  assert.equal(result.outcome, "unfetchable");
  assert.match(result.message, /outcome=unfetchable/);
});

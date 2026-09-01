#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packagePath = join(root, "package.json");
const compatibilityPath = join(root, "compatibility.json");
const outputPath = join(root, "docs", "release-v0.1.0.md");

const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const compatibility = JSON.parse(await readFile(compatibilityPath, "utf8"));

function compareVersions(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

const versions = Object.entries(compatibility.runtime.drillEvidence)
  .sort(([left], [right]) => compareVersions(left, right))
  .map(([version, evidence]) => `- Splice \`${version}\` ([recorded drill evidence](${evidence.evidence}))`);

const lines = [
  `# crv v${packageJson.version}`,
  "",
  "crv verifies recovery preconditions in artifacts produced by an existing Splice validator backup process.",
  "It reports one evidence-backed verdict and stable JSON without changing the artifacts.",
  "`crv drill` separately restores a selected set into a disposable, network-isolated participant.",
  "",
  "## Install",
  "",
  "Requires Node 22.",
  "",
  "```sh",
  "git clone https://github.com/s0urledd/crv.git",
  "cd crv",
  "git checkout v0.1.0",
  "npm ci",
  "npm run build",
  "npm link",
  "```",
  "",
  "## Recorded drill evidence",
  "",
  ...versions,
  "",
  "## Evidence records",
  "",
  "- [Mis-ordered MainNet pair detected](raw/v0.1-mainnet-verify-misordered-0.6.11.json)",
  "- [First post-fix MainNet drill](raw/v0.1-mainnet-drill-0.6.11.json)",
  "- [MainNet preconditions MET](raw/v0.1-mainnet-drill-met-0.6.11.json)",
  "- [MainNet 7/7 all-applicable MET](raw/v0.1-mainnet-drill-full-met-0.6.11.json)",
  "- [Splice 0.7.5 CI drill](raw/v0.1-ci-drill-0.7.5-schema-1.2.json)",
  "",
  "## Claim boundary",
  "",
  "Do not translate `MET` or structural `PASSED` into `RECOVERABLE`.",
  "",
  "Structural verification does not prove synchronizer catch-up, ACS agreement, or complete production recovery.",
];
const rendered = `${lines.join("\n")}\n`;

if (process.argv.includes("--check")) {
  const current = await readFile(outputPath, "utf8").catch(() => null);
  if (current !== rendered) {
    process.stderr.write("docs/release-v0.1.0.md is not generated from current package and compatibility data\n");
    process.exitCode = 1;
  } else {
    process.stdout.write("release notes are current\n");
  }
} else {
  await writeFile(outputPath, rendered);
  process.stdout.write(`${outputPath}\n`);
}

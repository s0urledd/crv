#!/usr/bin/env node
import { runInspect } from "./inspect.js";
import { runVerify } from "./verify.js";
import { UnsupportedInputError } from "./errors.js";
import { VERSION } from "./version.js";

const HELP = `crv ${VERSION}

Usage:
  crv inspect <dump> [--json]
  crv verify <backup-set|manifest> [--json]
  crv drill <backup-set|manifest> [--json]
  crv manifest <dir>
  crv watch <backup-set|manifest> [--json]
  crv init-config [path]

`;

function usageError(message: string): never {
  process.stderr.write(`${message}\n\n${HELP}`);
  process.exit(64);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--version")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (args.length === 0 || args.includes("--help") || args[0] === "help") {
    process.stdout.write(HELP);
    return;
  }

  const json = args.includes("--json");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const command = positional[0];
  const input = positional[1];
  if (!input) usageError(`${command ?? "command"} requires an input path`);
  if (command === "inspect") {
    await runInspect(input, json);
    return;
  }
  if (command === "verify") {
    process.exitCode = await runVerify(input, json);
    return;
  }
  usageError(`command is not available yet: ${command ?? "<missing>"}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`crv: ${message}\n`);
  process.exitCode = error instanceof UnsupportedInputError ? 65 : 70;
});

#!/usr/bin/env node
import { writeInitialConfig } from "./config.js";
import { UnsupportedInputError } from "./errors.js";
import { runDrill } from "./isolated/drill.js";
import { runInspect } from "./inspect.js";
import { writeManifest } from "./manifest.js";
import { runVerify } from "./verify.js";
import { VERSION } from "./version.js";

const HELP = `crv ${VERSION}

Usage:
  crv inspect <dump> [--json]
  crv verify <backup-set|manifest> [--config <path>] [--json]
  crv drill <backup-set|manifest> [--config <path>] [--json]
  crv manifest <dir>
  crv watch <backup-set|manifest> [--config <path>] [--json]
  crv init-config [path]

`;

function usageError(message: string): never {
  process.stderr.write(`${message}\n\n${HELP}`);
  process.exit(64);
}

interface Arguments {
  command: string;
  positional: string[];
  json: boolean;
  configPath?: string;
}

function parseArguments(args: string[]): Arguments {
  const command = args[0];
  if (!command) usageError("command is required");
  const positional: string[] = [];
  let json = false;
  let configPath: string | undefined;
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--config") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) usageError("--config requires a path");
      configPath = value;
      index += 1;
      continue;
    }
    if (argument?.startsWith("--")) usageError(`unsupported option: ${argument}`);
    if (argument) positional.push(argument);
  }
  return { command, positional, json, ...(configPath === undefined ? {} : { configPath }) };
}

async function main(): Promise<void> {
  const raw = process.argv.slice(2);
  if (raw.includes("--version")) {
    if (raw.length !== 1) usageError("--version does not accept other arguments");
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (raw.length === 0 || raw.includes("--help") || raw[0] === "help") {
    process.stdout.write(HELP);
    return;
  }

  const args = parseArguments(raw);
  if (args.command === "init-config") {
    if (args.json || args.configPath !== undefined || args.positional.length > 1) usageError("init-config accepts only an optional output path");
    process.stdout.write(`${await writeInitialConfig(args.positional[0])}\n`);
    return;
  }
  if (args.positional.length !== 1) usageError(`${args.command} requires exactly one input path`);
  const input = args.positional[0];
  if (!input) usageError(`${args.command} requires an input path`);

  if (args.command === "inspect") {
    if (args.configPath !== undefined) usageError("inspect does not accept --config");
    await runInspect(input, args.json);
    return;
  }
  if (args.command === "verify") {
    process.exitCode = await runVerify(input, args.json, args.configPath);
    return;
  }
  if (args.command === "drill") {
    process.exitCode = await runDrill(input, args.json, args.configPath);
    return;
  }
  if (args.command === "manifest") {
    if (args.json || args.configPath !== undefined) usageError("manifest does not accept options");
    process.stdout.write(`${await writeManifest(input)}\n`);
    return;
  }
  usageError(`command is not available yet: ${args.command}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`crv: ${message}\n`);
  process.exitCode = error instanceof UnsupportedInputError ? 65 : 70;
});

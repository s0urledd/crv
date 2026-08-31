import { compatibility } from "./compatibility.js";
import { classifyCompatibilitySchema } from "./compatibility-watch.js";

const version = process.argv[2] ?? "unknown";
const table = process.argv[3] ?? "unknown";
const observedHash = process.argv[4] === "unfetchable" ? null : process.argv[4] ?? null;
const knownHashes = compatibility.schemaFamilies.map((family) => family.sourceDefinitionSha256);
const result = classifyCompatibilitySchema(version, table, observedHash, knownHashes);
const output = result.outcome === "unchanged" ? process.stdout : process.stderr;
output.write(result.message + "\n");
process.exitCode = result.outcome === "unchanged" ? 0 : result.outcome === "changed" ? 1 : 2;

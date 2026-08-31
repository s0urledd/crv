export type CompatibilityWatchOutcome = "unchanged" | "changed" | "unfetchable";

export interface CompatibilityWatchResult {
  outcome: CompatibilityWatchOutcome;
  message: string;
}

export function classifyCompatibilitySchema(
  version: string,
  table: string,
  observedHash: string | null,
  knownHashes: string[],
): CompatibilityWatchResult {
  if (observedHash === null) {
    return {
      outcome: "unfetchable",
      message: `Splice ${version}: could not fetch schema source for ${table}; outcome=unfetchable.`,
    };
  }
  if (knownHashes.includes(observedHash)) {
    return {
      outcome: "unchanged",
      message: `Splice ${version}: unchanged schema for ${table} at ${observedHash}; candidate for TESTED after a drill.`,
    };
  }
  return {
    outcome: "changed",
    message: `Splice ${version}: changed schema for ${table}; unrecognized hash ${observedHash}.`,
  };
}

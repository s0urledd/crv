import type { BackupSetInspection } from "./backup-set.js";
import type { CrvConfig } from "./config.js";
import type { VersionObservation } from "./types.js";

export interface BackupVersionEvidenceEntry {
  value: string;
  source: string;
}

export interface BackupVersionEvidence {
  entries: BackupVersionEvidenceEntry[];
  values: string[];
}

export function formatBackupVersionEvidence(entries: BackupVersionEvidenceEntry[]): string {
  return entries.map((entry) => `${entry.value} (${entry.source})`).join(", ");
}

export function backupVersionEvidence(set: BackupSetInspection): BackupVersionEvidence {
  const entries: BackupVersionEvidenceEntry[] = [];
  const declared = set.manifest?.declared.spliceVersion;
  if (declared) entries.push({ value: declared, source: "manifest.declared.spliceVersion" });
  for (const artifact of set.artifacts) {
    if (!artifact.spliceVersion) continue;
    entries.push({ value: artifact.spliceVersion, source: `artifact:${artifact.path}` });
  }
  const unique = [...new Map(entries.map((entry) => [`${entry.value}\u0000${entry.source}`, entry])).values()]
    .sort((left, right) => left.value.localeCompare(right.value) || left.source.localeCompare(right.source));
  return {
    entries: unique,
    values: [...new Set(unique.map((entry) => entry.value))],
  };
}

export function observeBackupVersion(set: BackupSetInspection): VersionObservation {
  const evidence = backupVersionEvidence(set);
  const sources = [...new Set(evidence.entries.map((entry) => entry.source))];
  if (evidence.values.length === 0) {
    return {
      status: "UNKNOWN",
      value: null,
      source: null,
      commitTs: null,
      detail: "No Splice version is intrinsic to the selected database artifacts or declared in a manifest.",
    };
  }
  if (evidence.values.length !== 1) {
    return {
      status: "UNKNOWN",
      value: null,
      source: sources.join(", "),
      commitTs: null,
      detail: `Conflicting backup-set versions: ${formatBackupVersionEvidence(evidence.entries)}.`,
    };
  }
  return {
    status: "OBSERVED",
    value: evidence.values[0] ?? null,
    source: sources.join(", "),
    commitTs: null,
    detail: "One exact backup-set Splice version was observed.",
  };
}

function unknownNetwork(source: string | null, detail: string): VersionObservation {
  return { status: "UNKNOWN", value: null, source, commitTs: null, detail };
}

export async function observeNetworkVersion(
  config: CrvConfig | null,
  fetcher: typeof fetch = fetch,
): Promise<VersionObservation> {
  const endpoint = config?.network.scanVersionUrl ?? null;
  if (endpoint === null) {
    return unknownNetwork(null, "No Scan version endpoint is configured; verification remained offline.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetcher(endpoint, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) return unknownNetwork(endpoint, `Scan version endpoint returned HTTP ${response.status}.`);
    const length = response.headers.get("content-length");
    if (length !== null && Number(length) > 65536) {
      return unknownNetwork(endpoint, "Scan version response exceeded 64 KiB.");
    }
    const body = await response.text();
    if (Buffer.byteLength(body) > 65536) return unknownNetwork(endpoint, "Scan version response exceeded 64 KiB.");
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (typeof parsed.version !== "string" || parsed.version.length === 0 ||
        typeof parsed.commit_ts !== "string" || Number.isNaN(Date.parse(parsed.commit_ts))) {
      return unknownNetwork(endpoint, "Scan version response did not match {version, commit_ts}.");
    }
    return {
      status: "OBSERVED",
      value: parsed.version,
      source: endpoint,
      commitTs: parsed.commit_ts,
      detail: "Network version reported by the configured public Scan API.",
    };
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError" ? "timed out" : "was unreachable or invalid";
    return unknownNetwork(endpoint, `Scan version endpoint ${reason}; this does not fail backup verification.`);
  } finally {
    clearTimeout(timeout);
  }
}

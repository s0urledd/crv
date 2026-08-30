import type { BackupSetInspection } from "./backup-set.js";
import type { CrvConfig } from "./config.js";
import type { VersionObservation } from "./types.js";

export interface BackupVersionEvidence {
  values: string[];
  sources: string[];
}

export function backupVersionEvidence(set: BackupSetInspection): BackupVersionEvidence {
  const values = new Set<string>();
  const sources = new Set<string>();
  const declared = set.manifest?.declared.spliceVersion;
  if (declared) {
    values.add(declared);
    sources.add("manifest.declared.spliceVersion");
  }
  for (const artifact of set.artifacts) {
    if (!artifact.spliceVersion) continue;
    values.add(artifact.spliceVersion);
    sources.add(`artifact:${artifact.path}`);
  }
  return { values: [...values].sort(), sources: [...sources].sort() };
}

export function observeBackupVersion(set: BackupSetInspection): VersionObservation {
  const evidence = backupVersionEvidence(set);
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
      source: evidence.sources.join(", "),
      commitTs: null,
      detail: `Conflicting backup-set versions: ${evidence.values.join(", ")}.`,
    };
  }
  return {
    status: "OBSERVED",
    value: evidence.values[0] ?? null,
    source: evidence.sources.join(", "),
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

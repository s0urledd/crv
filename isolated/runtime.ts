import type { BackupSetInspection } from "../backup-set.js";
import { compatibility } from "../compatibility.js";
import { DrillEnvironmentError, UnsupportedInputError } from "../errors.js";
import { backupVersionEvidence } from "../versions.js";
import { runProcess } from "./docker.js";

interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

type ProcessRunner = (command: string, args: string[], allowFailure?: boolean) => Promise<ProcessResult>;

export interface DrillRuntime {
  spliceVersion: string;
  postgresImage: string;
  postgresMajor: number;
  participantImage: string;
  versionEvidence: "TESTED" | "UNVERIFIED";
  testedAt: string | null;
  evidence: string | null;
}

export function exactDrillVersion(set: BackupSetInspection): string {
  const evidence = backupVersionEvidence(set);
  if (evidence.values.length === 0) {
    throw new UnsupportedInputError("crv drill requires one exact Splice version from manifest or identities export");
  }
  if (evidence.values.length !== 1) {
    throw new UnsupportedInputError(`crv drill requires one exact Splice version; conflicting evidence: ${evidence.values.join(", ")}`);
  }
  const version = evidence.values[0];
  if (!version || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(version)) {
    throw new UnsupportedInputError("crv drill received a Splice version that is not a valid container tag");
  }
  return version;
}

function parseRepoDigests(stdout: string, repository: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const prefix = repository + "@sha256:";
  const matches = parsed.filter(
    (value): value is string => typeof value === "string" &&
      value.startsWith(prefix) && /^[0-9a-f]{64}$/.test(value.slice(prefix.length)),
  );
  return matches.length === 1 ? matches[0] ?? null : null;
}

export async function resolveDrillRuntime(
  set: BackupSetInspection,
  runner: ProcessRunner = runProcess,
): Promise<DrillRuntime> {
  const spliceVersion = exactDrillVersion(set);
  const tested = compatibility.runtime.drillEvidence[spliceVersion];
  if (tested) {
    return {
      spliceVersion,
      postgresImage: compatibility.runtime.postgresImage,
      postgresMajor: tested.postgresMajor,
      participantImage: tested.participantImage,
      versionEvidence: "TESTED",
      testedAt: tested.testedAt,
      evidence: tested.evidence,
    };
  }

  const tag = `${compatibility.runtime.participantImageRepository}:${spliceVersion}`;
  try {
    await runner("docker", ["pull", tag]);
  } catch {
    throw new DrillEnvironmentError(
      `could not pull participant image for Splice ${spliceVersion}; crv verify still runs fast checks`,
    );
  }
  const inspected = await runner("docker", ["image", "inspect", tag, "--format", "{{json .RepoDigests}}"], true);
  const participantImage = inspected.code === 0
    ? parseRepoDigests(inspected.stdout, compatibility.runtime.participantImageRepository)
    : null;
  if (participantImage === null) {
    throw new DrillEnvironmentError(
      `could not resolve one immutable participant image digest for Splice ${spliceVersion}; crv verify still runs fast checks`,
    );
  }
  return {
    spliceVersion,
    postgresImage: compatibility.runtime.postgresImage,
    postgresMajor: compatibility.runtime.postgresMajor,
    participantImage,
    versionEvidence: "UNVERIFIED",
    testedAt: null,
    evidence: null,
  };
}

import { randomBytes } from "node:crypto";
import { compatibility } from "../compatibility.js";
import type { ArtifactInspection } from "../types.js";
import { inspectBackupSet, type BackupSetInspection } from "../backup-set.js";
import { checkSelectedIdentity } from "../checks/selected-identity.js";
import { loadConfig, type CrvConfig } from "../config.js";
import { DrillEnvironmentError, UnsupportedInputError } from "../errors.js";
import { aggregate, exitCode } from "../report/aggregate.js";
import { formatReport } from "../report/human.js";
import type { CleanupStatus, VerificationReport } from "../types.js";
import { buildVerificationReport } from "../verify.js";
import { observeNetworkVersion } from "../versions.js";
import { DrillResources, runProcess, streamDockerInput } from "./docker.js";
import { resolveDrillRuntime, type DrillRuntime } from "./runtime.js";

function artifactRoles(set: BackupSetInspection, artifact: ArtifactInspection): string[] {
  if (!artifact.roles.includes("unknown")) return artifact.roles;
  return set.manifest?.artifacts.find((reference) => reference.path === artifact.path)?.roles ?? artifact.roles;
}

function sanitizeDrillError(error: Error): string {
  return error.message
    .split(/\r?\n/)
    .slice(0, 4)
    .map((line) => line.replace(/(COPY [^,]+, line \d+:).*$/, "$1 <artifact row redacted>"))
    .join(" | ")
    .slice(0, 2048);
}

function databaseName(value: string | null, label: string): string {
  if (value === null) throw new UnsupportedInputError(`crv drill requires ${label} database name in config or manifest`);
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new UnsupportedInputError(`${label} database name contains unsupported characters`);
  return value;
}

function quotedIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function restoreArtifact(
  resources: DrillResources,
  set: BackupSetInspection,
  artifact: ArtifactInspection,
  database: string,
): Promise<void> {
  const location = set.artifactLocations.get(artifact.path);
  if (!location) throw new Error(`artifact location is unavailable: ${artifact.path}`);
  const command = artifact.format === "custom_dump"
    ? ["exec", "-i", resources.postgres, "pg_restore", "--exit-on-error", "--no-owner", "-U", "postgres", "-d", database]
    : ["exec", "-i", resources.postgres, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database];
  await streamDockerInput(command, location, artifact.compression);
}

function expectedIdentity(set: BackupSetInspection, config: CrvConfig | null): string | null {
  const values = new Set<string>();
  if (set.manifest?.declared.expectedParticipantId) values.add(set.manifest.declared.expectedParticipantId);
  if (config?.deployment.expectedParticipantId) values.add(config.deployment.expectedParticipantId);
  for (const artifact of set.artifacts) {
    if (artifact.identityStructureValid === true && artifact.participantId) values.add(artifact.participantId);
  }
  return values.size === 1 ? [...values][0] ?? null : null;
}

async function environmentStep<T>(label: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof DrillEnvironmentError) throw error;
    const failure = error instanceof Error ? error : new Error(String(error));
    throw new DrillEnvironmentError(label + ": " + sanitizeDrillError(failure));
  }
}

function elapsedMilliseconds(startedAt: bigint): number {
  return Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
}

async function timedPhase<T>(
  details: string[],
  name: string,
  action: () => Promise<T>,
): Promise<T> {
  const startedAt = process.hrtime.bigint();
  try {
    return await action();
  } finally {
    details.push(`timing.${name}Ms=${elapsedMilliseconds(startedAt)}`);
  }
}

async function executeDrill(
  set: BackupSetInspection,
  config: CrvConfig | null,
  report: VerificationReport,
  runtime: DrillRuntime,
): Promise<{ participantId: string | null; participantDatabase: string; error: Error | null; failureKind: "backup" | "environment" | null }> {
  const resources = new DrillResources();
  const details = report.structuralRestore.details;
  const totalStartedAt = process.hrtime.bigint();
  let sqlRestored: boolean | null = null;
  let participantContainerHealthy: boolean | null = null;
  let networkIsolated: boolean | null = null;
  let participantId: string | null = null;
  let participantDatabase = "";
  let failure: Error | null = null;
  let failureKind: "backup" | "environment" | null = null;
  let cleanupStatus: CleanupStatus = "NOT_RUN";
  let signalCleanup: Promise<CleanupStatus> | null = null;
  const onSignal = (): void => {
    signalCleanup ??= resources.cleanup();
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  const password = randomBytes(24).toString("hex");
  try {
    await environmentStep("Docker resource creation failed", () => resources.create());
    const internal = await environmentStep("Docker network inspection failed", () =>
      runProcess("docker", ["network", "inspect", resources.network, "--format", "{{.Internal}}"]));
    networkIsolated = internal.stdout.trim() === "true";
    if (!networkIsolated) throw new DrillEnvironmentError("disposable Docker network is not internal");

    await timedPhase(details, "imagePull", () =>
      environmentStep("Drill image pull failed", async () => {
        await Promise.all([
          runProcess("docker", ["pull", runtime.postgresImage]),
          runProcess("docker", ["pull", runtime.participantImage]),
        ]);
      }));

    await timedPhase(details, "postgresStartup", () =>
      environmentStep("PostgreSQL drill container startup failed", async () => {
        await runProcess("docker", [
          "run", "-d", "--name", resources.postgres, "--network", resources.network, "--network-alias", "postgres",
          "--label", `crv.run=${resources.id}`, "-v", `${resources.volume}:/var/lib/postgresql/data`,
          "-e", "POSTGRES_USER=postgres", "-e", `POSTGRES_PASSWORD=${password}`,
          "--health-cmd=pg_isready -U postgres", "--health-interval=1s", "--health-timeout=3s", "--health-retries=60",
          runtime.postgresImage,
        ]);
        await resources.waitHealthy(resources.postgres, 90);
      }));

    await timedPhase(details, "sqlRestore", async () => {
      const cluster = set.artifacts.filter((artifact) => artifact.format === "cluster_dump");
      const databaseArtifacts = set.artifacts.filter((artifact) => {
        const roles = artifactRoles(set, artifact);
        return artifact.format !== "cluster_dump" && (roles.includes("participant") || roles.includes("validator"));
      });
      if (cluster.length > 0 && databaseArtifacts.length > 0) throw new UnsupportedInputError("crv drill refuses a mixed cluster/per-database set");
      if (cluster.length > 1) throw new UnsupportedInputError("crv drill requires exactly one selected pg_dumpall artifact");
      sqlRestored = false;

      participantDatabase = databaseName(
        config?.deployment.participantDatabase ?? set.manifest?.declared.participantDatabase ?? null,
        "participant",
      );
      const validatorDatabase = config?.deployment.validatorDatabase ?? set.manifest?.declared.validatorDatabase ?? null;

      if (cluster.length === 1) {
        const artifact = cluster[0];
        if (!artifact) throw new Error("cluster artifact selection failed");
        await restoreArtifact(resources, set, artifact, "postgres");
      } else {
        const participants = databaseArtifacts.filter((artifact) => artifactRoles(set, artifact).includes("participant"));
        const validators = databaseArtifacts.filter((artifact) => artifactRoles(set, artifact).includes("validator"));
        if (participants.length !== 1 || validators.length !== 1) {
          throw new UnsupportedInputError("crv drill requires exactly one participant and one validator database artifact");
        }
        const selectedValidatorDatabase = databaseName(validatorDatabase, "validator");
        await runProcess("docker", ["exec", resources.postgres, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", "CREATE ROLE cnadmin"]);
        for (const database of [selectedValidatorDatabase, participantDatabase]) {
          await runProcess("docker", ["exec", resources.postgres, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", `CREATE DATABASE ${quotedIdentifier(database)}`]);
        }
        const validator = validators[0];
        const participant = participants[0];
        if (!validator || !participant) throw new Error("database artifact selection failed");
        await restoreArtifact(resources, set, validator, selectedValidatorDatabase);
        await restoreArtifact(resources, set, participant, participantDatabase);
      }
      sqlRestored = true;
    });

    await timedPhase(details, "participantStartup", async () => {
      await environmentStep("Participant drill container launch failed", () => runProcess("docker", [
        "run", "-d", "--name", resources.participant, "--network", resources.network,
        "--label", `crv.run=${resources.id}`,
        "-e", "CANTON_PARTICIPANT_POSTGRES_SERVER=postgres", "-e", "CANTON_PARTICIPANT_POSTGRES_PORT=5432",
        "-e", `CANTON_PARTICIPANT_POSTGRES_DB=${participantDatabase}`, "-e", "CANTON_PARTICIPANT_POSTGRES_SCHEMA=participant",
        "-e", "CANTON_PARTICIPANT_POSTGRES_USER=postgres", "-e", `CANTON_PARTICIPANT_POSTGRES_PASSWORD=${password}`,
        "-e", "AUTH_JWKS_URL=http://127.0.0.1:1", "-e", "AUTH_TARGET_AUDIENCE=https://canton.network.global",
        "-e", "CANTON_PARTICIPANT_ADMIN_USER_NAME=ledger-api-user",
        "-e", "ADDITIONAL_CONFIG_LEDGER_AUTH=canton.participants.participant.ledger-api.auth-services=[]",
        runtime.participantImage,
      ]));
      participantContainerHealthy = false;
      await resources.waitHealthy(resources.participant, compatibility.runtime.participantStartupTimeoutSeconds);
      participantContainerHealthy = true;
    });

    const identity = await runProcess("docker", [
      "exec", resources.postgres, "psql", "-U", "postgres", "-d", participantDatabase, "-Atc",
      "select 'PAR::' || identifier || '::' || namespace from participant.common_node_id where identifier='participant'",
    ]);
    participantId = identity.stdout.trim() || null;
    details.push(`runtime=${runtime.spliceVersion}`, `postgresImage=${runtime.postgresImage}`, `participantImage=${runtime.participantImage}`, `versionEvidence=${runtime.versionEvidence}`);
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
    failureKind = failure instanceof DrillEnvironmentError ? "environment" : "backup";
    details.push((failureKind === "environment" ? "environmentError=" : "drillError=") + sanitizeDrillError(failure));
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    report.structuralRestore.sqlRestored = sqlRestored;
    report.structuralRestore.participantContainerHealthy = participantContainerHealthy;
    report.structuralRestore.networkIsolated = networkIsolated;
    if (signalCleanup !== null) {
      cleanupStatus = await signalCleanup;
      details.push("signalCleanup=" + cleanupStatus);
    }
    cleanupStatus = await resources.cleanup();
    report.structuralRestore.cleanupStatus = cleanupStatus;
    details.push("cleanup=" + cleanupStatus);
    if (cleanupStatus !== "VERIFIED_ABSENT") {
      failure = new DrillEnvironmentError(cleanupStatus === "VERIFIED_PRESENT"
        ? "drill resources remain after cleanup"
        : "drill cleanup could not be verified because Docker probes failed");
      failureKind = "environment";
    }
    details.push(`timing.totalMs=${elapsedMilliseconds(totalStartedAt)}`);
  }
  return { participantId, participantDatabase, error: failure, failureKind };
}

export async function drill(input: string, configPath?: string, now = new Date()): Promise<VerificationReport> {
  const [set, config] = await Promise.all([
    inspectBackupSet(input),
    configPath === undefined ? Promise.resolve<CrvConfig | null>(null) : loadConfig(configPath),
  ]);
  const databaseArtifacts = set.artifacts.filter((artifact) => {
    const roles = artifactRoles(set, artifact);
    return ["plain_dump", "custom_dump", "cluster_dump"].includes(artifact.format) &&
      roles.some((role) => role === "participant" || role === "validator" || role === "cluster");
  });
  const unknownPostgres = databaseArtifacts.find((artifact) => artifact.postgresSourceVersion === null);
  if (unknownPostgres) {
    throw new UnsupportedInputError(`crv drill requires PostgreSQL source version evidence for ${unknownPostgres.path}`);
  }
  const report = buildVerificationReport(input, set, config, now);
  report.versions.network = await observeNetworkVersion(config);
  let runtime: DrillRuntime;
  try {
    runtime = await resolveDrillRuntime(set);
  } catch (error) {
    if (!(error instanceof DrillEnvironmentError)) throw error;
    report.structuralRestore.status = "ENVIRONMENT_ERROR";
    report.structuralRestore.details.push("environmentError=" + sanitizeDrillError(error));
    return report;
  }
  const postgresPattern = new RegExp(`^${runtime.postgresMajor}(?:\\.|\\s|$)`);
  const unsupportedPostgres = databaseArtifacts
    .map((artifact) => artifact.postgresSourceVersion as string)
    .find((version) => !postgresPattern.test(version));
  if (unsupportedPostgres) throw new UnsupportedInputError(`isolated runtime drill supports PostgreSQL ${runtime.postgresMajor} artifacts; received ${unsupportedPostgres}`);

  report.structuralRestore.runtime = {
    spliceVersion: runtime.spliceVersion,
    participantImage: runtime.participantImage,
    versionEvidence: runtime.versionEvidence,
    testedAt: runtime.testedAt,
    evidence: runtime.evidence,
  };
  const result = await executeDrill(set, config, report, runtime);
  const expected = expectedIdentity(set, config);
  const identityMatched = result.error === null && expected !== null ? result.participantId === expected : false;
  report.structuralRestore.identityMatched = result.error !== null || expected === null ? null : identityMatched;
  report.structuralRestore.status = result.failureKind === "environment"
    ? "ENVIRONMENT_ERROR"
    : result.error === null && report.structuralRestore.sqlRestored === true &&
    report.structuralRestore.participantContainerHealthy === true && report.structuralRestore.networkIsolated === true && identityMatched
    ? (runtime.versionEvidence === "TESTED" ? "PASSED" : "PASSED_UNVERIFIED_VERSION")
    : "FAILED";

  const selectedIndex = report.checks.findIndex((check) => check.id === "deployment.selected_identity");
  if (selectedIndex >= 0 && result.error === null) {
    report.checks[selectedIndex] = checkSelectedIdentity(
      set.artifacts,
      set.manifest,
      config,
      { database: result.participantDatabase, participantId: result.participantId },
    );
    report.preconditions = aggregate(report.checks);
  }
  if (expected === null) report.structuralRestore.details.push("identityMatch=unknown-no-single-expected-identity");
  return report;
}

export function drillExitCode(report: VerificationReport): number {
  if (report.structuralRestore.status === "ENVIRONMENT_ERROR") return 70;
  if (report.structuralRestore.status === "FAILED") return 2;
  return exitCode(report.preconditions.verdict);
}

export async function runDrill(input: string, json: boolean, configPath?: string): Promise<number> {
  const report = await drill(input, configPath);
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : `${formatReport(report)}\n`);
  return drillExitCode(report);
}

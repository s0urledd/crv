import type { VerificationReport } from "../types.js";

function yesNo(value: boolean | null): string {
  return value === null ? "UNKNOWN" : value ? "YES" : "NO";
}

export function formatReport(report: VerificationReport): string {
  const rows = report.checks.map((check) => [
    check.applicable ? check.status : "N/A",
    check.id,
    check.evidenceClass.replaceAll("_", " "),
    check.summary,
  ]);
  const minimums = [6, 20, 20];
  const widths = [0, 1, 2].map((column) => Math.max(minimums[column] ?? 0, ...rows.map((row) => row[column]?.length ?? 0)));
  const structural = report.structuralRestore;
  const structuralHeadline = structural.status === "ENVIRONMENT_ERROR"
    ? "Offline structural restore: ENVIRONMENT_ERROR (the drill environment prevented execution)"
    : "Offline structural restore: " + structural.status;
  const output = [
    `Recovery preconditions: ${report.preconditions.verdict}`,
    structuralHeadline,
    `Backup Splice version: ${report.versions.backup.value ?? "UNKNOWN"} (${report.versions.backup.status})`,
    `Network Splice version: ${report.versions.network.value ?? "UNKNOWN"} (${report.versions.network.status})`,
  ];
  if (structural.status !== "NOT_RUN") {
    output.push(
      `  SQL restored: ${yesNo(structural.sqlRestored)}`,
      `  Participant container healthcheck: ${yesNo(structural.participantContainerHealthy)}`,
      `  Identity matched: ${yesNo(structural.identityMatched)}`,
      `  Network isolated: ${yesNo(structural.networkIsolated)}`,
      `  Cleanup status: ${structural.cleanupStatus}`,
      `  Runtime Splice version: ${structural.runtime.spliceVersion ?? "UNKNOWN"}`,
      `  Participant image: ${structural.runtime.participantImage ?? "UNKNOWN"}`,
      `  Runtime version evidence: ${structural.runtime.versionEvidence ?? "UNKNOWN"}`,
      ...structural.details.map((detail) => `  Detail: ${detail}`),
    );
  }
  for (const artifact of report.artifacts) {
    for (const limitation of artifact.limitations) output.push("Artifact limitation [" + artifact.path + "]: " + limitation);
  }
  output.push(
    "",
    `${"STATUS".padEnd(widths[0] ?? 6)}  ${"CHECK".padEnd(widths[1] ?? 20)}  ${"CLASS".padEnd(widths[2] ?? 20)}  RESULT`,
  );
  for (const row of rows) {
    output.push(
      `${(row[0] ?? "").padEnd(widths[0] ?? 6)}  ${(row[1] ?? "").padEnd(widths[1] ?? 20)}  ${(row[2] ?? "").padEnd(widths[2] ?? 20)}  ${row[3] ?? ""}`,
    );
  }
  for (const check of report.checks.filter((candidate) => candidate.applicable && (candidate.status === "UNKNOWN" || candidate.status === "FAIL"))) {
    output.push("Remediation for " + check.id + ": " + check.remediation);
    for (const requirement of check.requiredEvidence) output.push("Need for " + check.id + ": " + requirement);
  }
  output.push("", "This verdict does not prove synchronizer catch-up or complete recovery success.");
  return output.join("\n");
}

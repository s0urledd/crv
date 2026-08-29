import type { VerificationReport } from "../types.js";

export function formatReport(report: VerificationReport): string {
  const rows = report.checks.map((check) => [
    check.applicable ? check.status : "N/A",
    check.id,
    check.evidenceClass.replaceAll("_", " "),
    check.summary,
  ]);
  const minimums = [6, 20, 20];
  const widths = [0, 1, 2].map((column) => Math.max(minimums[column] ?? 0, ...rows.map((row) => row[column]?.length ?? 0)));
  const output = [
    `Recovery preconditions: ${report.preconditions.verdict}`,
    `Offline structural restore: ${report.structuralRestore.status}`,
    "",
    `${"STATUS".padEnd(widths[0] ?? 6)}  ${"CHECK".padEnd(widths[1] ?? 20)}  ${"CLASS".padEnd(widths[2] ?? 20)}  RESULT`,
  ];
  for (const row of rows) {
    output.push(
      `${(row[0] ?? "").padEnd(widths[0] ?? 6)}  ${(row[1] ?? "").padEnd(widths[1] ?? 20)}  ${(row[2] ?? "").padEnd(widths[2] ?? 20)}  ${row[3] ?? ""}`,
    );
  }
  for (const check of report.checks.filter((candidate) => candidate.applicable && candidate.status === "UNKNOWN")) {
    for (const requirement of check.requiredEvidence) output.push(`Need for ${check.id}: ${requirement}`);
  }
  output.push("", "This verdict does not prove synchronizer catch-up or complete recovery success.");
  return output.join("\n");
}

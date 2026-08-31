import type { ArtifactInspection, CheckResult, PreconditionsVerdict } from "../types.js";

export function hasCompleteDatabasePair(artifacts: ArtifactInspection[]): boolean {
  const roles = new Set(artifacts.flatMap((artifact) => artifact.roles));
  return roles.has("participant") && roles.has("validator");
}

export function aggregate(checks: CheckResult[], completeDatabasePair = true): {
  verdict: PreconditionsVerdict;
  pass: number;
  fail: number;
  warn: number;
  unknown: number;
} {
  const applicable = checks.filter((check) => check.applicable);
  const pass = applicable.filter((check) => check.status === "PASS").length;
  const fail = applicable.filter((check) => check.status === "FAIL").length;
  const warn = applicable.filter((check) => check.status === "WARN").length;
  const unknown = applicable.filter((check) => check.status === "UNKNOWN").length;
  const computed: PreconditionsVerdict = fail > 0 ? "FAILED" : unknown > 0 ? "INDETERMINATE" : warn > 0 ? "AT_RISK" : "MET";
  const verdict: PreconditionsVerdict = computed === "MET" && !completeDatabasePair ? "INDETERMINATE" : computed;
  return { verdict, pass, fail, warn, unknown };
}

export function exitCode(verdict: PreconditionsVerdict): number {
  switch (verdict) {
    case "MET": return 0;
    case "AT_RISK": return 1;
    case "FAILED": return 2;
    case "INDETERMINATE": return 3;
  }
}

# v0.1 command and report contract

The v0.1 machine interface is JSON report schema `1.2`. Consumers must select
on `schemaVersion`, not the package version. The normative schema is
[`report-schema-v1.2.json`](report-schema-v1.2.json). Reports with
`schemaVersion` 1.1 validate against `report-schema-v1.1.json`; 1.2 is the
current contract.

`verify` is the fast, read-only path. It inspects artifacts and provenance but
does not start containers or compute a digest unless a reference digest must be
checked. `drill` performs the same checks and then attempts the disposable,
network-isolated structural restore. These are separate commands because a
successful drill does not promote the precondition verdict and a precondition
failure is not hidden by a successful PostgreSQL restore.

Commands:

```text
crv inspect <artifact> [--json]
crv verify <backup-set|manifest> [--config <path>] [--json]
crv drill <backup-set|manifest> [--config <path>] [--json]
crv manifest <dir>
crv watch <backup-set|manifest> [--config <path>] [--json]
crv init-config [path]
```

The default report prints both dimensions:

```text
Recovery preconditions: INDETERMINATE
Offline structural restore: NOT_RUN
Backup Splice version: UNKNOWN (UNKNOWN)
Network Splice version: UNKNOWN (UNKNOWN)
```

The JSON equivalent keeps `preconditions`, `versions`, and `structuralRestore` as sibling
objects. `MET` means only that every applicable, shipped recovery-precondition
check had sufficient evidence and passed. It never means `RECOVERABLE` and does
not prove synchronizer catch-up.

Fast `verify` tops out at `INDETERMINATE`: database sets still require the
offline selected-identity check, while identities-only sets have no complete
database pair. `MET` is reachable only after a successful drill.

Every applicable `UNKNOWN` result has at least one `requiredEvidence` entry
that tells the operator exactly what value or artifact would resolve it.
A non-applicable check remains visible with `applicable: false`; human output
renders it as `N/A`.

## Exit codes

| Code | Meaning |
| ---: | --- |
| 0 | Preconditions `MET` |
| 1 | Preconditions `AT_RISK` |
| 2 | Preconditions `FAILED` |
| 3 | Preconditions `INDETERMINATE` |
| 64 | Invalid command or arguments |
| 65 | Unsupported or unrecognised input/version |
| 70 | Drill environment or internal execution error |

`--json` changes only presentation. It never changes checks, verdict, or exit
code. A backup-caused `drill` structural failure is represented in
`structuralRestore`; it must exit at least 2 even if no precondition check failed.
Cleanup that leaves resources or cannot be verified is an execution error (70), because isolation can no longer be asserted.

## Path and mutation rules

Artifact paths inside a set report and manifest are relative to the set root.
A standalone `inspect` report uses the path supplied by the caller. The tool
opens backup artifacts read-only and never changes bytes, mode, ownership, or
timestamps. Watch state is separate and configurable; it is never written
inside the backup set unless the operator explicitly chooses that path.

## Manifest and config

`crv manifest <dir>` writes `crv-manifest.json` atomically. Its normative schema
is [`manifest-schema-v1.json`](manifest-schema-v1.json). Artifact paths are
portable and relative to the manifest directory. Refresh preserves declared
provenance, recomputes artifact size/digest references, and never derives a
capture timestamp from mtime.

Manifests written by current crv binaries may include the additive `database`
role and are rejected by older crv binaries; the manifest schema remains 1.0
because readers of this version can accept the additive role.

The declared participant database name is an input that selects which restored
database the drill starts and queries. The report records both the declared and
restored names, but the drill cannot independently confirm that the declaration
was the live deployment's effective database name.

`crv init-config [path]` writes a commented, runnable `crv.yaml` and refuses to
overwrite an existing file. Pass it with `--config <path>`. A horizon has no
evidentiary value without `sequencerHorizonSource`; an LSU usability assertion
likewise requires its source.
Example: "SV 30-day pruning window (DA, 2026-08-31): [https://github.com/canton-foundation/canton-dev-fund/pull/750](https://github.com/canton-foundation/canton-dev-fund/pull/750)". Re-verify
the horizon against current network announcements when configuring it.

An optional `network.backupAgeWarnFraction` must be greater than 0 and
less than 1. When configured, an age strictly above that fraction of the
sourced horizon is `WARN`, so otherwise-complete preconditions
become `AT_RISK` and exit 1. Equality remains `PASS`; null disables the warning
and crv assumes no threshold.
`sequencerHorizonSource` and
`capturedPhysicalSynchronizerUsabilitySource` are operator-declared strings.
crv records them but does not validate their authority or contents; report
evidence explicitly marks the corresponding source validation as `false`.

`network.scanVersionUrl` is optional; when absent, verification stays offline.
When configured, an unavailable or malformed public
Scan version response is informational `UNKNOWN` and never changes a check
verdict. Watch state defaults to `.crv/state.json` and reports to `crv-reports`,
both outside backup artifacts.

See [Operator evidence inputs](operator-guide.md) for pinned, read-only compose
and Scan commands that populate synchronizer fields, plus provider-neutral
identities refresh guidance.

## Drill runtime boundary

Fast inspection enables D2 only for an exact schema family recorded in
`compatibility.json`; release numbers do not select adapters. The drill requires
one exact artifact Splice version. Recorded versions use their tested pinned
digest and may report `PASSED`. Unrecorded versions pull the exact tag, resolve
and run one immutable digest, and may report `PASSED_UNVERIFIED_VERSION`. Pull or
digest-resolution failure reports `ENVIRONMENT_ERROR` while fast `verify` remains
available. Both passing statuses require SQL restore, participant container
healthcheck success, selected-DB identity equality, network isolation, and
verified cleanup. See the recorded [LocalNet CLI drill evidence](raw/v0.1-drill.txt).

Fast inspection accepts PostgreSQL 17 logical dumps. The isolated runtime
remains pinned to PostgreSQL 14 and refuses a PostgreSQL 17 drill with both
observed and pinned majors plus the official migration guide; no PG17 structural
claim is made without runtime evidence.

## Watch state

`crv watch` requires `--config`. It runs fast verification immediately, writes
the v1 JSON report, and atomically updates the configured state file. Relative
state/report paths resolve from the config directory, not the backup-set root.
While the verdict is `MET`, the same process waits `intervalSeconds` and runs
again. Any non-zero verdict exits with that verdict's code after persistence;
a worsening from prior state is also named as a regression on stderr. Invalid
state is an error, never a silent new baseline.

Set optional `watch.heartbeatUrl` to send one dead-man's-switch GET after the
report is written. Any verdict except `FAILED` targets the configured URL;
`FAILED` appends `/fail`. The outcome is stored as `lastHeartbeat: { at, ok }`
and named once on stderr, but never changes the report, verdict, or exit code.
Wire the operator's existing monitor so silence means alarm. A service without a
`/fail` endpoint will miss that ping and its silence alarm still applies.

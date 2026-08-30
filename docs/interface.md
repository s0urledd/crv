# v0.1 command and report contract

The v0.1 machine interface is JSON report schema `1.0`. Consumers must select
on `schemaVersion`, not the package version. The normative schema is
[`report-schema-v1.json`](report-schema-v1.json).

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
```

The JSON equivalent keeps `preconditions` and `structuralRestore` as sibling
objects. `MET` means only that every applicable, shipped recovery-precondition
check had sufficient evidence and passed. It never means `RECOVERABLE` and does
not prove synchronizer catch-up.

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
| 70 | Internal or drill execution error |

`--json` changes only presentation. It never changes checks, verdict, or exit
code. A `drill` structural failure is represented in `structuralRestore`; it
must exit at least 2 even if no precondition check failed. Cleanup failure is an
execution error (70), because isolation can no longer be asserted.

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

`crv init-config [path]` writes a commented, runnable `crv.yaml` and refuses to
overwrite an existing file. Pass it with `--config <path>`. A horizon has no
evidentiary value without `sequencerHorizonSource`; an LSU usability assertion
likewise requires its source. Watch state defaults to `.crv/state.json` and
reports to `crv-reports`, both outside backup artifacts.

## Drill runtime boundary

v0.1 fast inspection supports the source-reviewed Splice 0.6.0–0.6.14 D2
schema family. The containerized runtime drill is narrower: it refuses to run
without exact Splice 0.6.11 evidence and PostgreSQL 14 compatibility. The error
identifies the version as not yet drill-validated and states that fast `verify`
remains available. It uses
pinned image digests, an internal Docker network, and exact-name disposable
containers/network/volume. `PASSED` requires SQL restore, participant
`SERVING`, selected-DB identity equality, network isolation, and verified
cleanup. See the recorded [LocalNet CLI drill evidence](raw/v0.1-drill.txt).

## Watch state

`crv watch` requires `--config`. It runs fast verification immediately, writes
the v1 JSON report, and atomically updates the configured state file. Relative
state/report paths resolve from the config directory, not the backup-set root.
While the verdict is `MET`, the same process waits `intervalSeconds` and runs
again. Any non-zero verdict exits with that verdict's code after persistence;
a worsening from prior state is also named as a regression on stderr. Invalid
state is an error, never a silent new baseline.

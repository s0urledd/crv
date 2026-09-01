# crv

`crv` verifies recovery preconditions in artifacts produced by an existing Splice validator backup process.
It emits one evidence-backed verdict, an exit code, and a stable JSON report without changing backup artifacts.
`crv drill` separately proves that a selected set restores to a network-isolated participant with its identity intact.

## What operators caught

A MainNet operator first discovered that the existing backup cron captured the
validator app database but not the participant database. Fast verification
reported the incomplete recovery path before a restore was attempted. The
pre-fix report contained operator-local paths and was not published; the first
[post-fix drill record](docs/raw/v0.1-mainnet-drill-0.6.11.json) contains both
database halves.

The operator then deliberately reversed capture order. PostgreSQL accepted the
dumps, but `crv verify` found validator offset `3691235` ahead of participant
ledger end `3691183` and returned `FAILED`. The
[unedited report](docs/raw/v0.1-mainnet-verify-misordered-0.6.11.json) records
that detection.

The first production drill also exposed a false negative in crv's restored
identity lookup. The query was corrected and the next
[operator drill](docs/raw/v0.1-mainnet-drill-0.6.11.json) recorded structural
`PASSED` with identity equality and verified cleanup. Supplying current Scan
synchronizer evidence then produced
[six applicable checks at MET](docs/raw/v0.1-mainnet-drill-met-0.6.11.json).
A fresh identities export made the final structural check applicable; the
[7/7 record](docs/raw/v0.1-mainnet-drill-full-met-0.6.11.json) has seven
`PASS`, no `UNKNOWN`, and structural `PASSED`.

`MET` means every applicable shipped recovery precondition had evidence and
passed. Structural `PASSED` means the artifacts restored offline with the
expected participant identity. Neither verdict means `RECOVERABLE`, proves
synchronizer catch-up, or promises complete recovery success.

## Install

Requires Node 22. Fast inspection of custom archives also requires a compatible
`pg_restore`; xz, bzip2, and zstd files require their matching decoder.

```sh
git clone https://github.com/s0urledd/crv.git
cd crv
npm ci
npm run build
npm link
```

## Verify a set

```sh
crv verify /backups/validator/2026-08-29 --config /etc/crv/crv.yaml
```

The LocalNet-derived reversed fixture below contains participant ledger end 65
and validator offset 66. It is distinct from the passing drill captures recorded
in `docs/raw/v0.1-drill.txt`. PostgreSQL restore still succeeds, but the
intrinsic offset invariant fails:

```text
$ crv verify test/fixtures/reversed --json | jq -r '.preconditions.verdict, (.checks[] | select(.id == "backup.offset_order") | "\(.status) \(.summary)")'
FAILED
FAIL Validator offset 66 exceeds participant ledger end 65.
```

The `crv` process exits 2; the pipeline above is only a compact transcript.

Use JSON for automation:

```sh
crv verify /backups/latest --config /etc/crv/crv.yaml --json
```

Report schema: [`docs/report-schema-v1.2.json`](docs/report-schema-v1.2.json).
Exit codes: `0` MET, `1` AT_RISK, `2` FAILED, `3` INDETERMINATE,
`64` usage, `65` unsupported input/version, `70` drill environment or execution error.

## Commands

```text
crv inspect <artifact> [--json]
crv verify <backup-set|manifest> [--config <path>] [--json]
crv drill <backup-set|manifest> [--config <path>] [--json]
crv manifest <dir>
crv watch <backup-set|manifest> --config <path> [--json]
crv init-config [path]
```

`verify` is fast and starts no containers. `drill` restores into disposable
containers on an internal Docker network and removes its exact containers,
network, and volume on success, failure, and interruption. `watch` persists
reports and state at paths declared in `crv.yaml`; it exits non-zero after
persisting any non-MET verdict.

Run `crv manifest <dir>` beside artifacts to record relative paths, sizes, and
SHA-256 references. Fill declared capture/deployment provenance explicitly.
The command never derives capture time from mtime. Missing declared values make
only dependent checks `UNKNOWN`. Configure `network.scanVersionUrl` only when
you want the public Scan `/api/scan/version` reported beside the backup version;
the default remains offline and Scan failure never fails a backup check.
See [`docs/operator-guide.md`](docs/operator-guide.md) for read-only LSU evidence
commands and safe periodic identities-export guidance.

## What crv tells you before it hurts

- Your newest backup is approaching the declared horizon: `backup.latest_age`
  reports `WARN` once `backupAgeWarnFraction` is crossed. In a full-evidence
  run (a drill with synchronizer inputs supplied) the verdict becomes
  `AT_RISK` and the process exits 1; in fast `verify`/`watch` on a database
  set the drill-only identity check keeps the verdict `INDETERMINATE`
  (exit 3), so alert on `preconditions.warn > 0`, not on the exit code alone.
- Capture ordering broke: `backup.offset_order` reports `FAIL` with both values,
  for example `Validator offset 66 exceeds participant ledger end 65.`; the
  precondition verdict is `FAILED` and the process exits 2.
- Your identities export conflicts with the selected set: `crv drill` refuses
  `conflicting evidence` before Docker starts and exits 65.
- Your backup cron died: repeated `watch` reports show `backup.latest_age`
  increasing; crossing the warning fraction raises `WARN` in the report (exit
  semantics above); reaching the declared horizon reports `FAIL` and exits 2.
- An LSU invalidated the retained set: `network.lsu_path` reports `FAIL` when an
  operator-declared, unvalidated assertion says the captured synchronizer is
  unavailable, and exits 2. Without that usability source it is `UNKNOWN` and
  exits 3.


Timing scope matters: 23.7 seconds measured only a warm `crv drill` after
artifact capture with images cached. The 6m12s GitHub CI job included checkout,
dependencies, LocalNet clone/pull/boot, artifact capture, drill, and cleanup.
They are not comparable benchmarks.

## Checks

| Check | Class | What it proves |
| --- | --- | --- |
| `backup.required_path` | Proven invariant | A participant/validator DB pair or identities fallback is present; unclassified DB artifacts make this `UNKNOWN`, not `FAIL`. |
| `artifact.reference_digest` | Proven invariant | Current bytes and sizes equal capture-time manifest references. |
| `backup.offset_order` | Proven invariant | Validator last-ingested offset does not exceed participant ledger end. |
| `deployment.selected_identity` | Proven invariant | After an offline drill, the selected DB contains the expected participant identity. |
| `backup.latest_age` | Recovery prerequisite | Capture age is below an explicitly sourced sequencer horizon. An optional configured fraction warns before expiry; no threshold is assumed. |
| `network.lsu_path` | Recovery prerequisite | A pre-LSU set has sourced evidence for a usable old physical synchronizer path. |
| `identities.structure` | Structural validation | The export has required JSON fields, canonical participant ID, strict base64, and required key names. Key bytes are never reported. |
| Offline restore | Structural validation | SQL restores, the participant image healthcheck passes, identity matches, the network is internal, and cleanup is verified absent. |

A structural PASS never upgrades the precondition verdict by itself. Human output
prints artifact limitations and remediation for every applicable `UNKNOWN` or
`FAIL`; each `UNKNOWN` names the exact evidence needed to resolve it.

## Inputs and versions

Accept per-database plain/custom logical dumps, plain `pg_dumpall`, identities
JSON, nested/date-based directories, and gzip/xz/bzip2/zstd wrappers. Format and
compression detection use artifact bytes, not filenames. Multi-database
`pg_dumpall` requires declared participant and validator DB names when selection
would otherwise be ambiguous.

Fast D2 inspection binds to exact schema shapes recorded in `compatibility.json`;
a release number never selects an adapter. The disposable drill requires one exact
artifact version. LocalNet drill evidence currently records 0.6.9, 0.6.11,
0.6.14, and 0.7.5. Recorded versions use a tested pinned digest; unrecorded versions
resolve and run an immutable image digest and report
`PASSED_UNVERIFIED_VERSION` after the same assertions pass. See
[`docs/version-policy.md`](docs/version-policy.md) and
[`docs/version-matrix.md`](docs/version-matrix.md).

Fast `verify` accepts PostgreSQL 17 logical dumps. The isolated drill remains
pinned to PostgreSQL 14 and rejects PG17 with the official migration-guide URL
until repeatable PG17 participant-runtime evidence exists.

## Non-goals

- Does not take backups. Keep the existing cron job, PV snapshot, or cloud backup.
- Does not perform production restores or failover.
- Does not orchestrate party replication or participant migration. That is
  [canton-cro](https://github.com/canton-cro/canton-cro)'s scope; a `crv`
  report is intended to be consumed by it.
- Does not provide deployment hardening, configuration management, a monitoring
  or alerting platform, or a dashboard. Use the operator's scheduler and alerting.

## Limits

A checksum can match and the backup can still fail to restore. In the LocalNet
truncation test, a manifest created from the already-truncated bytes matched
exactly, then PostgreSQL rejected the `COPY`. A digest detects change after a
trusted reference; `drill` tests structural restoration.

Offline restore proves structural usability and identity continuity only. It
cannot prove synchronizer catch-up, ACS agreement with peers, old-synchronizer
availability, recovery of multi-hosted/external parties, or complete
validator-app/participant semantic consistency beyond the offset invariant.
Do not translate `MET` or structural `PASSED` into `RECOVERABLE`.

Read the evidence in [`docs/discovery.md`](docs/discovery.md) and reproduce the
CLI drill with [`experiments/08-cli-drill.sh`](experiments/08-cli-drill.sh).

## Reproduce the claims

From a fresh clone, run:

```sh
./experiments/00-reviewer-repro.sh
```

It installs dependencies, builds, runs the tests and CLI contracts, prints the
good and reversed fixture verdicts, checks generated release notes, and runs one
LocalNet isolated drill when a Docker daemon is available. Without Docker, the
summary marks only that drill `SKIPPED`.

## Maintenance

crv is maintained by the operators of a Canton Network MainNet validator.
Engineering is AI-assisted; every change is human-reviewed, and behavior
claims are validated on production infrastructure before release. Files under
`docs/raw/` are unedited records of real runs.

License: MIT.

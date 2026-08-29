# crv

`crv` will verify recovery preconditions for backup artifacts from a Splice
validator operator's existing backup process. It will emit one evidence-backed
verdict, an exit code, and a JSON report. It is in discovery; there is no v0.1
binary yet.

Read [the discovery report](docs/discovery.md). Reproduce its LocalNet evidence
with the commands in [experiments](experiments/README.md). Phase 2 is gated on
review of that evidence.

## Manifest requirement

Plain `pg_dump` output does not contain the source database name or a capture
timestamp. Even a custom archive's creation time does not prove that the
validator dump completed before the participant dump began. A `crv` manifest
is therefore the provenance layer, not an optional index: it records capture
start and completion times, the selected database, deployment version, and
synchronizer identity beside artifacts created by the operator's existing
backup job. It never changes those artifacts. A missing declared value must
produce `UNKNOWN`; it must never silently pass.

## Non-goals

- Does not take backups. Keep the existing cron job, PV snapshot, or cloud backup.
- Does not perform production restores or failover.
- Does not orchestrate party replication or participant migration. That is
  [canton-cro](https://github.com/canton-cro/canton-cro)'s scope; a `crv`
  report is intended to be consumable by it.
- Does not provide deployment hardening, configuration management, a monitoring
  or alerting platform, or a dashboard. It provides a verdict, an exit code,
  and a JSON report; use the operator's existing scheduler and alerting.

## Limits established in discovery

An offline restore can prove that PostgreSQL accepted the data and a
network-isolated participant reached `SERVING` with the backed-up identity. It
cannot prove that the participant will catch up to the live synchronizer or
that validator-app and participant state are semantically consistent. The
final v0.1 vocabulary must therefore describe recovery preconditions, not claim
that a backup is `RECOVERABLE`.

License: MIT.

# crv

`crv` will verify recovery preconditions for backup artifacts from a Splice
validator operator's existing backup process. It will emit one evidence-backed
verdict, an exit code, and a JSON report. It is in discovery; there is no v0.1
binary yet.

Read [the discovery report](docs/discovery.md). Reproduce its LocalNet evidence
with the commands in [experiments](experiments/README.md). Phase 2 is gated on
review of that evidence.

## Evidence and manifests

`crv` first uses evidence intrinsic to artifacts. A validator offset ahead of
the participant ledger end proves that the pair is internally inconsistent;
detecting that violation does not require a manifest or a backup process
created by `crv`.

A manifest supplies provenance that artifacts do not contain reliably: capture
start and completion times, selected database, deployment version, and
synchronizer identity. It sits beside artifacts created by the operator's
existing backup job and never changes them. A missing declared value makes only
the dependent check `UNKNOWN`; it must never silently pass.

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

# crv

Phase 1 collects evidence about what can be established from Canton validator
backup artifacts. There is no binary yet.

Verdict vocabulary: TBD after Phase 1 evidence review.

## Non-goals

- Does not take backups. Keep the existing cron job, PV snapshot, or cloud backup.
- Does not perform production restores or failover.
- Does not orchestrate party replication or participant migration. That is
  [canton-cro](https://github.com/canton-cro/canton-cro)'s scope; any eventual
  `crv` report is intended to answer the question before recovery orchestration.
- Does not provide deployment hardening, configuration management, a monitoring
  or alerting platform, or a dashboard. The intended surface is a verdict, an
  exit code, and a JSON report; use the operator's existing scheduler and alerting.

License: MIT.

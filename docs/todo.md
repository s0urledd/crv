# Deferred work

- Add a historical-continuity report axis before checking backup spacing; it
  must remain separate from immediate latest-set recovery.
- Add a backup-frequency heuristic only with an explicit operator policy and
  enough declared capture history to measure it.
- Select the newest valid set from a directory only after verifying each
  candidate; v0.1 requires the operator to select one set.
- Test snapshot-provider metadata and isolated restore mechanics against a real
  Kubernetes cluster; Phase 1 maps Helm parity from charts only.
- Validate the isolated drill end to end on Splice 0.6.9 before the TestNet
  operator pilot; enable it only after exact runtime evidence passes.
- Add compatibility fixtures for newer Splice/Canton versions after v0.1.
- Investigate a cryptographically authenticated capture manifest. A checksum in
  a manifest stored beside the artifact detects accidental damage but not an
  attacker able to rewrite both.

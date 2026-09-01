# Reproduce the discovery evidence

These scripts operate only on disposable Docker resources. They never connect
to a public Canton synchronizer. They clone the pinned
`digital-asset/cn-quickstart` commit and use Splice 0.6.11 images.

Requirements: Linux, Git, `curl`, `jq`, OpenSSL, Docker 27 or newer, Docker
Compose 2.27 or newer, 8 GiB RAM, and about 6 GiB free disk. Set
`CRV_BENCH_ROOT` to move the generated workbench; the default is
`.crv-bench/`.

Run one experiment:

```sh
./docs/archive/experiments/01-backup-shape.sh
./docs/archive/experiments/02-ordering.sh
./docs/archive/experiments/03-isolated-restore.sh
./docs/archive/experiments/04-db-selection.sh
./docs/archive/experiments/05-identities-structure.sh
./docs/archive/experiments/06-duplicate-identity.sh
./docs/archive/experiments/07-version-matrix.sh
./scripts/drill-bench.sh
```

Reproduce one failure catalogue entry:

```sh
./docs/archive/experiments/failures/reversed-order.sh
./docs/archive/experiments/failures/wrong-migration-db.sh
./docs/archive/experiments/failures/corrupt-dump.sh
./docs/archive/experiments/failures/missing-identities.sh
./docs/archive/experiments/failures/stale-backup-simulated.sh
```

Stop the bench and delete only its generated containers and volume:

```sh
./scripts/stop.sh
```

The stale-backup case is explicitly simulated. A single-host LocalNet cannot
prove a network sequencer's pruning horizon.

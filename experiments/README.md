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
./experiments/01-backup-shape.sh
./experiments/02-ordering.sh
./experiments/03-isolated-restore.sh
./experiments/04-db-selection.sh
./experiments/05-identities-structure.sh
./experiments/06-duplicate-identity.sh
```

Reproduce one failure catalogue entry:

```sh
./experiments/failures/reversed-order.sh
./experiments/failures/wrong-migration-db.sh
./experiments/failures/corrupt-dump.sh
./experiments/failures/missing-identities.sh
./experiments/failures/stale-backup-simulated.sh
```

Stop the bench and delete only its generated containers and volume:

```sh
./experiments/stop.sh
```

The stale-backup case is explicitly simulated. A single-host LocalNet cannot
prove a network sequencer's pruning horizon.

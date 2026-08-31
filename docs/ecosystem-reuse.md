# Ecosystem reuse inventory: what crv can borrow

Date: 2026-08-31. Survey of the Canton/Splice tooling ecosystem for code,
patterns and documents that reduce crv's own work. Labels: **Verified** =
file read at a pinned tag or live fetch this session; **Reported** = vendor
docs; **To inspect** = located but not yet read.

## 1. One dated alarm first: PostgreSQL 17 is coming to the fleet

**Verified.** `scripts/test-postgres-migration.py` at Splice tag 0.7.5 is an
end-to-end test of the **official** validator PostgreSQL major-version
migration (`SRC_PG=14`, `TGT_PG=17` defaults), and the guide it tests
([validator-postgres-migration](https://docs.canton.network/global-synchronizer/production-operations/validator-postgres-migration))
is explicitly for production, "validator and SV nodes alike", with a hard
date: the deprecated `splice-postgres` Helm chart "reaches end-of-life on
**2026-11-12**". The documented procedure is dump-and-restore **using the
target version's client tools**.

Consequence for crv: operators will start presenting dumps whose headers say
PostgreSQL 17 (source *and* dumper) while `compatibility.json` pins
`postgresMajor: 14` and the drill refuses anything else with exit 65. Fast
`verify` is unaffected (headers are parsed, not gated). This deserves a slot
in Block B/C planning: either a second pinned postgres runtime keyed by the
artifact's major, or at minimum an error message that names the migration
guide. The upstream test script doubles as the recipe for producing PG-17
LocalNet fixtures.

Bonus for the proposal: upstream itself validates that migration by
dump → restore → **assert balances preserved → submit a new transfer**. That
is official prior art for "a restore test is the proof", quotable, and its
assertion pattern (post-restore transaction succeeds) is stronger than crv's
current drill assertions — worth borrowing for LocalNet evidence.

## 2. Directly reusable for crv

| Asset | Where | Use |
| --- | --- | --- |
| Restore-test harness | `scripts/test-postgres-migration.py`, `scripts/test-postgres-migration-k8s.py` (**Verified** header; k8s variant **to inspect**) | LocalNet drill patterns: per-DB dump loop, target-client rule, balance/transfer assertions; the k8s variant is the closest thing to a recipe for our hosted-path work |
| OpenAPI specs as contract source | `apps/*/src/main/openapi/*.yaml` (**Verified**, inventoried in `ops-tooling-design.md`) | Generate TS clients for Scan (`active-synchronizer-serial`, `lsu`, `traffic-status`) instead of hand-rolling HTTP, as `versions.ts` does today for `/api/scan/version` |
| Machine-readable upgrade calendar | `https://sv-cal.canton.foundation/schedule.json` (**Verified**, live) | Already in `ops-tooling-design.md`; also useful to crv itself for a "backup predates the current network version window" style hint |
| Pinned digest sources | tags on `canton-network/splice`; base images at `canton-network/canton-base-images` (**Reported**, 0.6.6 release note) | Feeds the compatibility-watch widening work |
| LocalNet under the vendor's repo | `cluster/compose/localnet/` (**Verified** path; used by the migration test) | A second bench besides cn-quickstart, maintained by upstream itself |

## 3. Reusable for the watchtower lane (RFP 27)

| Asset | Where | What it teaches |
| --- | --- | --- |
| Official watchdog sidecar | `cluster/images/cometbft-watchdog/restart-watchdog.py` (**Verified**) | The accepted upstream pattern: a dependency-free stdlib Python sidecar that scrapes **Prometheus metrics** and acts on stalls. Metric names in the file: `daml_sequencer_block_events_total`, `daml_mediator_requests_total` — i.e. Canton nodes natively expose `daml_*` Prometheus metrics, so the watchtower should scrape metrics, not only REST. It even emits JSON logs field-compatible with Canton logging |
| Health probing pattern | `cluster/images/multi-validator/health-check.sh` (**Verified**) | `readyz` probing over wget (curl is troublesome on ARM images — their comment), port scheme `base+3` for validator admin, loop over N nodes |
| Scan txlog walker | `scripts/scan-txlog/scan_txlog.py` (**To inspect**) | Official reference for walking Scan's update stream — the "is the network advancing" half of the stall detector |

Open item carried over: where the metrics endpoint is exposed in the
validator compose bundle was **not** found in the sparse checkout — verify
before building (helm observability values are the likely place).

## 4. Bench scale for the §5 timing story

`cluster/images/load-tester` and `cluster/images/multi-validator`
(**Verified** paths, contents to inspect) exist precisely to generate load
and to run many validators cheaply. Combined with the migration test's
seeding steps (tap + cross-participant transfer), they are the upstream way
to grow a LocalNet participant database well beyond the current 28–45 MB
fixtures — which is what the drill's new phase timings need before anyone
extrapolates to production sizes.

## 5. canton-cro, as it actually is

**Verified** (shallow clone of `canton-cro/canton-cro`, default branch
today): layout `cli/`, `docs/`, `localnet/`, `notes/` — and **no reference to
crv anywhere in its sources or docs**. crv's README says a crv report "is
intended to be consumed by" canton-cro; that intent currently lives only on
our side. Practical reading: the integration contract is ours to propose,
which makes report-schema stability (the 1.2 discipline in Block A.1) the
prerequisite for that conversation, and the conversation itself a natural
design-partner opening.

## 6. Distilled actions (inputs to Block B/C planning, no code here)

1. **PG-17 readiness** — decide the drill's answer to post-migration dumps
   before 2026-11-12 makes them common; reuse the upstream script to mint
   PG-17 fixtures.
2. **Adopt the metrics surface** — watchtower designs on `daml_*` Prometheus
   metrics plus the REST endpoints already inventoried; locate the metrics
   port in the validator bundle first.
3. **Borrow the assertion, cite the precedent** — post-restore
   balance/transfer assertions from the migration test into LocalNet drill
   evidence, and quote upstream's own dump→restore→assert practice in the
   proposal.
4. **Generate, don't hand-roll** — OpenAPI codegen for any new Scan/validator
   endpoints crv touches.

## Sources

- `canton-network/splice` at tag 0.7.5: `scripts/test-postgres-migration.py`,
  `scripts/scan-txlog/`, `cluster/images/cometbft-watchdog/restart-watchdog.py`,
  `cluster/images/multi-validator/health-check.sh`, `cluster/images/load-tester/`,
  `cluster/compose/localnet/`, `apps/*/src/main/openapi/`
- [Validator PostgreSQL migration guide](https://docs.canton.network/global-synchronizer/production-operations/validator-postgres-migration)
- [SV operations schedule JSON](https://sv-cal.canton.foundation/schedule.json)
- `canton-cro/canton-cro` (shallow clone, 2026-08-31)
- Companion notes in this repo: `ops-tooling-design.md`, `canton-research.md`,
  `adoption-path.md`

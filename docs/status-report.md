# crv status report

Subject: `s0urledd/crv` at commit `3a573b7` (`main`), package version `0.1.0-beta.0`.
Date: 2026-08-30. Prepared for external review.

Method: the repository was read as it stands and the shipped CLI was executed
against its own fixtures and against constructed inputs. `npm test` was run
(37 tests, 36 pass, 1 skipped — the zstd case, because `zstd` is absent from
this machine). No Docker daemon is available here, so no drill was re-run; all
drill numbers below are the repository's own recorded evidence, and CI timings
were read from the GitHub Actions API. Nothing in the repository was changed
except the addition of this file.

Where a statement below is a behaviour observed in this session it is marked
**observed**; where it is a repository record it is cited by path.

## Addendum — 2026-08-31, after PR #7 ("Block A")

This report is a dated snapshot of `3a573b7` and is left unedited below.
[PR #7](https://github.com/s0urledd/crv/pull/7) (merged as `329ffdf`) resolved
several of its findings; each was re-verified by running the new `main`:

**Resolved by PR #7:** the unrecognised-*table* case now degrades to `UNKNOWN`
with the table and known families named (§4, previously `FAILED`);
`artifacts[].limitations` are printed in human output (§3.1 item 2, §6 rows
2–3); `backup.required_path` gained an `UNKNOWN` middle state, so unclassified
database artifacts no longer read as "no recovery path" (§6 rows 1–3);
`participantServing` was renamed `participantContainerHealthy` and the README
row corrected (§3.2 item 8); cleanup verification is now tri-state and no
longer reports success when Docker is unreachable (§3.2 item 9); a drill
environment failure now reports `ENVIRONMENT_ERROR` with exit 70 instead of
masquerading as a backup failure (§6 row 10); remediation lines are printed
for `FAIL` and `UNKNOWN` checks.

**Still open as of `329ffdf`:** the compatibility watch's `0.6.*` tag filter
(§4); exit 70 for user-input errors (§2.2, §6 rows 4 and 9); the README
transcript, which now diverges further from real output (§3.1); the misplaced
"identities-only recovery path" wording on non-identities sets;
`deployment.selected_identity` still has no test and `backup.required_path`
only its new `UNKNOWN` branch (§3.1 item 5); the failure fixtures still do not
invoke `crv` and none run in CI (§3.1 item 6); the zstd decoder blast radius,
declared-database-name narrowing, unused `severity`, and `AT_RISK`
reachability (§3.2, §6).

**Contract note:** §2.4–2.5 below describe the report schema `1.1` as
published at `3a573b7`. PR #7 subsequently modified that schema file in place
(field renames and required additions) while `schemaVersion` remained `"1.1"`,
so the `1.1` this report analyses and the `1.1` on current `main` are
different contracts. This is recorded in the post-merge review of PR #7 and is
not reflected in the body below.

---

## 1. Inventory

### 1.1 Commands

| Command | Accepts | What it does | What it writes |
| --- | --- | --- | --- |
| `crv inspect <artifact> [--json]` | exactly one **file** | Single-artifact inspection: format, compression, roles, size, source DB, PostgreSQL versions, offsets, limitations. Rejects `--config`. | nothing |
| `crv verify <set\|manifest> [--config <p>] [--json]` | one file or directory | Runs all seven checks. No containers. Digests computed only in manifest mode. | nothing |
| `crv drill <set\|manifest> [--config <p>] [--json]` | one file or directory | Same seven checks, then a disposable PostgreSQL + participant restore on an internal Docker network; re-runs `deployment.selected_identity` with the restored identity. | Docker container/network/volume, removed before exit |
| `crv manifest <dir>` | a **directory** only | Writes `crv-manifest.json` atomically; preserves any previously declared provenance; refuses options. | `crv-manifest.json` inside the backup directory |
| `crv watch <set\|manifest> --config <p> [--json]` | one file or directory; `--config` mandatory | Loops fast verification at `watch.intervalSeconds`, persisting a report per cycle and a state file; returns on the first non-`MET` verdict. | report JSON + state JSON at config-relative paths |
| `crv init-config [path]` | optional path | Writes the commented `crv.yaml` template; refuses to overwrite. | `crv.yaml` |
| `crv --version` / `--help` / `help` / no args | — | Version or usage. | nothing |

`watch` runs its loop inside one process (`watch.ts:107`); there is no daemon,
no scheduler integration, and no external notification.

### 1.2 Checks

All seven run in both `verify` and `drill`. All carry `severity: "error"`;
severity is emitted in the report and is **not read by anything** —
`aggregate()` (`report/aggregate.ts:10-16`) ignores it entirely.

| id | Class | Asserts | Evidence required | With evidence absent |
| --- | --- | --- | --- | --- |
| `backup.required_path` | proven invariant | roles include (participant AND validator) OR identities | artifact roles only | `FAIL` (never `UNKNOWN`) |
| `identities.structure` | structural validation | identities JSON parses; `id` starts `PAR::`; non-empty `version`; strict-base64 `authorizedStoreSnapshot`; keys named namespace/signing/encryption each strict base64 | an identities artifact | `applicable:false`, `UNKNOWN` when no identities export present. Invalid export → `WARN` if a DB pair exists, else `FAIL` |
| `artifact.reference_digest` | proven invariant | each manifest-referenced artifact's current size and SHA-256 equal the manifest values | a capture manifest | `UNKNOWN` + required-evidence line; `applicable:false` when no artifacts at all |
| `backup.offset_order` | proven invariant | max validator `last_ingested_offset` in the highest `migration_id` present ≤ participant `lapi_parameters.ledger_end` | exactly one participant candidate and one validator candidate, each from a recognised schema shape | `UNKNOWN` (with a second required-evidence line naming DB selection when a cluster dump is present); `applicable:false` when no DB/cluster role exists |
| `backup.latest_age` | recovery prerequisite | `now - manifest.declared.captureCompletedAt < config.network.sequencerHorizonSeconds` | declared capture completion **and** horizon **and** horizon source | `UNKNOWN`; `FAIL` if completion unparseable, horizon ≤ 0, or capture > 5 min in the future |
| `deployment.selected_identity` | proven invariant | the restored selected DB carries the expected participant ID | drill result + a DB name + a single expected participant ID | `UNKNOWN` in `verify` **always**; `FAIL` if the expected-ID sources disagree |
| `network.lsu_path` | recovery prerequisite | captured vs current physical synchronizer id/serial; if crossed, sourced usability | manifest-declared captured id+serial, config current id+serial, and on a cross a usability boolean + source | `UNKNOWN` |

### 1.3 Adapters

| Layer | What exists | Selection basis |
| --- | --- | --- |
| Compression | gzip (in-process `zlib`), zstd / xz / bzip2 (external `zstd`, `xz`, `bzip2` binaries) | magic bytes only, never filename (`artifact.ts:213-219`) |
| Format | `plain_dump`, `cluster_dump` (`pg_dumpall`), `custom_dump` (via `pg_restore -l` and `-a -t <table> -f -`), `identities_json` (< 16 MiB, must contain `id`/`keys`/`version`/`authorizedStoreSnapshot`) | leading bytes: `PGDMP`, `{`, or the `PostgreSQL database (cluster) dump` header |
| Offset schema | one family, `splice-d2-offset-v1`, two shapes | SHA-256 of `table` + `\|` + comma-joined ordered columns |
| Drill runtime | `postgres@sha256:156f0b…` pinned; participant repository `ghcr.io/…/canton-participant` with recorded digests for 0.6.9, 0.6.11, 0.6.14 | exact Splice version string |

`ArtifactCompression` includes `"unknown"` in the type and in both published
schemas, but `compressionFromMagic` can only return `gzip`/`zstd`/`xz`/`bzip2`/
`none`, so the `unknown` branch in `inspectArtifact` (`artifact.ts:477`) is
unreachable. `EvidenceClass` values `heuristic` and `unverifiable`, and
`CheckSeverity` values `warning` and `info`, are likewise never emitted.

### 1.4 Reconciliation with the Phase 1 "Ship" list

Source: `docs/discovery.md` "Final check classification".

| Phase 1 candidate | Marked | Shipped? |
| --- | --- | --- |
| Required artifact path exists | Ship | Yes — `backup.required_path` |
| Reference digest/size matches | Ship when manifest has reference | Yes — `artifact.reference_digest` |
| Selected participant DB identity | Ship | Yes — `deployment.selected_identity` (resolvable only under `drill`) |
| Validator offset ≤ participant ledger end | Ship | Yes — `backup.offset_order` |
| Latest participant age below sourced horizon | Ship | Yes — `backup.latest_age` |
| Historical backup spacing below participant retention | Ship **only** for a declared historical-continuity claim | **No.** Deferred in `docs/todo.md` |
| Backup crossed LSU / old synchronizer available | Ship | Yes — `network.lsu_path` |
| Dump parses and SQL restore completes | Ship | Partly — parsing is in `inspect`; SQL restore exists only as `structuralRestore.sqlRestored` under `drill`. There is no check id for it and it has no verdict effect of its own |
| Restored participant reaches `SERVING` with expected identity | Ship behind isolated mode | Yes — `structuralRestore` (see §3.2 on what "serving" actually measures) |
| Identities JSON structurally valid | Ship | Yes — `identities.structure` |
| Backup frequency heuristic | Ship **only** if operator declares policy | **No.** Deferred in `docs/todo.md` |
| Generic semantic consistency beyond the offset invariant | Do not ship | Not shipped |
| Splice compatibility inferred from dump schema | Do not ship | Not shipped |
| Identities party-hint equality | Do not ship as pass/fail | Not shipped |
| "Never-used" participant ID | Do not ship | Not shipped |
| Automatic multi-hosted/external party recovery | Do not ship | Not shipped |

**Nothing is shipped as a check that Phase 1 marked "Do not ship."** Two
conditional-Ship rows are absent, both listed in `docs/todo.md`.

Shipped but never classified by Phase 1, because Phase 1 classified checks and
not surfaces: `crv watch`, `crv manifest`, `crv init-config`, the Scan
`/api/scan/version` observation, the `compatibility.json` adapter registry, and
the `PASSED_UNVERIFIED_VERSION` structural status. Phase 1 closed with "No
TypeScript package, CLI, scheduler, JSON schema … has been written", so a
scheduler and schema were anticipated; the version-evidence machinery was not.

---

## 2. Contract

### 2.1 JSON report as actually emitted

Top-level keys, in emission order: `schemaVersion` (`"1.1"`), `tool`,
`generatedAt`, `subject`, `preconditions`, `versions`, `structuralRestore`,
`artifacts`, `checks`. This matches `docs/report-schema-v1.1.json` exactly;
a generated report and both recorded drill reports validate against it
(`test/contract.test.ts:85`), and that was re-confirmed **observed** in this
session.

`preconditions.{pass,fail,warn,unknown}` count **applicable checks only**, so
they do not sum to `checks.length`. On `test/fixtures/good`: 7 checks,
`pass: 2`, `unknown: 4`, one non-applicable (**observed**).

### 2.2 Exit codes as actually returned

All rows below were executed (**observed**).

| Invocation | Exit | Documented meaning |
| --- | ---: | --- |
| `verify test/fixtures/good` (INDETERMINATE) | 3 | matches |
| `verify test/fixtures/reversed` (FAILED) | 2 | matches |
| `verify <identities-only set with manifest>` (MET) | 0 | matches |
| `watch test/fixtures/reversed --config …` | 2 | matches, after persisting the report |
| `drill <set>` with no Docker daemon | 2 | structural FAILED ⇒ ≥2, matches |
| `verify` with no path / two paths / `--config` with no value / unknown flag / unknown command / `watch` without `--config` | 64 | matches |
| `manifest <file>`, `init-config <existing file>`, artifact needing an absent decoder | 65 | matches |
| `verify <nonexistent path>` | **70** | documented as "internal or drill execution error"; the message is a raw `ENOENT: no such file or directory, stat '…'` |
| `inspect <directory>` | **70** | same class of mismatch; message is `not a regular file: <dir>` |

Exit code **1 (`AT_RISK`) is unreachable from `crv verify`.** `AT_RISK`
requires `warn > 0` with `fail == 0` and `unknown == 0`. Only
`identities.structure` can emit `WARN`, and only when a participant/cluster +
validator pair is also present — which makes `deployment.selected_identity`
applicable, and that check is unconditionally `UNKNOWN` outside a drill. Exit 1
is therefore reachable only from `crv drill`.

No automated test invokes `cli.ts`, `exitCode()`, `runVerify`, `runDrill` or
`runWatch`. The only exit-code assertions anywhere are `crv --version` in CI
and `status -ne 3` in `experiments/08-cli-drill.sh`.

### 2.3 Verdict aggregation as implemented

`report/aggregate.ts`: over applicable checks only,
`fail > 0 → FAILED`, else `unknown > 0 → INDETERMINATE`, else
`warn > 0 → AT_RISK`, else `MET`. Precedence matches the Phase 1 statement.
A structural drill result never enters this aggregation; `runDrill` returns
`2` when `structuralRestore.status === "FAILED"` and otherwise the verdict's
code — so a structural failure over an INDETERMINATE verdict reports 2, not 3.

### 2.4 Where code and published schema disagree

| Point | Code | Published schema |
| --- | --- | --- |
| Manifest timestamps | `readManifest` accepts anything `Date.parse` accepts — `"2026-08-29"`, `"Aug 29 2026 06:00 GMT"` (**observed**: both accepted, and `backup.latest_age` then computes an age from a bare date read as 00:00 UTC) | `manifest-schema-v1.json` requires `format: date-time` and rejects both |
| `compression: "unknown"` | never emitted | present in both report schema enums |
| `evidenceClass: heuristic \| unverifiable` | never emitted | present in both enums |
| `severity: warning \| info` | never emitted; severity is unused | present in both enums |
| Report schema 1.0 | never emitted by any code path | `docs/report-schema-v1.json` is still shipped in the npm `files` list |

Otherwise the emitted report and the 1.1 schema agree; the schema is enforced
in CI for one generated report and both recorded drill reports.

### 2.5 Schema 1.0 → 1.1

Added in 1.1: top-level `versions: { backup, network }` (new
`versionObservation` definition); `artifacts[].schemaFamilies` (required);
`structuralRestore.runtime` (required, five fields); and
`PASSED_UNVERIFIED_VERSION` added to the `structuralRestore.status` enum.
`schemaVersion` const changes `"1.0"` → `"1.1"`. Nothing was removed, no field
changed type, and no existing enum value was dropped.

**Backward compatible for a 1.0 consumer? No, if the consumer validates.**
A 1.1 report was validated against `report-schema-v1.json` in this session
(**observed**) and fails on five to seven counts, because both schemas set
`additionalProperties: false` at the root, in `artifact` and in
`structuralEvidence`:

```
/                     additionalProperties  "versions"
/schemaVersion        const                 expected "1.0"
/structuralRestore    additionalProperties  "runtime"
/structuralRestore/status  enum             "PASSED_UNVERIFIED_VERSION" not allowed  (drill reports only)
/artifacts/N          additionalProperties  "schemaFamilies"   (each artifact)
```

For a **lenient** consumer that ignores unknown fields and does not pin
`schemaVersion`, every 1.0 field is still present with the same name, type and
meaning, and reading is safe with one behavioural break: a consumer testing
`structuralRestore.status === "PASSED"` will classify a successful drill on an
unrecorded Splice version as not-passed, because that run now reports
`PASSED_UNVERIFIED_VERSION`. Both committed drill records
(`docs/raw/v0.1-drill-0.6.9.json`, `-0.6.14.json`) are exactly that case.

---

## 3. Evidence and its limits

### 3.1 README claim → backing evidence

"LocalNet" = a recorded run against a real Splice LocalNet. "Unit" = a test
against a committed fixture or stub. "Doc only" = asserted in prose with no
executable backing.

| README claim | Backing | Kind |
| --- | --- | --- |
| Does not change backup artifacts | `test/contract.test.ts:67` (bytes/mode/size/mtime), `test/manifest.test.ts:26`; `experiments/08-cli-drill.sh:43` `sha256sum -c` | Unit + LocalNet |
| Reversed pair fails before restore | `test/verify.test.ts:17`; `docs/raw/d2-ordering.txt` | Unit + LocalNet |
| Reversed pair still restores and starts green | `docs/raw/d2-ordering.txt` | LocalNet |
| Drill restores to an isolated participant with identity intact | `docs/raw/v0.1-drill.txt`; `docs/raw/v0.1-drill-0.6.9.json`, `-0.6.14.json`; CI job `LocalNet isolated drill` (6 successful runs) | LocalNet |
| Drill removes its exact resources on success, failure and interruption | `docs/raw/v0.1-drill.txt` (success, failure, SIGINT cases); `experiments/08-cli-drill.sh:44-47` leftovers assertion in CI | LocalNet. No unit test |
| Format/compression detection uses bytes, not filenames | `test/artifact.test.ts:52-64` (four codecs; zstd skipped where the binary is absent), `test/contract.test.ts:29` (gzip written to a `.bin` name) | Unit |
| Nested/date-based directories | `test/contract.test.ts:47` | Unit |
| `pg_dumpall` first class | `test/artifact.test.ts:25`, `test/verify.test.ts:25`; `docs/raw/d1-backup-shape.txt`, `docs/raw/v0.1-drill.txt` (147 MB set) | Unit + LocalNet |
| Multi-database `pg_dumpall` needs declared DB names | `test/verify.test.ts:32` | Unit |
| Custom archives via `pg_restore` | `test/artifact.test.ts:66` uses a **hand-written fake `pg_restore` shell script**; the only real-archive record is the prose in `docs/raw/v0.1-artifact-adapters.txt` | Stub + doc only |
| D2 binds to exact schema shapes, not release numbers | `test/version-handling.test.ts:29,46` | Unit |
| Unrecorded version runs an immutable digest and reports `PASSED_UNVERIFIED_VERSION` | `test/drill.test.ts:19` uses a **stubbed process runner** (no Docker); real-run records are the two committed drill JSONs | Stub + LocalNet |
| Drill evidence records 0.6.9, 0.6.11, 0.6.14 | 0.6.11 → CI run 33296579192 (verified in this session: exists, succeeded, and that commit hard-coded the exact digest now in `compatibility.json`). 0.6.9 and 0.6.14 → the two committed JSON files only, self-reported, no linked run | Mixed |
| Scan failure never fails a backup check | `test/version-handling.test.ts:77-112` | Unit |
| Manifest never derives capture time from mtime | `test/manifest.test.ts:72` | Unit |
| Truncated dump: manifest digest matched, PostgreSQL rejected the `COPY` | `docs/raw/v0.1-drill.txt`, `docs/raw/d7-failures.txt`, `experiments/failures/corrupt-dump.sh` | LocalNet |
| Watch persists reports/state and names a regression | `test/watch.test.ts` (covers `runWatchCycle` only, not `runWatch`'s loop or exit code) | Unit |
| README's `crv verify test/fixtures/reversed` transcript | **Does not match the real output.** The real command prints all seven check rows plus eight `Need for …` lines and wider columns; the README shows one row (**observed**) | — |

Two of the five D7 failure-catalogue rows are backed by scripts that never
invoke `crv`: `experiments/failures/missing-identities.sh` prints a fixed
`IDENTITIES_FILE_MISSING` string from an empty temp directory, and
`experiments/failures/stale-backup-simulated.sh` does date arithmetic in bash.
Neither exercises `backup.required_path` or `backup.latest_age`.

Per-check unit coverage: `backup.required_path` has **no test at all**;
`deployment.selected_identity` has **no test at all** (neither its `UNKNOWN`
path, its restored PASS/FAIL path, nor its sources-disagree `FAIL`);
`identities.structure` is exercised only through artifact inspection, so its
`WARN`-vs-`FAIL` branching is untested. `backup.offset_order`,
`backup.latest_age`, `network.lsu_path` and `artifact.reference_digest` have
direct tests. Experiments 01–07 and `experiments/failures/*` never run in CI;
only 08 (in `ci.yml`) and 09 (in `compatibility.yml`) are automated.

### 3.2 Places a `PASS` can be weaker than the check's stated meaning

1. **`MET` from a backup with no database in it.** A directory holding only an
   identities JSON plus a `crv manifest` generated from it yields
   `Recovery preconditions: MET`, exit 0, with the four database checks marked
   N/A (**observed**). Nothing in the human output says "there is no database
   backup here".
2. **`artifact.reference_digest` against a self-made reference.** The manifest
   is normally produced by `crv manifest` from the bytes on disk. A `PASS`
   proves equality to whatever was there when `crv manifest` last ran, not that
   the reference predates any damage. The README's Limits section says this;
   the check's `proves` string ("has not changed since the trusted reference
   digest was recorded") does not.
3. **Extra files are invisible under a manifest.** With a manifest present,
   only manifest-listed paths are inspected. An injected extra dump was neither
   reported in `artifacts` nor flagged, and the check still read
   "2 artifact(s) match capture-time size and SHA-256 references" (**observed**).
4. **`deployment.selected_identity` database match is a tautology.** In the
   drill, `selectedDatabase` comes from config/manifest and the drill restores
   into a database created from that same string, so `databaseMatches` is
   always true when non-null (`checks/selected-identity.ts:52`). Only the
   participant-ID comparison carries information. The D4 failure this invariant
   was derived from — a deployment pointing at a different, empty database —
   cannot be reproduced by the drill, because there is no independent source
   for the deployment's effective database.
5. **`backup.latest_age` "sourced" horizon is any non-empty string.**
   `sequencerHorizonSource: "x"` satisfies the sourcing requirement. Same for
   `capturedPhysicalSynchronizerUsabilitySource` in `network.lsu_path`.
6. **`network.lsu_path` compares two operator-declared values.** Phase 1 (D1)
   classed the captured physical synchronizer ID as INTRINSIC, readable from
   restored participant connection state; the implementation only reads
   `manifest.declared.physicalSynchronizerId`. Nothing is read from the
   artifact.
7. **`identities.structure` validates shape, not key material.** A one-byte
   base64 value (`"AQ=="`) passes as a key pair — that is exactly what the test
   fixture uses. There is no length, algorithm, or decodability check beyond
   strict base64.
8. **`participantServing` is a Docker healthcheck, not a `SERVING` query.**
   `DrillResources.waitHealthy` polls `.State.Health.Status == "healthy"` from
   the participant image's own HEALTHCHECK (`isolated/docker.ts:90-98`). The
   report field, the human line "Participant serving: YES", and the README's
   "participant reaches `SERVING`" all rest on that.
9. **`cleanup=verified-no-resources-remain` is emitted when Docker is
   unreachable.** `cleanup()` probes with `allowFailure = true` and treats any
   non-zero `docker inspect` as "absent". Running `crv drill` with no Docker
   daemon produced `Detail: cleanup=verified-no-resources-remain` alongside the
   connection error (**observed**).
10. **`backup.offset_order` uses the highest migration present in the
    artifact.** If the newest migration's rows are missing from the validator
    dump, the comparison silently falls back to an older migration and can
    `PASS`.
11. **Declared database names do not narrow per-database artifacts.** The
    candidate filter only skips a candidate when `offset.database !== null`
    (`checks/offset-order.ts:28`), and per-database plain dumps carry a null
    database. Two participant dumps plus declared `participantDatabase` still
    yields `UNKNOWN`, and no message says the declared name was ignored
    (**observed**).

---

## 4. Version handling as built

**Registry keying.** `compatibility.json` → `schemaFamilies[].shapes[role]`
each carry `{table, columns[], sha256}`, where `sha256` is
`SHA-256("<table>|<col1>,<col2>,…")` and is re-derived and re-checked at load
(`compatibility.ts:79`). A `COPY` header is matched in two stages: the table
name selects the role (`offsetRoleForTable`), then the exact ordered column
list must hash to a recorded shape (`recognizeOffsetShape`). A release number
never selects an adapter. Only families listing `backup.offset_order` in
`checks` are consulted.

**Contents of `compatibility.json`.** `schemaVersion: "1.0"`; one family
`splice-d2-offset-v1` (`sourceDefinitionSha256 786ee613…`, participant shape
`participant.lapi_parameters` / 6 columns, validator shape
`validator.store_last_ingested_offsets` / 3 columns); runtime block with the
untagged participant repository, a digest-pinned `postgres` image,
`postgresMajor: 14`, `participantStartupTimeoutSeconds: 240`, and three
`drillEvidence` entries (0.6.9, 0.6.11, 0.6.14 — each a repository-pinned
participant digest, `postgresMajor: 14`, `testedAt: 2026-08-30`, and an
evidence URL). Parsing is strict: unknown keys, an untagged/unpinned image, a
mismatched shape hash, a `postgresMajor` disagreeing with the runtime value, or
a `testedAt` not in `YYYY-MM-DD` all throw `UnsupportedInputError`.
`compatibility.json` is loaded at module import, so a malformed file makes
every command fail.

**Drill image resolution** (`isolated/runtime.ts:56`). One exact Splice version
is required, taken from `manifest.declared.spliceVersion` and/or the `version`
field of a structurally valid identities export; zero or conflicting values are
unsupported input, and the value must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`.
If the version is in `drillEvidence`, the recorded digest is used and
`versionEvidence: "TESTED"`. Otherwise `docker pull <repo>:<version>`, then
`docker image inspect --format {{json .RepoDigests}}`; exactly one digest for
the configured repository must be resolvable, and that digest is run with
`versionEvidence: "UNVERIFIED"`. A failed pull or an ambiguous digest aborts the
drill with exit 65. `postgresImage` and, for unrecorded versions,
`postgresMajor` come from the runtime block. Before any Docker call the drill
also requires a `postgresSourceVersion` on every database artifact and requires
it to match `postgresMajor`.

**Weekly workflow** (`.github/workflows/compatibility.yml` +
`experiments/09-compatibility-watch.sh`).

What it does: fires Mondays 04:17 UTC or on manual dispatch with an optional
tag; selects the newest `0.6.x` tag from `git ls-remote` on
`canton-network/splice`; fetches that tag's `V001__create_schema.sql` and
requires its SHA-256 to equal an existing family's `sourceDefinitionSha256`,
failing the run otherwise; runs the full LocalNet drill at that image tag;
requires `backup.offset_order == PASS`, requires structural status to be
`PASSED` for an already-recorded version or `PASSED_UNVERIFIED_VERSION` for a
new one, and requires the reported participant image to be digest-pinned; for a
new version, writes a `drillEvidence` entry into the workspace copy of
`compatibility.json` and uploads it as a 14-day build artifact.

What it does not do: it never commits, pushes, or opens a PR — the updated
`compatibility.json` exists only as an expiring artifact; it has **never run**
(the GitHub Actions API shows six workflow runs for this repository, all of them
`CI`); it tests only the single newest `0.6.x` tag, so the recorded 0.6.9 and
0.6.11 entries are never re-validated; its tag filter is hard-coded to `0.6.*`,
so a `0.7.0` release would not fail the watch — it would keep re-validating the
newest 0.6.x indefinitely; it has no path to *add* a new schema family, only to
fail on an unrecognised hash; and it does not re-derive `postgresMajor`, copying
it from the existing record.

**Can an unrecognised schema reach a result other than `UNKNOWN`? Yes — two ways.**

- A **recognised table with unrecognised columns** behaves as documented: the
  artifact keeps its role, no offset is recorded, and `backup.offset_order` is
  `UNKNOWN` (`test/version-handling.test.ts:46`).
- An **unrecognised table name** does not. `offsetRoleForTable` returns null, so
  no role is assigned at all; the artifact becomes `plain_dump` with
  `roles: ["unknown"]`, and `backup.required_path` returns **`FAIL`** — verdict
  `FAILED`, exit 2. A pair of dumps with the offset tables renamed produced
  exactly that (**observed**), with the four remaining checks reported as
  "Not applicable to an identities-only recovery path". `docs/version-policy.md`
  ("An unfamiliar shape makes only dependent checks `UNKNOWN`") and
  `docs/version-matrix.md` describe only the first case.
- Separately, a recognised-table/unrecognised-columns set can still reach
  `structuralRestore: PASSED`, because the drill does not require D2 to resolve.

---

## 5. Timing and cost on real inputs

### 5.1 What is recorded

| Scope | Number | Source |
| --- | --- | --- |
| Warm `crv drill`, per-database set (28–45 MB participant + ~165 KB validator), images cached | **23.7 s** | `docs/raw/v0.1-drill.txt` |
| `crv drill` on the truncated set, failure path | **9.8 s** | `docs/raw/v0.1-drill.txt` |
| `crv drill` on the 147 MB `pg_dumpall` set | **not recorded** | — |
| CI `LocalNet isolated drill` job, run 33296579192 (0.6.11, 120 s timeout) | **6 m 12 s** job / 5 m 47 s for the single bench+drill step | Actions API, read in this session |
| CI `LocalNet isolated drill` job, run 33317815366 (current `main`, 0.6.11, 240 s timeout) | **6 m 58 s** job / 6 m 25 s for the same step | Actions API |
| CI job wall time across all six runs (all 0.6.11, all successful) | 6 m 38 s – 7 m 31 s total run time | Actions API |
| Participant container reaching `SERVING`, 0.6.11 | **8.63 s** | `docs/raw/d5-isolated-restore.txt` |
| Participant/PostgreSQL image sizes | 597 MB / 157 MB unshared layer totals | `docs/raw/d5-isolated-restore.txt` |
| Participant/PostgreSQL memory | 859.6 MiB / 328.7 MiB | `docs/raw/d5-isolated-restore.txt` |
| Restored participant DB size | 31 MB (32,402,779 bytes) | `docs/raw/d5-isolated-restore.txt` |
| `pg_dump` capture time (not a `crv` command) | 0.42 s validator, 0.80 s participant | `docs/raw/d1-backup-shape.txt` |

**The split the review asks for does not exist.** No recorded run separates
image pull from SQL restore from participant startup. In CI, all of
cn-quickstart clone, LocalNet image pull, LocalNet boot, `pg_dump` capture,
`npm run build`, `crv manifest` and `crv drill` sit inside a single step. The
only phase-level number anywhere is the 8.63 s participant startup in D5, which
was measured by hand outside `crv`, on 0.6.11.

**Which numbers include a cold image pull:** the CI job timings do (every
GitHub runner starts empty — cn-quickstart is cloned and all LocalNet images
plus the participant and postgres images are pulled inside that one step). The
23.7 s and 9.8 s figures do not — `docs/raw/v0.1-drill.txt` states explicitly
that 23.7 s "measured only the warm `crv drill` invocation after artifacts were
captured and required images were cached". The two figures are not comparable
and the README says so.

### 5.2 The 0.6.14 startup-timeout increase

The participant startup timeout was hard-coded at **120 s**
(`isolated/drill.ts:160` as of `3060d02`) and became
`compatibility.runtime.participantStartupTimeoutSeconds: 240` in commit
`e696f33` — the same commit that introduced `compatibility.json`,
`isolated/runtime.ts`, the 0.6.9/0.6.11/0.6.14 evidence entries and report
schema 1.1. There is no separate commit, commit-message rationale, or recorded
measurement attached to the change.

Evidence bearing on the question:

- No recorded run ever hit the 120 s limit. All six CI runs succeeded, four of
  them (runs 1–4) under the 120 s timeout, and none logged a
  `did not become healthy within` failure.
- All six CI runs used the default `CRV_IMAGE_TAG=0.6.11`
  (`experiments/lib/bench.sh:9`); `ci.yml` never sets it. **CI has never drilled
  0.6.14.**
- The only startup measurement in the repository is 8.63 s, for 0.6.11.
  There is no participant-startup measurement for 0.6.9 or 0.6.14 at all.
- The two committed 0.6.14 and 0.6.9 drill reports contain no duration field.
- The end-to-end CI step grew 5 m 47 s → 6 m 25 s (+38 s) between run 1 and run
  6, but both runs are 0.6.11, and the spread of total run time across the six
  0.6.11 runs is 6 m 38 s – 7 m 31 s (±53 s) with no participant-affecting code
  change. The observed increase is inside the run-to-run noise of that step,
  which is dominated by clone and image pull.

**Conclusion available from the repository: neither.** There is no evidence
that the participant is slower to start on 0.6.14, and no evidence that the
extra time was spent elsewhere, because participant startup is not timed
anywhere for 0.6.14 and no run has ever exhausted the old budget. The change
raises a ceiling that has not been observed to bind. Its effect on
production-sized dumps is not measurable from what is recorded, because the
timeout applies only to container health after the restore has already
completed, and restore time itself is untimed.

### 5.3 Fast-path cost (measured in this session)

`crv verify` streams and line-parses every byte of every recognised artifact;
it is linear in artifact size, not constant. On a 269 MB synthetic plain dump
plus a 1 MB validator dump on this machine (**observed**): `verify` without a
manifest 1.9 s, `crv manifest` 2.4 s, `verify` with a manifest 2.3 s (parse plus
SHA-256), `inspect` of the same file 1.9 s, `inspect` of its 810 KB gzip 3.9 s
(full decode to a temp file). Roughly 140 MB/s. The largest artifact the
repository has ever run against is the 147 MB `pg_dumpall`; production
participant dumps are not represented in any recorded run.

---

## 6. What breaks first

Ranked by likelihood on first contact with a real operator's backup directory.

| # | Failure | What the operator sees | Does the message tell them what to do? |
| ---: | --- | --- | --- |
| 1 | Points `crv verify` at one dump, or at a directory holding only a participant dump | `Recovery preconditions: FAILED`, exit 2, `backup.required_path` FAIL: "Neither a participant/validator database pair nor an identities fallback was found." | **No.** It reads as "your backup is broken", not "you gave me half a set". `remediation` exists in the JSON but is never printed in human output |
| 2 | Custom-format archives and no compatible `pg_restore` on `PATH` | Same FAIL as row 1. The real cause is only in `artifacts[].limitations` ("A compatible `pg_restore` is required…") which the human report **never prints** (**observed**) | **No.** JSON consumers get it; terminal users do not |
| 3 | Unexpected layout — extra files, sibling sets, non-artifact files in the directory | Unrecognised files are dropped silently before any check; no inventory of what was skipped. With a manifest present, unlisted files are invisible entirely (**observed**) | **No.** Nothing distinguishes "empty directory" from "twelve files, none recognised" |
| 4 | Any artifact or subdirectory the process cannot read | The whole run aborts: `crv: EACCES: permission denied, open '<path>'`, exit **70**. No partial report (**observed** as an unprivileged user) | Partly — the path is named; the exit code says "internal error" |
| 5 | One `.zst`/`.xz`/`.bz2` artifact with the decoder missing | The whole run aborts: `crv: zstd is required to inspect this artifact: spawn zstd ENOENT`, exit 65 (**observed**). Other artifacts in the same directory are never reported | Yes for the cause; no for the blast radius — one file kills the report |
| 6 | Two participant dumps in one directory (retention copies, `.bak`, two migrations) | `backup.offset_order` `UNKNOWN`; required evidence asks for "one participant artifact … and one validator artifact". Declaring `participantDatabase` does **not** help for per-database dumps (**observed**) | Partly — it says what is needed but not that the declared name was ignored |
| 7 | Multi-database `pg_dumpall` with more than one participant section | `backup.offset_order` `UNKNOWN` with a second line: "For a multi-database `pg_dumpall`, supply the captured participant and validator database names in the manifest." (**observed**) | **Yes** — the clearest message in the tool |
| 8 | Production-sized artifacts | `verify` reads every byte (~140 MB/s here); compressed artifacts are decoded to a **full temporary copy** in `os.tmpdir()` with no size guard (`artifact.ts:479`), so a compressed dump needs free temp space equal to its decompressed size. The drill's PostgreSQL volume needs the restored database size. Neither is pre-checked; an out-of-space failure surfaces as a raw errno at exit 70 | **No** |
| 9 | Mis-typed or missing input path | `crv: ENOENT: no such file or directory, stat '…'`, exit 70 (**observed**) | Partly — path named, wrong exit class |
| 10 | Drill attempted with no Docker daemon, or without permission on the socket | `Offline structural restore: FAILED`, `Network isolated: NO`, exit 2, with the daemon error inside a `Detail:` line and a misleading `cleanup=verified-no-resources-remain` (**observed**). Indistinguishable in the status field from a genuinely unrestorable backup | Partly — the cause is in a detail line; the headline status blames the backup |
| 11 | Drill with database names absent | `crv drill requires participant database name in config or manifest`, exit 65 | **Yes** |
| 12 | Drill where the artifact's Splice version is unknown or the identities export and manifest disagree | `crv drill requires one exact Splice version …`, exit 65 | **Yes** |
| 13 | Backup taken on PostgreSQL 15/16 | `isolated runtime drill supports PostgreSQL 14 artifacts; received 16.x`, exit 65. Fast `verify` still runs | **Yes** |
| 14 | Timestamps declared as bare dates in a hand-edited manifest | Accepted silently and read as 00:00 UTC; the published manifest schema would have rejected them (**observed**) | **No** — silent |
| 15 | A future Splice that renames the offset tables | `FAILED`, exit 2 (see §4), not `UNKNOWN` | **No** — the message is the "no valid recovery path" text |
| 16 | Second Ctrl-C during a drill | The signal handlers are `process.once`, so the first interrupt starts cleanup and the second terminates the process — cleanup may not complete and resources can remain | **No** |

---

## 7. Honest gaps

### 7.1 Listed in `docs/todo.md`

- Historical-continuity report axis (prerequisite for any backup-spacing check).
- Backup-frequency heuristic (needs a declared operator policy).
- Selecting the newest valid set from a directory; v0.1 requires the operator
  to name one set.
- Snapshot-provider metadata and isolated restore against a real Kubernetes
  cluster. D8 Helm parity is a chart-reading exercise only; no cluster was used.
- Compatibility fixtures for newer Splice/Canton versions.
- A cryptographically authenticated capture manifest.

### 7.2 Not in `docs/todo.md`

**Untested code paths.** `backup.required_path` and
`deployment.selected_identity` have no tests. `identities.structure`'s
`WARN`/`FAIL` branching, `artifact.reference_digest`'s empty-manifest FAIL,
`backup.latest_age`'s future-capture and invalid-horizon FAILs, `cli.ts`
argument parsing, `crv inspect`, `crv init-config`, `runWatch`'s loop and exit
path, and every CLI exit code except `--version` and the drill's 3 are
uncovered. `exitCode()` is never asserted.

**Evidence that is self-attested.** The 0.6.9 and 0.6.14 drill records are two
JSON files committed to the repository. There is no CI run, no log, and no
third-party record behind them; CI has only ever drilled 0.6.11. The 0.6.11
evidence URL does resolve to a real, successful run using exactly the recorded
digest.

**Evidence that expires.** `compatibility.json`'s 0.6.11 entry points at a
GitHub Actions run whose logs are retained by default for 90 days. The weekly
watch's output is a build artifact with 14-day retention.

**The weekly watch has never run**, cannot write its result anywhere durable,
only ever tests the newest `0.6.x`, and is hard-coded to the `0.6` series.

**Only one schema family exists.** `splice-d2-offset-v1` covers exactly one
check. Every other check is driven by declared config/manifest values, so
"version handling" currently applies to one comparison and to drill image
selection.

**Bench-only, never seen on production shapes.** Every artifact ever processed
came from `cn-quickstart` LocalNet at commit `3c8ca2f`. The operator
confirmation of production database names and owners, requested at the end of
`docs/discovery.md`, is still outstanding — `docs/discovery.md` marks it
"unknown, needs testing". PV/CSI snapshots, managed-database backups, Helm
deployments, encrypted or object-store backups, and any artifact not produced
by `pg_dump`/`pg_dumpall`/the identities endpoint are unhandled. No custom
archive is committed as a fixture; the `pg_restore` contract is asserted only
against a stub.

**Environment failures are reported as backup failures.** A missing Docker
daemon yields `structuralRestore: FAILED` with the cause only in a detail
string, and the cleanup assertion still reports success (§3.2 item 9).

**Grant-plan gates not met.** `docs/grant-plan.md` requires that "every
failure-catalogue fixture is detected in CI" — two of the five are shell
simulations that never invoke `crv`, and none of the five runs in CI — and that
"at least two independent validator operators have tested the beta"; there is
no record of any external operator use.

**Documentation not matching the build.** The README's `verify` transcript is
abridged relative to real output (§3.1). `docs/version-policy.md` and
`docs/version-matrix.md` describe unrecognised shapes as degrading to `UNKNOWN`,
which holds for unknown columns but not for an unknown table name (§4).
`docs/report-schema-v1.json` is still packaged although no code emits schema
1.0. `docs/interface.md` documents exit 70 as "internal or drill execution
error", but it is also what a missing path, an unreadable file, and
`inspect <directory>` return.

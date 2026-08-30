# Canton, Daml and validator-node research

Date: 2026-08-30. Written in English to match the rest of `docs/`.

Scope: the Canton protocol and its node roles, Daml and the developer surface,
the Canton Network / Global Synchronizer / Splice stack, the anatomy and
operations of a validator node, and the tooling an operator or developer
actually has. The last section states what this means for `crv` specifically.

## 0. Method and reliability

Two classes of statement appear below and are labelled throughout:

- **Verified** — reproduced in this session against a primary artifact: a git
  tag, a file at a pinned tag, a computed hash, or a registry manifest. The
  command or file path is named.
- **Reported** — taken from vendor documentation or a blog post and not
  independently reproduced.

One reliability finding shapes the rest of this document. The rendered
release-notes page at `docs.canton.network` and the repository disagree:

| Source | Newest Splice version it presents |
| --- | --- |
| `docs.canton.network/global-synchronizer/release-notes/splice` | 0.7.5, and it attributes "PostgreSQL 18 officially supported", the migration-ID freeze and the serial-ID concept to 0.7.0 |
| `docs/src/release_notes.rst` **at tag 0.7.5** in `canton-network/splice` | 0.6.6; the file contains no 0.7.x section and never mentions PostgreSQL 18. The migration-ID freeze and serial-ID text is in the **0.6.2** entry |

**Verified.** Tags `0.7.0`–`0.7.5` exist (`git ls-remote --tags`), but the
in-repo release notes at tag `0.7.5` stop at 0.6.6, and `grep -i "postgres.*1[5-9]"`
over them returns only an unrelated "postgres 15" line from an old entry.

Consequence: **in-repo release notes are not a reliable version oracle for this
project, and the rendered docs page cannot be quoted without checking the tag.**
Everything version-sensitive below was taken from the repository at a pinned tag.

## 1. Canton: protocol and node roles

**Reported** (Canton Network docs, `overview/reference/synchronizer-overview`).

Canton is a network of networks. The two node families are:

| Role | Responsibility |
| --- | --- |
| **Participant node** | Executes Daml smart contracts, holds the local Active Contract Set, validates transaction contents, hosts parties |
| **Synchronizer** | Not one process — a **sequencer** plus a **mediator** |

- **Sequencer** — delivers messages to designated recipients with "atomic
  multicast properties with privacy"; the ordering layer establishes a
  consistent order and assigns timestamps, "which is fundamental for conflict
  detection".
- **Mediator** — aggregates transaction confirmations from stakeholder
  participants and approves or rejects, as the coordinator of a **two-phase
  commit** protocol.

Privacy is structural, not policy: "the Synchronizer can not decrypt the
transaction payloads"; messages are "always encrypted end-to-end between the
relevant participants". A participant may connect to **several synchronizers at
once**. Decentralised synchronizers are run by Super Validators jointly using
**BFT state machine replication**.

The practical consequence for any tooling: a participant's database is the only
place its local view lives, and no synchronizer can reconstruct it for you.
That is why the backup question is a participant-database question.

## 2. Daml and the developer surface

**Reported** (Daml SDK docs, Digital Asset platform docs 3.5).

- **Daml** is the smart-contract language; compiled artifacts ship as **DARs**.
- **Ledger API (gRPC)** is the primary application interface: Command
  Submission, Completion, Transaction and Active Contract services. Canton 3.x
  exposes **Ledger API v2**.
- **JSON API** wraps the Ledger API over HTTP/WebSocket. "In Canton 3.x, the
  JSON API is integrated into the Canton participant process." JSON Ledger API
  **v1 is deprecated and removed in Daml 3.4**; v2 arrived in Daml 3.3.
- **PQS (Participant Query Store)** is an optional read side: it subscribes to
  the participant's Ledger API transaction stream and writes a denormalised
  JSONB projection into its own PostgreSQL database, queried over JDBC. It
  exists because "the Canton ledger (gRPC Ledger API) and the JSON API are not
  optimized" for high-throughput or complex queries. PQS exposes a stable
  **SQL API** of functions — "the only database artifacts readers interact with".
- **Daml Shell** is a terminal application for querying a ledger through a PQS
  datastore.

Note for anyone reasoning about backups: **PQS is a derived store.** It is
rebuildable from the participant, so it is not part of the recovery-critical
set, while the participant database is.

## 3. Canton Network, the Global Synchronizer and Splice

**Reported.**

- The **Global Synchronizer** is the shared synchronizer every validator
  connects to for Canton Coin transactions, ACS commitments and topology
  exchange.
- **Super Validators (SVs)** jointly operate the sequencers and mediators under
  BFT, and run **Scan**, the public read API over network data.
- **Splice** is the open-source application layer: the Amulet (Canton Coin),
  Wallet and Amulet/Canton Name Service DARs, the validator app, Scan, and the
  deployment bundles. It is mirrored at both `canton-network/splice` and
  `hyperledger-labs/splice` (**verified**: both carry identical `0.7.x` tags).
- **Token Standard DARs** implement **CIP-0056** for standardised token
  transfer interfaces.

Validators may also connect **dedicated synchronizers** for enterprise or
consortium domains while still settling through the Global Synchronizer.

## 4. Anatomy of a validator node

**Reported** (`docs.canton.network/overview/reference/validator-node-components`),
cross-checked against the compose bundle at tag 0.7.5 (**verified**).

| Component | What it is |
| --- | --- |
| **Canton participant** | Daml Engine + Active Contract Set + protocol layer |
| **Validator app** | Backend joining the UIs to the participant; manages the Global Synchronizer connection; runs wallet automation (reward collection, subscription payments, traffic purchase) |
| **PostgreSQL** | Ledger state, sequencer client messages, topology, and validator-app data, across multiple schemas |
| **Wallet UI** / **CNS UI** | Browser UIs, authenticated through an external OIDC provider |
| **nginx** | Ingress in the compose bundle |
| **PQS** | Optional read-side projection |

API surfaces: **Ledger API (gRPC)**, **JSON API**, **Admin API** (synchronizer
connections, DAR upload, party allocation, topology, pruning schedules),
**Validator App REST API on port 5003** (Wallet, User Management, CNS, External
Signing, and the **Validator Management API** `/v0/admin/participant/*`), and a
**Scan Proxy** that "provides BFT read access to the public Scan API data hosted
by Super Validators" by querying several SVs and returning a consensus result.

**Verified** from `cluster/compose/validator/compose.yaml` at tag 0.7.5: the
services are `postgres` (`postgres:${SPLICE_POSTGRES_VERSION}`),
`canton-participant`, `validator-app`, `wallet-web-ui`, `ans-web-ui`, `nginx`,
plus a busybox init container.

## 5. Version landscape as of 2026-08-30

**Verified** unless marked otherwise.

| Fact | Value | How verified |
| --- | --- | --- |
| Newest Splice tag | **0.7.5** | `git ls-remote --tags` on both mirrors |
| Newest Canton tag | **v3.5.15** | `git ls-remote --tags digital-asset/canton` |
| Canton release lines present | 2.10, 3.0–3.5 | same |
| Newest `0.6.x` Splice tag | **0.6.14** | tag listing filtered to `0.6.*` |
| PostgreSQL pinned by the 0.7.5 compose bundle | **14** (`POSTGRES_VERSION=${POSTGRES_VERSION:-14}`) | file at tag 0.7.5 |
| Participant image `…/canton-participant:0.7.5` | exists publicly | anonymous GHCR manifest request, HTTP 200 |
| Minimum Splice version for validators (DevNet/TestNet/MainNet) | **0.6.2** | *Reported* — Canton Network forum announcement |

The "PostgreSQL 18 officially supported" claim attributed to 0.7.0 by the
rendered docs page is **not supported by the repository at tag 0.7.5** and
should not be relied on.

### Migration ID and serial ID

**Verified** from the 0.6.2 release-notes entry in the repository:

- "The migration ID is now frozen at its current value and configured only once,
  as the `migration.id` field in helm chart values".
- "The serial ID is incremented by 1 for each logical synchronizer upgrade and
  replaces the migration ID in synchronizer release names, DNS entries, DB
  names, chain IDs and port numbers".
- "Participant naming and the participant DB name continue to use MIGRATION_ID,
  which is now frozen".

So there are now **two counters**, and they move independently: a frozen
migration ID that still shapes participant naming, and a serial ID that
increments per LSU. Any tool that treats "the migration number" as one thing is
wrong on current networks.

### Participant database naming

**Verified** from `cluster/compose/validator/start.sh` at tag **0.7.5**:

```sh
if [ -z "${migration_id}" ]; then
  PARTICIPANT_DB_NAME="participant"
else
  PARTICIPANT_DB_NAME="participant-${migration_id}"
fi
```

No `-m` flag → `participant`. With `-m` → `participant-<migration_id>`. This is
unchanged from the 0.6.8+ behaviour and now confirmed to hold through 0.7.5.
The database name is therefore **deployment provenance, not derivable from the
network's migration ID**.

### Logical Synchronizer Upgrades (LSU)

**Reported** (canton.network blog, 29 June 2026; forum announcements).

- LSUs are now "the only supported mechanism for protocol upgrades and
  network-wide disaster recovery", live on MainNet with Canton 3.5.
- Upgraded infrastructure "runs in parallel as the network goes through the
  upgrade"; the switch "completes in just seconds or minutes".
- Explicitly: "No export/import cycle. No rebuilding of validator history. No
  need for coordinated outages."
- Applications continue "under the same logical synchronizer identity";
  validators "detect the successor synchronizer, verify consistency, and switch
  over automatically".
- Operator summary given: "Just upgrade the binary every week and the rest of
  the process is automatic."
- The 0.6.5 release notes carry an `.. important::` block: validators must
  upgrade to 0.6.5 or newer **before any LSU**, or the node "will be unable to
  receive or submit transactions".

The blog does **not** state what happens to physical synchronizer identity or
serial across an LSU; that detail comes from the 0.6.2 notes above (serial
increments) and from the SV LSU runbook.

### Version upgrades (non-protocol)

**Reported** (`validator_operator/validator_upgrades.html`):

- "Version upgrades can be done by each node independently and only require an
  upgrade of the docker-compose file or a `helm upgrade`".
- "You must not delete or uninstall any Postgres database, change migration IDs
  or secrets for a version upgrade."
- For compose: "you must update the full bundle including the docker compose
  file and the start.sh script and adjust `IMAGE_TAG`. Only updating
  `IMAGE_TAG` is insufficient as the old docker compose files might be
  incompatible."

## 6. Backup, restore and pruning — the operator's real constraints

**Reported**, from the Splice validator operator docs. These are the load-bearing
statements for any recovery tooling.

### Backup

- Two PostgreSQL instances must be dumped: the **validator app's** and the
  **participant's**.
- **Ordering is mandatory**: "The backup of the validator app's postgres
  instance must be taken at a point in time strictly earlier than that of the
  participant" — "the app's instance backup is completed before starting the
  participant one."
- Recommended frequency: **at least every 4 hours**.
- Identities export:
  `GET /api/validator/v0/admin/participant/identities` with an OAuth2 Bearer
  token; for compose, against `http://wallet.localhost`.
- The documented compose commands read the live participant DB name from the
  container rather than assuming it:
  `active_participant_db=$(docker exec splice-validator-participant-1 bash -c 'echo $CANTON_PARTICIPANT_POSTGRES_DB')`.
- **Historical retention**: if participant pruning is enabled, keep historical
  backups spaced **closer than the configured pruning retention**, and retain
  backups across logical synchronizer upgrades.

### Restore / disaster recovery

Recovery is possible only if **at least one** of these holds: a recent database
backup, an up-to-date identities backup, or an external KMS still holding the
keys. Without one of them the participant's secret keys cannot be proven and
assets cannot be recovered.

Full restore from database backups additionally requires:

- the backup is **less than 30 days old** — "Due to sequencer pruning, a
  participant that is more than 30 days behind will be unable to catch up on the
  synchronizer to become fully operational again";
- if the backup **predates a logical synchronizer upgrade**, "the old physical
  synchronizer nodes must still be accessible".

Documented compose restore sequence: `./stop.sh` → `docker volume rm
compose_postgres-splice` → start postgres only → `pg_isready` → restore
`validator` → restore `participant-$migration_id` → `docker compose down` →
restart. "Users onboarded after the backup was taken must be manually
re-onboarded."

Identities-only recovery deploys a **new** validator under the original
namespace key and recovers Canton Coin balances and CNS entries, with SVs
supplying data about contracts the migrated parties are stakeholders of. It is
a re-onboarding workflow, not a restore.

### What the 30 days actually is

The 30-day figure is a **network policy consequence of sequencer pruning**, not
a value a validator can read. No public Scan endpoint exposes sequencer
retention, the pruning lower bound, or pruning status; effective retention comes
from SV configuration and the pruning status is behind the private sequencer
admin API. Treating 30 days as a constant is therefore an assumption about
someone else's configuration.

## 7. Tooling inventory

| Tool | Kind | What it is for |
| --- | --- | --- |
| **Canton console** | Interactive admin shell | Health, identity, topology, party and pruning operations; `health.status`; repair/preview commands can alter ledger state irreversibly. Started for compose with a `console.conf` naming `remote-participants` and an auth token, run from the `canton` image; for k8s via `kubectl debug`. A few commands are local-only |
| **Admin API (gRPC)** | Node API | Synchronizer connections, DAR upload, party allocation, topology queries, pruning schedules |
| **Ledger API v2 (gRPC)** / **JSON API v2** | Application API | Command submission and reads; JSON API is in-process in Canton 3.x |
| **Validator Management API** `/v0/admin/participant/*` | REST, port 5003 | Participant identities export, synchronizer connection config |
| **Scan API** | Public REST from SVs | Network data; `/api/scan/version` reports `{version, commit_ts}`. No retention/pruning field is exposed |
| **Scan Proxy** | Validator-side | BFT read of Scan across several SVs |
| **PQS + Daml Shell** | Read side | Denormalised JSONB projection with a stable SQL API; terminal querying |
| **Daml Assistant / SDK** | Developer | Build and test DARs |
| **`cn-quickstart` / LocalNet** | Bench | Disposable full topology (SV, participants, sequencer, mediator, Scan, PostgreSQL) for reproducible experiments |
| **`canton-cro`** | Third party | Party/participant recovery orchestration — the layer *above* verification |

Gap worth naming: everything above either **runs the node** or **reads a live
node**. Nothing in the official toolchain inspects a *backup artifact at rest*
or tests a restore. `pg_verifybackup` is the nearest general-purpose analogue
and it applies to `pg_basebackup`, not to the logical `pg_dump` artifacts the
documented validator procedure produces — and the PostgreSQL docs themselves say
it is not a substitute for a test restore.

## 8. What this means for `crv` — verified checks

The following were computed in this session against the newest stack.

### 8.1 The D2 offset invariant still holds on 0.7.5 / Canton 3.5.15

| Check | Result |
| --- | --- |
| Splice `V001__create_schema.sql` SHA-256 at 0.6.14, 0.7.0, 0.7.2, 0.7.5 | **identical**, and equal to the `sourceDefinitionSha256` recorded in `compatibility.json` (`786ee613…`) |
| `store_last_ingested_offsets` at tag 0.7.5 | `(store_id, migration_id, last_ingested_offset)` — unchanged; **no later migration alters it** (`grep -rln` over all 40+ migration files matches only V001) |
| `lapi_parameters` in Canton **v3.5.15** (`community/common/src/main/resources/db/migration/canton/postgres/stable/V2_0__lapi_3.0.sql`) | `ledger_end, participant_id, participant_pruned_up_to_inclusive, ledger_end_sequential_id, ledger_end_string_interning_id, ledger_end_publication_time` — and **no `ALTER TABLE lapi_parameters`** anywhere in the postgres migrations |
| crv's participant shape hash recomputed from the Canton 3.5.15 column order | `29e26329…` — **matches** `compatibility.json` exactly |

So `splice-d2-offset-v1` is still the correct adapter two minor lines beyond the
versions it was recorded against. That is a genuine positive result, and it was
never asserted anywhere before this check.

Structural caveat: crv's `sourceDefinitionSha256` tracks the **Splice** V001
file only. The participant half of the invariant comes from **Canton**, which is
versioned and released separately. A Canton-side change to `lapi_parameters`
would not move the watched hash. The column-shape check would still catch it at
inspection time (it degrades to `UNKNOWN`), but the compatibility watch would
stay green while it happened.

### 8.2 The compatibility watch cannot see the current release line

**Verified.** Running the selector from `experiments/09-compatibility-watch.sh`
against the live remote today returns **`0.6.14`**, because the script filters
`refs/tags/0.6.*` and greps `^0\.6\.[0-9]+$`. The newest release is **0.7.5**.

The watch therefore re-validates a superseded line indefinitely and never fails
— it cannot report a compatibility regression it is structurally unable to
observe. This is the sharpest instance of the `0.6`-hard-coding noted in
`docs/status-report.md` §4, now with a concrete version gap behind it.

### 8.3 The drill's PostgreSQL 14 restriction is still correct

**Verified.** The 0.7.5 compose bundle still pins `POSTGRES_VERSION=14`. crv's
`postgresMajor: 14` and its refusal of non-14 artifacts remain right for compose
deployments. (The rendered docs' "PostgreSQL 18" claim would have implied
otherwise; it is unverified — see §0.)

### 8.4 An unrecorded-version drill on 0.7.5 would work

**Verified.** `ghcr.io/digital-asset/decentralized-canton-sync/docker/canton-participant:0.7.5`
resolves anonymously (HTTP 200). crv's unrecorded-version path — pull the exact
tag, resolve one immutable digest, report `PASSED_UNVERIFIED_VERSION` — has a
real image to work with for the current release.

### 8.5 Documentation confirms two crv premises and two deferrals

| crv position | Upstream status |
| --- | --- |
| Validator dump must complete before participant dump starts (the D2 premise) | **Confirmed verbatim** by the backup docs: "strictly earlier", "completed before starting the participant one" |
| Participant DB name is declared provenance, not derivable | **Confirmed** by `start.sh` at 0.7.5 and by the documented `echo $CANTON_PARTICIPANT_POSTGRES_DB` read |
| Backup-frequency heuristic deferred (`docs/todo.md`) | Upstream **does** state a policy: "at least every 4 hours" — so the "needs an operator-declared policy" precondition is weaker than assumed; a documented default exists |
| Historical spacing check deferred (`docs/todo.md`) | Upstream **does** state the rule: keep historical backups spaced closer than the configured pruning retention, and retain across LSUs |

### 8.6 Not covered by crv, and named upstream

- **External KMS** as a third recovery path, alongside DB backup and identities
  backup. crv models two paths, not three.
- **Users onboarded after the backup** must be manually re-onboarded — a
  recovery-completeness fact no artifact check can see.
- **Old physical synchronizer accessibility** across an LSU is a precondition
  crv reports as `network.lsu_path`, but the sourcing remains operator-declared;
  nothing in the artifact carries it.

## 9. Open questions

1. Why do the tags (0.7.5) and the in-repo release notes (0.6.6) diverge? Until
   that is understood, neither source alone establishes what a given release
   changed.
2. Does the Helm/Kubernetes path pin the same PostgreSQL 14? Only the compose
   bundle was checked at tag 0.7.5.
3. What are the actual physical-synchronizer identity and serial values exposed
   after an LSU, and through which endpoint — needed to make `network.lsu_path`
   resolvable from live evidence rather than operator declaration.
4. Whether Canton 3.5's `lapi_parameters` is reachable in any deployment via a
   path other than the postgres migration (the H2 variant has a **different
   column order**, so an H2-derived artifact would not match the recorded shape).
5. Production database inventory and owners on a real validator — still the open
   confirmation from `docs/discovery.md`.

## Sources

- [Synchronizer overview — Canton Network Docs](https://docs.canton.network/overview/reference/synchronizer-overview)
- [Validator node components — Canton Network Docs](https://docs.canton.network/overview/reference/validator-node-components)
- [Backups of a validator — Splice docs](https://docs.dev.sync.global/validator_operator/validator_backups.html)
- [Disaster recovery — Splice docs](https://docs.dev.sync.global/validator_operator/validator_disaster_recovery.html)
- [Docker-Compose deployment of a validator — Splice docs](https://docs.dev.sync.global/validator_operator/validator_compose.html)
- [Kubernetes deployment of a validator — Splice docs](https://docs.dev.sync.global/validator_operator/validator_helm.html)
- [Validator upgrades — Splice docs](https://docs.dev.sync.global/validator_operator/validator_upgrades.html)
- [Console access — Splice docs](https://docs.sync.global/deployment/console_access.html)
- [Splice release notes — Canton Network Docs](https://docs.canton.network/global-synchronizer/release-notes/splice)
- [`release_notes.rst` at tag 0.7.5 — canton-network/splice](https://github.com/canton-network/splice/blob/0.7.5/docs/src/release_notes.rst)
- [Canton Network goes live with Logical Synchronizer Upgrades](https://www.canton.network/blog/logical-synchronizer-upgrades)
- [Minimum Splice versions — Canton Network Forum](https://forum.canton.network/t/minimum-splice-versions/8683)
- [PQS user guide — Daml SDK](https://docs.daml.com/query/pqs-user-guide.html)
- [PQS SQL API — Digital Asset platform docs 3.5](https://docs.digitalasset.com/build/3.5/component-howtos/pqs/references/sql-api.html)
- [Canton console — Digital Asset platform docs 3.5](https://docs.digitalasset.com/operate/3.5/howtos/operate/console/console.html)
- [The Ledger API services — Daml SDK](https://docs.daml.com/app-dev/services.html)
- [digital-asset/canton releases](https://github.com/digital-asset/canton/releases)

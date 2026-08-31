# Getting crv to a fundable, adoptable state

Date: 2026-08-30. Companion to `status-report.md` (what is there) and
`canton-research.md` (what upstream is). This one is constructive: what the
evidence says is worth building, who to build it with, and what to add along
the way.

Every claim traces to a primary source checked in this session. Sources are
named inline.

---

## 1. The demand evidence that was missing

`grant-plan.md` asserts the problem is real but cites only the project's own
experiments. Three external artifacts now support it, and one of them is close
to decisive.

### 1.1 The leading commercial validator manager disclaims exactly this work

IntellectEU's **Catalyx Blockchain Manager (CAT-BM)** is a commercial Canton
validator management platform. Its own FAQ answers whether it handles database
backups:

> "**No. Database backups are yours to run, with your existing PostgreSQL
> tooling and retention policy.** CAT-BM provides the identity dump, which is
> the other half of a recoverable validator."

The same docs state the dependency plainly:

> "You need both. A database backup without the identity cannot be restored
> onto a node the network recognises; an identity without a database gives you
> a recognised node with no history."

and, on the normal recovery path:

> "Some transaction loss is possible, bounded by your backup frequency."

So a paying operator on a managed platform still owns the database half, runs
it with generic PostgreSQL tooling, and has nothing that checks whether the
result would restore. That is not crv's competitor — it is crv's distribution
channel and its problem statement in a vendor's own words.

### 1.2 The community names crv's exact failure mode, with no tool behind it

In the Canton Network Forum thread *Database backup and disaster recovery*
(#8107), the answer to an operator asking how to back up and restore includes:

> "If the validator DB is ahead, it may cause recovery issues."

That is the D2 invariant, stated as folklore. Nothing in the ecosystem checks
it. crv's LocalNet evidence shows why folklore is not enough: the inconsistent
pair **restores successfully and every process reports healthy**.

### 1.3 Operators hit the recovery constraints in practice

Forum thread #8620 (*Remove old vps and how to restore old validator to new
vps*) is a real operator migrating a validator. The answer given:

> if the node has been offline more than 30 days "the sequencer pruning window
> may have expired and you'll see a `MemberDisabled` error when reconnecting"

— after which the only route is SV-coordinated re-onboarding. This is
`backup.latest_age` as a lived operator problem, not a theoretical one.

### 1.4 Upstream mandates the rule but ships no verifier

The Splice backup docs require that the validator dump complete **strictly
before** the participant dump starts, and recommend backups "at least every 4
hours". They provide the procedure and no way to confirm it held.

**Summary of the gap:** the requirement is documented, the failure is known to
the community, a commercial platform explicitly leaves it to the operator, and
no tool in the ecosystem inspects a backup artifact at rest.

---

## 2. Champion and design partners — concrete named route

The Development Fund's `sig-directory.md` is a public roster of technical
contributors who have volunteered to "act as **champions** helping applicants
prepare stronger proposals". The review process confirms a Champion is how a
promising proposal gets refined toward a vote. Three SIGs matter here.

### Party Portability & Data Resilience — the closest domain match

| Name | Organization |
| --- | --- |
| Wayne Collier | Digital Asset |
| Simon Meier | Digital Asset |
| Oliver Seeliger | Digital Asset |
| Zhi Zhang | Edge & Node |

Four people, and the SIG's name is crv's subject matter. This is the first
place a problem statement should be taken.

### Node Deployment & Operations — the design-partner pool

Thirteen people, and critically these are **operators and infrastructure
providers**, which is what RFP 23 asks proposals to be "broadly applicable"
across:

| Name | Organization | Why relevant |
| --- | --- | --- |
| Jonathan Mayeur | IntellectEU | Makes CAT-BM, which disclaims DB backups (§1.1) |
| Caleb Bolden · Marijus Kasperavicius | Blockdaemon | Hosted validator provider |
| Jeremy Alons | Cumberland | Operator |
| Andrew Pohl | Liquify | Operator |
| Roman Borovtsov | Cantor8 | Operator |
| Stanislav German-Evtushenko | SBI Security Solutions | Also in the Security SIG |
| Zhe Li | Gateway.FM | Infrastructure provider |
| Lucas Naundorf | FCS | Operator |
| Itai Segall | Digital Asset | — |

### Security — RFP 23's home

Edward Newman (Digital Asset), Richard Domikis (MPCH), Stanislav
German-Evtushenko (SBI Security Solutions).

### Two observations

- **Stanislav German-Evtushenko sits in both Node Deployment & Operations and
  Security.** For a tool that is an operations tool submitted under a security
  RFP, that is the single best-targeted contact in the directory.
- **IntellectEU is in the operations SIG and ships the product that disclaims
  this work.** A design-partner conversation there is unusually well-founded:
  crv fills a gap their own documentation names.

### The mechanism

SIGs have dedicated Slack channels and operate ad-hoc. The directory is
maintained by pull request — *"If you would like to join an existing SIG …
please submit a Pull Request updating this file."* Joining Party Portability &
Data Resilience or Node Deployment & Operations is itself a public, low-cost
first move that creates the contact surface.

The review process also asks applicants to *"discuss the need with the relevant
SIG, maintainers, developers, or affected ecosystem participants"* and to
*"gather evidence that the problem is real"* **before** submitting. §1 is that
evidence; the SIGs are where it gets tested.

---

## 3. What to add to the product along the way

Ordered by ratio of operator-visible value to effort. Each item names the
finding behind it.

### 3.1 Corrections that a reviewer will otherwise find

| # | Change | Why |
| --- | --- | --- |
| 1 | Widen the compatibility watch beyond `0.6.*` | Verified: the selector returns **0.6.14** against the live remote while Splice is at **0.7.5**. The tool visibly tracks a superseded line |
| 2 | Print `artifacts[].limitations` in human output | Verified: a missing `pg_restore` and an empty directory produce identical messages. This is the #2 first-contact failure |
| 3 | Give user-input errors their own exit class | Verified: a missing path and `inspect` on a directory both return **70**, documented as "internal error" |
| 4 | Fix the README transcript and the `version-policy.md` `UNKNOWN` claim | Verified: the transcript is abridged relative to real output, and an unrecognised *table name* reaches `FAILED`, not `UNKNOWN` |
| 5 | Test `backup.required_path` and `deployment.selected_identity` | Both have **zero** tests. Untested checks in a verification tool are a credibility problem, not a coverage statistic |
| 6 | Make the failure fixtures invoke crv and run in CI | Two of five never call crv; none run in CI. `grant-plan.md`'s own submission gate requires "every failure-catalogue fixture is detected in CI" |

Items 1–4 are small. Items 5–6 close a submission gate that currently has no
window on the timeline.

**Status update (2026-08-31, after PR #7):** item 2 is done (limitations are
printed); the behaviour half of item 4 is done (an unrecognised table now
degrades to `UNKNOWN`, matching the version docs) while the README transcript
remains stale; item 5 is partial (`backup.required_path` gained one test for
its new `UNKNOWN` branch; `deployment.selected_identity` still has none).
Items 1, 3 and 6 remain open. PR #7 also fixed two §3-adjacent honesty issues
beyond this list: drill environment failures now report `ENVIRONMENT_ERROR`
instead of `FAILED`, and cleanup verification is tri-state instead of
reporting success when Docker is unreachable.

### 3.2 Capability additions that raise value per operator

**Read the effective participant DB instead of requiring it to be declared.**
The Splice backup docs already show the move:
`active_participant_db=$(docker exec … 'echo $CANTON_PARTICIPANT_POSTGRES_DB')`.
Today `deployment.selected_identity` compares a config string against a
database the drill created from that same string — a tautology (`status-report.md`
§3.2). Reading the *deployment's* actual value makes the check mean what its
title claims, and removes one of the four `UNKNOWN`s an operator hits on first
run.

**Resolve physical synchronizer identity from Scan.** `network.lsu_path`
currently compares two operator-declared values. Scan exposes
`/v0/dso-sequencers`, `/v0/active-synchronizer-serial` and `/v0/lsu`. crv
already speaks to Scan for `/api/scan/version`, so the client exists. This turns
a declared check into a derived one — and the serial is now the counter that
actually moves, since the migration ID is frozen (`canton-research.md` §5).

**Ship the two deferred checks — upstream now supplies the policy.**
`todo.md` defers backup frequency "only with an explicit operator policy" and
historical spacing pending a separate axis. The Splice docs state both: back up
"at least every 4 hours", and keep historical backups spaced closer than the
configured pruning retention, retained across LSUs. The precondition for
shipping them is weaker than assumed.

**Accept a live database endpoint, not only files.** This is the largest
strategic gap and the cheapest to describe. crv today takes *artifacts*. In
Kubernetes, PV/CSI and managed-database worlds there often is no dump file —
there is a snapshot that gets **cloned into a new volume**. The clone is
provider-specific and not crv's job; but once cloned, what remains is a
PostgreSQL database, which is exactly what crv's drill already inspects after
restoring. Letting `verify`/`drill` target a reachable database instead of a
file would open the hosted market **without adding a single new check**. It also
answers RFP 23's "both self-operated and hosted" clause directly.

**Emit something a scheduler can consume.** `watch` already persists reports and
returns verdict-shaped exit codes, but there is no metrics surface. A Prometheus
textfile-collector output (or a single summary line) is small and turns crv from
a command into something an operator wires into existing alerting — which is how
this class of tool actually gets adopted.

### 3.3 What the hosted/Kubernetes path actually requires

`docs/discovery.md` D8 maps Helm parity from charts only and marks isolated
restore on a real cluster as **unknown, needs testing**. The ecosystem approach
is settled enough to build against:

- **Velero** is the de facto Kubernetes backup standard and has had stable CSI
  snapshot integration since v1.9; CSI snapshots are point-in-time PV copies.
- The documented database pattern is **pre-backup hooks** for engine-appropriate
  quiescing, and **provisioning a new PVC from a `VolumeSnapshot` as data
  source** for restore testing.
- The standing advice in that ecosystem is to "schedule monthly restore drills
  to a test namespace" — which is precisely crv's `drill`, minus the Canton
  knowledge.

So the K8s story is: the provider clones the snapshot, crv verifies the clone.
Combined with §3.2's live-endpoint input, this is a coherent hosted offering
rather than a second product.

---

## 4. Sequencing against the existing timeline

`grant-plan.md`'s windows, with the additions above placed in them.

| Window | Already planned | Add |
| --- | --- | --- |
| **to 1 Sep** — close Phase 1 review | D2/D3/`pg_dumpall`/vocabulary accepted | §3.1 items 1–4 (small, and they are correctness) |
| **2–15 Sep** — build the narrow beta | Core commands, intrinsic checks, isolated proof, JSON, fixtures | §3.1 items 5–6; the two deferred checks (§3.2) |
| **16–22 Sep** — harden and publish | Fresh-machine reproduction, failure cleanup, docs, tagged beta | Live-endpoint input (§3.2) if it fits; otherwise scope it explicitly as milestone-2 work |
| **2 Sep – 13 Oct, parallel** | Champion + two operator evaluations | **Start here, not after.** §2 gives named contacts. Open with §1, not with the tool |
| **14 Oct+** | Submission-ready review | — |

The parallel track is the long pole and `grant-plan.md` already says so: *"more
coding hours do not remove those dependencies."* Everything in §3 improves the
proposal; only §2 unblocks it.

### On the opening move

The strongest asset is not the feature list — it is a reproducible
demonstration that an offset-inconsistent backup pair restores cleanly, both
Canton and Splice report healthy, and no error is emitted. Paired with §1.1 and
§1.2, the pitch to a SIG is one sentence:

> The docs require validator-before-participant ordering, the community knows a
> validator DB that is ahead causes recovery issues, the leading managed
> platform leaves database backups to you — and here is a case where the
> resulting backup restores green and is still wrong.

That is a problem statement a Champion can carry. The tool is the answer to it,
not the lead.

---

## 5. What this does not solve

- **Adoption is still external.** Nothing here manufactures the two independent
  operator evaluations; §2 only makes them reachable.
- **The hosted path is still untested on a real cluster.** §3.3 is a design
  grounded in the ecosystem's own patterns, not a validated implementation.
- **Scope stays narrow.** Seven checks, one schema family. That is defensible —
  `grant-plan.md` is right that "the grant story is stronger when crv keeps one
  promise and proves it well" — but it means the value case rests on the D2
  demonstration carrying the proposal.
- **§1.1 is a vendor FAQ.** It is strong evidence of a gap, and it is also one
  company's positioning; it should be confirmed in conversation, not quoted as
  market-wide fact.

## Sources

- [Catalyx Blockchain Manager documentation (full corpus)](https://docs.catalyx.solutions/llms-full.txt)
- [Database backup and disaster recovery — Canton Network Forum #8107](https://forum.canton.network/t/database-backup-and-disaster-recovery/8107)
- [Remove old vps and how to restore old validator to new vps — Canton Network Forum #8620](https://forum.canton.network/t/remove-old-vps-and-how-to-restore-old-validator-to-new-vps/8620)
- [`sig-directory.md` — canton-foundation/canton-dev-fund](https://github.com/canton-foundation/canton-dev-fund/blob/main/sig-directory.md)
- [Development Fund Proposal Review Process](https://github.com/canton-foundation/canton-dev-fund/blob/main/Development%20Fund%20Proposal%20Review%20Process.md)
- [2026–2028 Strategic Roadmap and RFPs](https://github.com/canton-foundation/canton-dev-fund/blob/main/2026-2028-strategic-roadmap.md)
- [Backups of a validator — Splice docs](https://docs.dev.sync.global/validator_operator/validator_backups.html)
- [Disaster recovery — Splice docs](https://docs.dev.sync.global/validator_operator/validator_disaster_recovery.html)
- [Velero CSI snapshot design](https://github.com/vmware-tanzu/velero/blob/main/design/Implemented/csi-snapshots.md)
- [CSI volume snapshots and restore](https://kubernetes.recipes/recipes/storage/kubernetes-csi-snapshots-restore/)

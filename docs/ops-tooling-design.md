# Canton-native ops tooling: verified signal inventory

Date: 2026-08-31. Design note, not v0.1 scope. It answers one question from
first principles: **what would a validator watchtower and an upgrade manager
look like on this network**, built from Canton's own mechanics rather than
ported from another chain's assumptions.

Labels as in `canton-research.md`: **Verified** = reproduced in this session
against a pinned source (file at tag `0.7.5` of `canton-network/splice`, tag
`v3.5.15` of `digital-asset/canton`, or a live fetch quoted verbatim);
**Reported** = vendor documentation, not independently reproduced.

Relation to crv: these are the two adjacent products sketched in
`adoption-path.md` (RFP lanes 27/7 for the watchtower, 23/7 for the upgrade
manager). Both consume crv's output; neither is in scope before crv's own
milestones. This note exists so that when they are built, the design starts
from verified endpoints instead of analogy.

## 1. Why imported designs fail here

Two structural facts, both verified earlier in `canton-research.md`:

- A regular Canton validator does not sign blocks; the BFT layer is operated
  by Super Validators, and payloads are end-to-end encrypted. There is no
  public per-validator performance trace to scrape. **Every liveness signal
  that matters is node-local** — which is not a limitation for a monitoring
  agent, it is the design: the agent runs beside the node and reads the
  node's own APIs, using the validator's built-in Scan proxy as its
  BFT-verified view of the network.
- There is no on-chain "upgrade height". Protocol switching is handled
  network-side by LSUs; what remains for the operator is a **weekly release
  cadence with published minimum-version deadlines**, and missing one has a
  stated consequence (0.6.5 release notes, verified at the tag: a validator
  that has not upgraded before an LSU "will be unable to receive or submit
  transactions").

## 2. Verified signal inventory (Splice 0.7.5 sources)

Every Splice app serves four standard endpoints — **Verified**,
`apps/common/src/main/openapi/common-external.yaml`:

| Endpoint | operationId |
| --- | --- |
| `/status` | `getHealthStatus` |
| `/version` | `getVersion` |
| `/readyz` | `isReady` |
| `/livez` | `isLive` |

So the running node's **own version is an API read**, not an `IMAGE_TAG`
guess.

Node-local and network-reference signals:

| Signal | Source | Verified where |
| --- | --- | --- |
| Validator app liveness | container HEALTHCHECK = `wget --spider http://localhost:5003/api/validator/readyz`, `--start-period=10m` | `cluster/images/validator-app/Dockerfile` |
| Participant liveness | healthcheck is **inherited from DA's upstream base image** (`FROM europe-docker.pkg.dev/da-images/public-all/docker/canton-participant:<ver>@<sha256>`); the Splice Dockerfile adds none | `cluster/images/canton-participant/Dockerfile` (probe definition itself: **not inspected** — lives upstream) |
| PostgreSQL liveness | `pg_isready -U $SPLICE_DB_USER` every 10s | `cluster/compose/validator/compose.yaml` |
| Synchronizer connection as configured | `GET /v0/admin/participant/global-domain-connection-config` | `apps/validator/src/main/openapi/validator-internal.yaml` |
| Network's active serial / LSU successor | Scan `GET /v0/active-synchronizer-serial`, `GET /v0/lsu`, `GET /v0/dso-sequencers` | `apps/scan/src/main/openapi/scan.yaml` |
| **Per-member traffic balance** | Scan `GET /v0/domains/{domain_id}/members/{member_id}/traffic-status` | `apps/scan/src/main/openapi/scan.yaml` |
| Traffic purchases | Wallet `POST /v0/wallet/buy-traffic-requests`, `GET .../{tracking_id}/status` | `apps/wallet/src/main/openapi/wallet-external.yaml` |
| Top-up automation knob | `buy-extra-traffic.min-topup-interval` via `ADDITIONAL_CONFIG_TOPUPS` | `cluster/compose/validator/compose-traffic-topups.yaml` |
| BFT-verified network view from inside the node | Scan-proxy: `/v0/scan-proxy/dso`, `/v0/scan-proxy/open-and-issuing-mining-rounds`, `/v0/scan-proxy/amulet-rules`, `/v0/scan-proxy/holdings/summary`, `/v1/scan-proxy/holdings/summary` | `apps/validator/src/main/openapi/scan-proxy.yaml` |
| Identities export (backup half) | `GET /v0/admin/participant/identities` | `validator-internal.yaml`; already used by crv |
| **Upgrade/deadline feed, machine-readable** | `https://sv-cal.canton.foundation/schedule.json` — JSON array of `{title, start, end, status, network, type, dependsOn}`; live fetch today returned `"DevNet upgrades to Splice 0.7.5"` / `"TestNet upgrades to Splice 0.7.4"`, both `2026-08-31`, `type: "Weekly Upgrades"` | **Verified** by live fetch (the page itself does `fetch('./schedule.json')`) |
| Release stream | git tags on `canton-network/splice` (mirrored at `hyperledger-labs/splice`) | Verified in `canton-research.md` |

## 3. Watchtower: alert conditions from the inventory

Single node-local agent (one binary or container on the compose network),
alerting to whatever the operator already uses. Helm deployments get Grafana
material from DA; the compose majority currently gets nothing — that is the
gap.

| Condition | Read | Predicts |
| --- | --- | --- |
| Local `/version` < minimum implied by `schedule.json` for this network | validator app `/version` vs feed | The 0.6.5-note failure mode: node cut off at the next LSU |
| Configured synchronizer vs network serial diverge after an LSU window | `global-domain-connection-config` + participant admin state vs Scan `/v0/active-synchronizer-serial` | Automatic LSU switch did not happen on this node |
| Ledger stalls while the network advances | local ledger-end movement vs `/v0/scan-proxy/open-and-issuing-mining-rounds` progressing | The silent-stuck participant (green health, no progress — the class crv's D2 work demonstrated) |
| Traffic balance below threshold / top-up requests failing | `traffic-status` + `buy-traffic-requests/{id}/status` | Transactions start rejecting while every healthcheck stays green |
| `readyz`/`livez`/`status` flapping on any app | common endpoints | Ordinary outage, but with Canton-specific start-period awareness (10 min) |
| Backup age > policy, last `crv verify` non-`MET`, identities dump age | crv `watch` state/report files | The `MemberDisabled`-after-30-days ending; ties directly into crv |
| Auth chain broken (JWKS/OIDC unreachable) | probe the configured issuer | Wallet automation and UIs fail together |

Everything in the table reads locally or through the node's own Scan proxy;
nothing depends on metadata the privacy model may withdraw (the constraint
RFP item 20 warns about).

## 4. Upgrade manager: what the network's own rules dictate

**Trigger.** Poll `schedule.json` (per-network rows, `status: "Confirmed"`)
and the tag stream. No block-height machinery exists or is needed.

**Procedure, compose** (the documented rules, Reported from release notes /
upgrade docs, quoted in `canton-research.md`): replace the **full bundle** —
"Only updating `IMAGE_TAG` is insufficient"; never delete a Postgres
database, never change migration IDs or secrets. **Procedure, helm:**
`helm upgrade` to the matching chart version.

**Health gate after switch:** the standard endpoints above, then confirm the
synchronizer connection and ledger progression — the same reads as the
watchtower, which is why these are one product family.

**The Canton-specific core — rollback is not a binary swap. Verified:**

- The Splice migration tree at tag 0.7.5 contains **zero** Flyway undo
  migrations (no `U*.sql` anywhere under `db/migration`).
- Canton v3.5.15 contains none either; the only non-`V*` files are two
  `R__…` **repeatable** migrations (autovacuum table settings), which are
  re-applied, not reversed.

Once an upgraded app has run its forward migrations, the previous binary has
no supported path back. Therefore on this network **the only real rollback is
a restore from a backup taken before the upgrade** — and the operator docs
already say to take an identities dump and confirm database backups "before
every version change" (Reported; both Splice docs and CAT-BM's guidance).

Which makes the safety gate concrete: **no green `crv verify` on a
pre-upgrade backup, no upgrade.** The upgrade manager is not adjacent to crv
by branding; it is downstream of it by the network's own migration model.

## 5. Not verified here (to check before building)

- The participant container's healthcheck definition (upstream DA base image;
  the Splice repo pins it by digest but does not define the probe).
- Response schemas of `traffic-status` and the wallet balance endpoints (only
  the paths were verified).
- How minimum versions are authoritatively published beyond `schedule.json`
  titles and forum announcements (the forum's "minimum Splice versions" post
  points operators to sv-cal).
- Stability of `schedule.json` as an interface — it is what the official page
  itself consumes, but it is not documented as public API.

## 6. Sequencing

Unchanged from `adoption-path.md`: crv first (RFP 23; evidence exists, lane
empty), the watchtower as crv-`watch`'s growth into RFP 27 on the same trust
surface, the upgrade manager last (RFP 23/7) — it leans on both, competes
with commercial "handling upgrades" offerings, and carries the highest
blast-radius scrutiny of the three.

## Sources

- `canton-network/splice` at tag `0.7.5`: `apps/common/src/main/openapi/common-external.yaml`, `apps/validator/src/main/openapi/validator-internal.yaml`, `apps/validator/src/main/openapi/scan-proxy.yaml`, `apps/wallet/src/main/openapi/wallet-external.yaml`, `apps/scan/src/main/openapi/scan.yaml`, `cluster/images/validator-app/Dockerfile`, `cluster/images/canton-participant/Dockerfile`, `cluster/compose/validator/compose.yaml`, `cluster/compose/validator/compose-traffic-topups.yaml`, `db/migration` trees
- `digital-asset/canton` at tag `v3.5.15`: `community/common/src/main/resources/db/migration/**`
- [SV operations schedule](https://sv-cal.canton.foundation) and its `schedule.json` (live fetch, 2026-08-31)
- [Minimum Splice versions — Canton Network Forum](https://forum.canton.network/t/minimum-splice-versions/8683)
- `docs/canton-research.md` in this repository for the LSU, release-note and backup-procedure quotations reused above

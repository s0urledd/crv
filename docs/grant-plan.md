# Development Fund path

Status: working plan, not a grant proposal.

## Single objective

Make `crv` the open, operator-neutral way to detect when existing Splice
validator backup artifacts cannot satisfy documented recovery preconditions,
before an incident.

The opening evidence is reproducible: an offset-inconsistent validator and
participant pair restores successfully, Canton and Splice become healthy, and
no runtime error identifies the problem. The two artifact offsets identify it
before restore and without a `crv` manifest.

The second opening proof explains the two verification tiers: a manifest created
from an already-truncated dump has a matching checksum, yet PostgreSQL rejects
the dump during `COPY`. A checksum proves equality to its reference, not that
the referenced backup can restore; the isolated drill supplies that structural
evidence.

## Fit

Target [Canton Development Fund roadmap item 23](https://github.com/canton-foundation/canton-dev-fund/blob/main/2026-2028-strategic-roadmap.md#23-validator-and-shared-infrastructure-security-and-resilience), **Validator and Shared Infrastructure Security and Resilience**. It explicitly requests reusable
backup, recovery, assessment, and resilience tooling that works across
self-operated and hosted validators. The eventual proposal belongs under
`rfps/security-assurance-incident-readiness/`, not the legacy `proposals/`
path.

`crv` stops before recovery. Splice documents the prerequisites; `crv` measures
the available evidence. `canton-cro` plans and executes party or participant
recovery; it may consume the stable `crv` JSON report. PostgreSQL verification
tools validate PostgreSQL artifacts, not the Canton cross-database and network
preconditions.

This plan follows the official [proposal template](https://github.com/canton-foundation/canton-dev-fund/blob/main/proposals/_template.md) and [review process](https://github.com/canton-foundation/canton-dev-fund/blob/main/Development%20Fund%20Proposal%20Review%20Process.md): one objective, measurable ecosystem value, maintenance, and adoption as the primary success signal. The accepted [Canton Index](https://github.com/canton-foundation/canton-dev-fund/pull/319), [dAppBooster](https://github.com/canton-foundation/canton-dev-fund/pull/390), and [Hacken Extractor](https://github.com/canton-foundation/canton-dev-fund/pull/302) proposals provide the comparison set; their amounts and scopes are not templates to copy.

## Submission gate

Do not open the grant PR until all of these are true:

- Phase 1 corrections are reviewed and closed.
- A tagged public beta runs `inspect`, `verify`, and network-isolated restore on
  per-database plain/custom dumps and `pg_dumpall`.
- Every shipped check cites Phase 1 evidence and every failure-catalogue fixture
  is detected in CI.
- JSON schema, exit codes, cleanup behavior, and the two-dimensional report are
  documented and stable for the beta.
- A reviewer can reproduce the dangerous reversed pair and the detector in one
  documented session on a fresh machine.
- At least two independent validator operators have tested the beta on their
  own backup shape and supplied written, redactable feedback. Huginn use does
  not count as external adoption.
- A Development Fund Champion is confirmed.
- The proposal names a maintainer, compatibility policy, and support period.

A date never overrides these gates.

## Working timeline

| Window | Outcome | Exit gate |
| --- | --- | --- |
| 29 Aug - 1 Sep 2026 | Close Phase 1 review | D2, D3, `pg_dumpall`, and report vocabulary accepted |
| 2 - 15 Sep | Build the narrow beta | Core commands, intrinsic checks, isolated proof, JSON, fixtures |
| 16 - 22 Sep | Harden and publish | Fresh-machine reproduction, failure cleanup, docs, tagged beta |
| 2 Sep - 13 Oct, in parallel | Champion and design-partner track | Champion plus two independent operator evaluations |
| 14 Oct or later | Submission-ready review | Every submission gate above is satisfied |

Ten focused engineering hours per day are already enough for the build track.
The schedule risk is external review, operator access, and Champion alignment;
more coding hours do not remove those dependencies.

## Proposal shape

Use one objective and two milestones:

1. **Production release.** Fund only work that remains after the public beta:
   supported-version validation, production packaging, provenance manifests,
   scheduled regression reports, compatibility documentation, and agreed
   operator integration work. Do not request retroactive payment for Phase 1 or
   the beta.
2. **Independent adoption.** Make a material portion claim-based. A qualifying
   adoption is an unaffiliated operator running scheduled verification against
   a production backup process for an agreed continuous period and providing a
   written attestation plus a redacted machine report.

Do not set the CC request until the Champion has reviewed the remaining scope
and two design partners have bounded integration effort. The accepted-proposal
pattern supports a compact build tranche and a substantial adoption-gated
tranche; the amount must follow remaining work, not copy another grant.

## Evidence package for reviewers

The grant PR should link to:

- the D2 one-command reversed-pair demonstration;
- the truncated artifact whose matching manifest digest still precedes a failed restore;
- the Phase 1 evidence/classification table;
- one good and every documented bad JSON report;
- isolated-restore timing, disk, identity, and no-network evidence;
- `pg_dump`, custom dump, `pg_dumpall`, and absent-manifest behavior;
- external operator attestations and the Champion;
- an explicit comparison with Splice documentation, PostgreSQL verification,
  and `canton-cro`.

## Scope discipline

No backup creation, production restore, failover, party migration, dashboard,
alerting platform, deployment manager, or generic Canton control plane. Any of
those is a separate proposal. The grant story is stronger when `crv` keeps one
promise and proves it well.

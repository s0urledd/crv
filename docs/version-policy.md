# Version policy

CRV binds checks to evidence shapes, not Splice release numbers.

## Fast verification

`compatibility.json` is the runtime compatibility record. Each schema family
names the exact table and ordered columns a check understands, their canonical
SHA-256, and the upstream schema-definition hash reviewed for that family.

A recognized shape enables its dependent check regardless of the declared
Splice release. A PostgreSQL dump remains a database artifact when an offset
table is renamed or its columns are unfamiliar, but it yields no offset value;
dependent checks report `UNKNOWN` and name the table and known families. CRV
never guesses an adapter from a nearby version. Existing adapters remain available
when a new family is added.

## Isolated drill

The drill requires one exact Splice version from an identities export or
manifest. Conflicting or absent evidence is unsupported input.

For a version with recorded drill evidence, CRV runs the pinned participant
image digest and reports structural status `PASSED` only after all drill
assertions pass. For an unrecorded version, CRV pulls the matching tag, resolves
exactly one repository digest, runs that immutable digest, records it in the
report, and reports `PASSED_UNVERIFIED_VERSION` after the same assertions pass.
Failure to pull or resolve an immutable digest stops the drill; fast `verify`
remains available.

`PASSED_UNVERIFIED_VERSION` is not a weaker database restore. It says the
specific runtime execution passed but CRV has not yet retained repeatable
release evidence in `compatibility.json`.

Recorded runtime evidence currently covers 0.6.9, 0.6.11, 0.6.14, and 0.7.5.
Each compatibility entry pins the participant image digest and links the CI run
that minted its repeatable evidence.

## Network version

Verification is offline by default. An operator may configure the public
`/api/scan/version` endpoint with `network.scanVersionUrl`. CRV reports its
`version` and `commit_ts` beside the backup-set version. Missing,
unreachable, oversized, or malformed responses produce informational
`UNKNOWN`; they never fail a backup check.

CRV does not scrape Foundation status pages and does not infer compatibility
from the current network version.

## Maintenance

The weekly `Splice compatibility watch` workflow inspects the full public
release-tag stream and always prints the newest tag seen. It classifies the
upstream schema source as unchanged, changed with its table/hash, or
unfetchable. An unchanged unrecorded release is a candidate for `TESTED` only
after the full LocalNet drill; a maintainer reviews generated evidence in a
normal PR before changing the runtime record.

This policy is not version management, an upgrade advisor, or a promise that
offline structural success proves synchronizer catch-up.

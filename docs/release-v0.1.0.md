# crv v0.1.0

crv verifies recovery preconditions in artifacts produced by an existing Splice validator backup process.
It reports one evidence-backed verdict and stable JSON without changing the artifacts.
`crv drill` separately restores a selected set into a disposable, network-isolated participant.

## Install

Requires Node 22.

```sh
git clone https://github.com/s0urledd/crv.git
cd crv
git checkout v0.1.0
npm ci
npm run build
npm link
```

## Recorded drill evidence

- Splice `0.6.9` ([recorded drill evidence](https://github.com/s0urledd/crv/actions/runs/33391920291))
- Splice `0.6.11` ([recorded drill evidence](https://github.com/s0urledd/crv/actions/runs/33391920291))
- Splice `0.6.14` ([recorded drill evidence](https://github.com/s0urledd/crv/actions/runs/33391920291))
- Splice `0.7.5` ([recorded drill evidence](https://github.com/s0urledd/crv/actions/runs/33413098052))

## Evidence records

- [Mis-ordered MainNet pair detected](raw/v0.1-mainnet-verify-misordered-0.6.11.json)
- [First post-fix MainNet drill](raw/v0.1-mainnet-drill-0.6.11.json)
- [MainNet preconditions MET](raw/v0.1-mainnet-drill-met-0.6.11.json)
- [MainNet 7/7 all-applicable MET](raw/v0.1-mainnet-drill-full-met-0.6.11.json)
- [Splice 0.7.5 CI drill](raw/v0.1-ci-drill-0.7.5-schema-1.2.json)

## Claim boundary

Do not translate `MET` or structural `PASSED` into `RECOVERABLE`.

Structural verification does not prove synchronizer catch-up, ACS agreement, or complete production recovery.

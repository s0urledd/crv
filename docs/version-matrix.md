# Supported Splice versions

CRV separates artifact-schema compatibility from runtime-drill evidence. See
[the version policy](version-policy.md).

## Artifact checks

Fast checks do not branch on a Splice release number. The runtime
`compatibility.json` record binds each check to exact table and ordered-column
shapes. The current `splice-d2-offset-v1` family was source-reviewed across
public Splice 0.6.0–0.6.14 tags and 0.7.5. An artifact with that exact shape enables D2
even when its release is unknown. A renamed table or unfamiliar column shape
keeps the database artifact visible and makes only dependent checks `UNKNOWN`.

The release review remains useful evidence about where a family was observed;
it is not a version allowlist.

## Isolated drill evidence

| Splice version | PostgreSQL | Participant image | Evidence |
| --- | ---: | --- | --- |
| 0.6.9 | 14 | Pinned digest in `compatibility.json` | LocalNet drill recorded 2026-08-31 |
| 0.6.11 | 14 | Pinned digest in `compatibility.json` | LocalNet CI drill recorded 2026-08-31 |
| 0.6.14 | 14 | Pinned digest in `compatibility.json` | LocalNet compatibility-watch drill recorded 2026-08-31 |
| 0.7.5 | 14 | Pinned digest in `compatibility.json` | [LocalNet CI drill](https://github.com/s0urledd/crv/actions/runs/33413098052) recorded 2026-08-31 |

One exact version must be available from an identities export or manifest.
Recorded versions use their pinned digest and may report `PASSED`. An
unrecorded version is not rejected: CRV pulls its exact tag, resolves and runs
an immutable digest, and may report `PASSED_UNVERIFIED_VERSION`. A pull or
digest-resolution failure stops only the drill; fast verification remains
available.

## Deployment naming evidence

| Splice versions reviewed | Compose participant DB selection | Validator DB | PostgreSQL |
| --- | --- | --- | --- |
| 0.6.0–0.6.7 | `-m` is required; `participant-<migration_id>` | `validator` | 14 |
| 0.6.8–0.6.14 | no `-m`: `participant`; with `-m`: legacy `participant-<migration_id>` | `validator` | 14 |

Database selection is deployment provenance. It does not select an offset
adapter and does not predict drill success.

## Version evidence

| Input | Evidence class | Behavior |
| --- | --- | --- |
| Identities export `version` | INTRINSIC | Record the exact value. |
| Capture manifest `spliceVersion` | DECLARED | Trust only as declared provenance; report its source. |
| Configured Scan `/api/scan/version` | DERIVED | Report network `version` and `commit_ts`; failure is informational `UNKNOWN`. |
| Plain/custom/cluster database dump | Unavailable | Do not map Flyway schema versions to an exact Splice release. |
| Recognized D2 tables and columns | INTRINSIC schema family | Run only the invariant implemented for that exact shape. |

## Primary sources

- `canton-network/splice` release tags and
  `apps/common/src/main/resources/db/migration/canton-network/postgres/stable/V001__create_schema.sql`.
- Runtime evidence in `compatibility.json` and the linked CI run.
- Recorded source scan: [version matrix output](raw/v1-version-matrix.txt).

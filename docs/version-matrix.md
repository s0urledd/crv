# Supported Splice versions

v0.1 separates source compatibility from runtime-drill evidence. A check runs
only when its required artifact schema is recognized; a release number is never
inferred from a Flyway version or filename.

## Matrix

| Splice versions | Compose participant DB selection | Validator DB | PostgreSQL | Evidence |
| --- | --- | --- | --- | --- |
| 0.6.0–0.6.7 | `-m` is required; `participant-<migration_id>` | `validator` | 14 | Source-reviewed across every release tag |
| 0.6.8–0.6.14 | no `-m`: `participant`; with `-m`: legacy `participant-<migration_id>` | `validator` | 14 | Source-reviewed across every release tag |

The `validator.store_last_ingested_offsets` table definition is byte-for-byte
identical across all 0.6.0–0.6.14 release tags. Its latest-migration offset is
therefore one supported D2 adapter family, not fifteen version branches.

The participant-side `lapi_parameters.ledger_end` query and isolated participant
startup were exercised end to end on Splice 0.6.11. Other 0.6.x releases are
source-compatible for fast artifact inspection but are not yet claimed as
runtime-drill tested. Every release must state this distinction.

## Version evidence

| Input | Evidence class | Behavior |
| --- | --- | --- |
| Identities export `version` | INTRINSIC | Record the exact value. |
| Capture manifest `spliceVersion` | DECLARED | Trust only as declared provenance; report its source. |
| Running image tag or digest | DERIVED | Compare when deployment evidence is supplied. |
| Plain/custom/cluster database dump | Unavailable | Do not map Flyway schema versions to an exact Splice release. |
| Recognized D2 tables and columns | INTRINSIC schema adapter | Run only the invariant implemented for that exact schema shape. |

If a declared or intrinsic version is outside 0.6.0–0.6.14, v0.1 reports the
version as unsupported and does not run version-sensitive checks. Structural
inspection may still identify the artifact, but it must not produce a recovery-
precondition pass. If no exact version is available, schema-intrinsic checks may
run while version-dependent checks explain which manifest or deployment value
would resolve `UNKNOWN`.

## Primary sources

- `canton-network/splice` release tags 0.6.0 through 0.6.14,
  `cluster/compose/validator/start.sh` and `compose.yaml`.
- `apps/common/src/main/resources/db/migration/canton-network/postgres/stable/V001__create_schema.sql`
  at every 0.6.x tag.
- Runtime evidence: the pinned 0.6.11 `cn-quickstart` drill in
  [Phase 1 discovery](discovery.md). The source scan is reproducible with
  [`experiments/07-version-matrix.sh`](../experiments/07-version-matrix.sh); its
  recorded output is [`docs/raw/v1-version-matrix.txt`](raw/v1-version-matrix.txt).

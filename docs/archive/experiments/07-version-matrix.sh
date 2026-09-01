#!/usr/bin/env bash
set -euo pipefail

matrix_root="$(mktemp -d)"
trap 'rm -rf -- "${matrix_root}"' EXIT
base_url="https://raw.githubusercontent.com/canton-network/splice"
schema_path="apps/common/src/main/resources/db/migration/canton-network/postgres/stable/V001__create_schema.sql"

printf '%s\n' 'tag|migration_argument|participant_database_logic|validator_database|postgres_major|offset_schema_sha256'
for patch in $(seq 0 14); do
  tag="0.6.${patch}"
  tag_root="${matrix_root}/${tag}"
  mkdir -p "${tag_root}"
  curl -fsSL "${base_url}/${tag}/cluster/compose/validator/start.sh" -o "${tag_root}/start.sh"
  curl -fsSL "${base_url}/${tag}/cluster/compose/validator/compose.yaml" -o "${tag_root}/compose.yaml"
  curl -fsSL "${base_url}/${tag}/cluster/compose/validator/.env" -o "${tag_root}/compose.env"
  curl -fsSL "${base_url}/${tag}/${schema_path}" -o "${tag_root}/schema.sql"

  if rg -q 'Usage:.*\[-m <migration_id>\]' "${tag_root}/start.sh"; then
    migration_argument="optional"
    participant_database_logic="participant (default); participant-<migration_id> with -m"
  else
    migration_argument="required"
    participant_database_logic="participant-<migration_id>"
  fi
  validator_database="$(rg -o -m1 'databaseName = [^ ]+' "${tag_root}/compose.yaml" | cut -d' ' -f3)"
  postgres_major="$(rg -o -m1 'SPLICE_POSTGRES_VERSION=[0-9]+' "${tag_root}/compose.env" | cut -d= -f2)"
  schema_sha="$(sha256sum "${tag_root}/schema.sql" | cut -d' ' -f1)"
  printf '%s|%s|%s|%s|%s|%s\n' "${tag}" "${migration_argument}" "${participant_database_logic}" "${validator_database}" "${postgres_major}" "${schema_sha}"
done

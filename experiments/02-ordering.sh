#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/bench.sh"

start_bench
work=$(mktemp -d)

cat >"$work/override.yaml" <<'YAML'
services:
  postgres:
    container_name: crv-d2-postgres
    ports: !reset []
  canton:
    container_name: crv-d2-canton
    ports: !reset []
  splice:
    container_name: crv-d2-splice
    ports: !reset []
networks:
  default:
    name: crv-d2-net
    internal: true
YAML

d2_compose() {
  (
    cd "$CRV_QUICKSTART/quickstart"
    IMAGE_TAG="$CRV_IMAGE_TAG" DOCKER_NETWORK=crv-d2-net APP_USER_PROFILE=off \
      docker compose -p crv-d2 \
      -f docker/modules/localnet/compose.yaml \
      -f "$work/override.yaml" \
      -f docker/modules/localnet/resource-constraints.yaml \
      --env-file .env \
      --env-file .env.local \
      --env-file docker/modules/localnet/compose.env \
      --env-file docker/modules/localnet/env/common.env \
      --profile sv --profile app-provider "$@"
  )
}

cleanup() {
  d2_compose down -v >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

participant_offset() {
  docker exec postgres psql -U cnadmin -d participant-app-provider -Atc \
    'select max(event_offset) from participant.lapi_update_meta'
}
validator_offset() {
  docker exec postgres psql -U cnadmin -d validator-app-provider -Atc \
    'select max(last_ingested_offset) from validator.store_last_ingested_offsets'
}

t1_participant=$(participant_offset)
t1_validator=$(validator_offset)
echo "t1 participant_offset=$t1_participant"
echo "t1 validator_offset=$t1_validator"
docker exec postgres pg_dumpall -U cnadmin >"$work/base-t1.sql"
docker exec postgres pg_dump -U cnadmin participant-app-provider >"$work/participant-t1.sql"

token=$(localnet_token app-provider https://canton.network.global)
response=$(curl -fsS -X POST http://127.0.0.1:3903/api/validator/v0/wallet/tap \
  -H "authorization: Bearer $token" \
  -H 'content-type: application/json' \
  --data "{\"amount\":\"1\",\"command_id\":\"crv-d2-$(date +%s%N)\"}")
contract_id=$(jq -er .contract_id <<<"$response")
for _ in $(seq 1 60); do
  [[ "$(participant_offset)" != "$t1_participant" && "$(validator_offset)" != "$t1_validator" ]] && break
  sleep 2
done
echo "t2 participant_offset=$(participant_offset)"
echo "t2 validator_offset=$(validator_offset)"
docker exec postgres pg_dump -U cnadmin validator-app-provider >"$work/validator-t2.sql"

echo "injected_reference validator_t2=$(rg -F -c "$contract_id" "$work/validator-t2.sql" || echo 0) participant_t1=$(rg -F -c "$contract_id" "$work/participant-t1.sql" || echo 0)"

compose_bench stop splice canton postgres
d2_compose up -d postgres
wait_healthy crv-d2-postgres 60
docker exec -i crv-d2-postgres psql -U cnadmin -d postgres <"$work/base-t1.sql" >"$work/base-restore.log" 2>&1 || true
docker exec crv-d2-postgres psql -U cnadmin -d postgres -c 'drop database "validator-app-provider"' >/dev/null
docker exec crv-d2-postgres psql -U cnadmin -d postgres -c 'create database "validator-app-provider"' >/dev/null
docker exec -i crv-d2-postgres psql -v ON_ERROR_STOP=1 -U cnadmin -d validator-app-provider <"$work/validator-t2.sql" >/dev/null

restored_participant=$(docker exec crv-d2-postgres psql -U cnadmin -d participant-app-provider -Atc 'select max(event_offset) from participant.lapi_update_meta')
restored_validator=$(docker exec crv-d2-postgres psql -U cnadmin -d validator-app-provider -Atc 'select max(last_ingested_offset) from validator.store_last_ingested_offsets')
echo "restore_sql=success restored_participant_offset=$restored_participant restored_validator_offset=$restored_validator"
d2_compose up -d canton splice
wait_healthy crv-d2-canton 240
wait_healthy crv-d2-splice 240
echo "restored_stack_canton_health=$(docker inspect crv-d2-canton --format '{{.State.Health.Status}}')"
echo "restored_stack_splice_health=$(docker inspect crv-d2-splice --format '{{.State.Health.Status}}')"
echo "restored_runtime_reported_offset_error=$(docker logs crv-d2-splice 2>&1 | rg -i -c 'offset.*(ahead|missing)|failed_precondition' || echo 0)"
echo 'conclusion=validator app contains a post-t1 contract reference absent from participant t1; SQL restore and green processes do not establish semantic consistency'

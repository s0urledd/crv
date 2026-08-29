#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/bench.sh"

start_bench
work=$(mktemp -d)
network=crv-d4-net
cleanup() {
  docker rm -f crv-d4-wrong-participant crv-d4-postgres >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

docker exec postgres pg_dump -U cnadmin participant-app-provider >"$work/participant.sql"
docker network create --internal "$network" >/dev/null
docker run -d --name crv-d4-postgres --network "$network" --network-alias postgres \
  -e POSTGRES_USER=cnadmin -e POSTGRES_PASSWORD=supersafe \
  --health-cmd='pg_isready -U cnadmin' --health-interval=1s --health-timeout=3s --health-retries=30 postgres:14 >/dev/null
wait_healthy crv-d4-postgres 60
docker exec crv-d4-postgres psql -U cnadmin -d postgres -c 'create database "participant-0"' >/dev/null
docker exec crv-d4-postgres psql -U cnadmin -d postgres -c 'create database "participant-1"' >/dev/null
docker exec -i crv-d4-postgres psql -v ON_ERROR_STOP=1 -U cnadmin -d participant-0 <"$work/participant.sql" >/dev/null

docker run -d --name crv-d4-wrong-participant --network "$network" \
  -e CANTON_PARTICIPANT_POSTGRES_SERVER=postgres \
  -e CANTON_PARTICIPANT_POSTGRES_PORT=5432 \
  -e CANTON_PARTICIPANT_POSTGRES_DB=participant-1 \
  -e CANTON_PARTICIPANT_POSTGRES_SCHEMA=participant \
  -e CANTON_PARTICIPANT_POSTGRES_USER=cnadmin \
  -e CANTON_PARTICIPANT_POSTGRES_PASSWORD=supersafe \
  -e AUTH_JWKS_URL=http://127.0.0.1:1 \
  -e AUTH_TARGET_AUDIENCE=https://canton.network.global \
  -e CANTON_PARTICIPANT_ADMIN_USER_NAME=ledger-api-user \
  -e 'ADDITIONAL_CONFIG_LEDGER_AUTH=canton.participants.participant.ledger-api.auth-services=[]' \
  ghcr.io/digital-asset/decentralized-canton-sync/docker/canton-participant:0.6.11 >/dev/null
wait_healthy crv-d4-wrong-participant 120

restored_ids=$(docker exec crv-d4-postgres psql -U cnadmin -d participant-0 -Atc 'select count(*) from participant.common_node_id')
selected_ids=$(docker exec crv-d4-postgres psql -U cnadmin -d participant-1 -Atc 'select count(*) from participant.common_node_id')
echo "participant_process_health=healthy"
echo "restored_db_identity_rows=$restored_ids"
echo "selected_wrong_db_identity_rows=$selected_ids"
echo 'conclusion=database selection can be wrong while process health is green; compare the selected DB identity, not only a migration-number-shaped name'

#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/../../../scripts/lib/bench.sh"

start_bench
work=$(mktemp -d)
network=crv-d5-net
cleanup() {
  docker rm -f crv-d5-participant crv-d5-postgres >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

docker exec postgres pg_dump -U cnadmin participant-app-provider >"$work/participant.sql"
token=$(localnet_token ledger-api-user https://canton.network.global)
curl -fsS http://127.0.0.1:3903/api/validator/v0/admin/participant/identities \
  -H "authorization: Bearer $token" >"$work/identities.json"

started=$(date +%s)
docker network create --internal "$network" >/dev/null
docker run -d --name crv-d5-postgres --network "$network" --network-alias postgres \
  -e POSTGRES_USER=cnadmin -e POSTGRES_PASSWORD=supersafe \
  --health-cmd='pg_isready -U cnadmin' --health-interval=1s --health-timeout=3s --health-retries=30 postgres:14 >/dev/null
wait_healthy crv-d5-postgres 60
docker exec crv-d5-postgres psql -U cnadmin -d postgres -c 'create database "participant-app-provider"' >/dev/null
docker exec -i crv-d5-postgres psql -v ON_ERROR_STOP=1 -U cnadmin -d participant-app-provider <"$work/participant.sql" >/dev/null
docker run -d --name crv-d5-participant --network "$network" \
  -e CANTON_PARTICIPANT_POSTGRES_SERVER=postgres \
  -e CANTON_PARTICIPANT_POSTGRES_PORT=5432 \
  -e CANTON_PARTICIPANT_POSTGRES_DB=participant-app-provider \
  -e CANTON_PARTICIPANT_POSTGRES_SCHEMA=participant \
  -e CANTON_PARTICIPANT_POSTGRES_USER=cnadmin \
  -e CANTON_PARTICIPANT_POSTGRES_PASSWORD=supersafe \
  -e AUTH_JWKS_URL=http://127.0.0.1:1 \
  -e AUTH_TARGET_AUDIENCE=https://canton.network.global \
  -e CANTON_PARTICIPANT_ADMIN_USER_NAME=ledger-api-user \
  -e 'ADDITIONAL_CONFIG_LEDGER_AUTH=canton.participants.participant.ledger-api.auth-services=[]' \
  ghcr.io/digital-asset/decentralized-canton-sync/docker/canton-participant:0.6.11 >/dev/null
wait_healthy crv-d5-participant 120
finished=$(date +%s)

db_namespace=$(docker exec crv-d5-postgres psql -U cnadmin -d participant-app-provider -Atc \
  "select namespace from participant.common_node_id where identifier='participant'")
dump_namespace=$(jq -r '.id | split("::") | last' "$work/identities.json")
[[ -n "$db_namespace" && "$db_namespace" == "$dump_namespace" ]]

echo "network_internal=$(docker network inspect "$network" --format '{{.Internal}}')"
echo "participant_health=$(docker inspect crv-d5-participant --format '{{.State.Health.Status}}')"
echo "participant_identity_matches_identities_dump=true"
echo "exit_on_fatal_override_used=false"
echo "elapsed_seconds=$((finished-started))"
docker exec crv-d5-postgres psql -U cnadmin -d postgres -Atc \
  "select 'participant_db_bytes=' || pg_database_size('participant-app-provider')"
echo 'claim=artifact restores to a serving participant with the same identity while no synchronizer exists on its internal network'
echo 'not_proved=network catch-up, ACS agreement, validator-app semantic consistency'

#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/bench.sh"

start_bench
work=$(mktemp -d)
cleanup() {
  docker rm -f crv-duplicate-participant crv-duplicate-postgres >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

source_offset=$(docker exec postgres psql -U cnadmin -d participant-app-provider -Atc "select max(event_offset) from participant.lapi_update_meta")
docker exec postgres pg_dump -U cnadmin participant-app-provider >"$work/participant.sql"
docker run -d --name crv-duplicate-postgres --network crv-bench-net --network-alias restore-postgres \
  -e POSTGRES_USER=cnadmin -e POSTGRES_PASSWORD=supersafe \
  --health-cmd='pg_isready -U cnadmin' --health-interval=1s --health-timeout=3s --health-retries=30 postgres:14 >/dev/null
wait_healthy crv-duplicate-postgres 60
docker exec crv-duplicate-postgres psql -U cnadmin -d postgres -c 'create database "participant-app-provider"' >/dev/null
docker exec -i crv-duplicate-postgres psql -v ON_ERROR_STOP=1 -U cnadmin -d participant-app-provider <"$work/participant.sql" >/dev/null

token=$(localnet_token app-provider https://canton.network.global)
curl -fsS -X POST http://127.0.0.1:3903/api/validator/v0/wallet/tap \
  -H "authorization: Bearer $token" \
  -H "content-type: application/json" \
  --data "{\"amount\":\"1\",\"command_id\":\"crv-duplicate-$(date +%s%N)\"}" >/dev/null
for _ in $(seq 1 60); do
  current_offset=$(docker exec postgres psql -U cnadmin -d participant-app-provider -Atc "select max(event_offset) from participant.lapi_update_meta")
  [[ "$current_offset" != "$source_offset" ]] && break
  sleep 2
done
[[ "$current_offset" != "$source_offset" ]]

docker run -d --name crv-duplicate-participant --network crv-bench-net \
  -e CANTON_PARTICIPANT_POSTGRES_SERVER=restore-postgres \
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


for _ in $(seq 1 90); do
  running=$(docker inspect crv-duplicate-participant --format '{{.State.Running}}')
  [[ "$running" == false ]] && break
  sleep 2
done

docker logs crv-duplicate-participant 2>&1 | \
  rg 'Connected to synchronizer|Starting subscription|PreviousTimestampMismatch|SYNC_SERVICE_SYNCHRONIZER_DISCONNECTED|FATAL:' | \
  redact_ids
if docker logs crv-duplicate-participant 2>&1 | rg -q 'PreviousTimestampMismatch|SYNC_SERVICE_SYNCHRONIZER_DISCONNECTED|FATAL:'; then
  echo 'fatal_collision_observed=true'
else
  echo 'fatal_collision_observed=false'
fi
echo "container_running=$(docker inspect crv-duplicate-participant --format '{{.State.Running}}')"
echo "container_exit=$(docker inspect crv-duplicate-participant --format '{{.State.ExitCode}}')"
echo 'scope=disposable LocalNet only; never run this experiment on a public synchronizer'

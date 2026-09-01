#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/../../../../scripts/lib/bench.sh"

start_bench
work=$(mktemp -d)
cleanup() {
  docker rm -f crv-corrupt-postgres >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
docker exec postgres pg_dump -U cnadmin participant-app-provider >"$work/participant.sql"
cp "$work/participant.sql" "$work/participant-truncated.sql"
truncate -s 1048576 "$work/participant-truncated.sql"
docker run -d --name crv-corrupt-postgres -e POSTGRES_USER=cnadmin -e POSTGRES_PASSWORD=supersafe \
  --health-cmd='pg_isready -U cnadmin' --health-interval=1s --health-timeout=3s --health-retries=30 postgres:14 >/dev/null
wait_healthy crv-corrupt-postgres 60
docker exec crv-corrupt-postgres psql -U cnadmin -d postgres -c 'create database fixture' >/dev/null
set +e
output=$(docker exec -i crv-corrupt-postgres psql -v ON_ERROR_STOP=1 -U cnadmin -d fixture <"$work/participant-truncated.sql" 2>&1)
status=$?
set -e
printf '%s\n' "$output" | tail -4 | redact_ids
echo "restore_exit=$status"
[[ $status -ne 0 ]]

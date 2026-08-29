#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/bench.sh"

start_bench

echo '== databases and owners =='
docker exec postgres psql -U cnadmin -d postgres -Atc \
  "select datname || '|' || pg_get_userbyid(datdba) from pg_database where datistemplate = false order by datname"

echo '== postgres version =='
docker exec postgres psql -U cnadmin -d postgres -Atc 'show server_version'

echo '== logical dumps =='
/usr/bin/time -f 'validator elapsed=%e maxrss_kb=%M' \
  docker exec postgres pg_dump -U cnadmin validator-app-provider \
  >"$CRV_ARTIFACTS/validator-app-provider.sql"
/usr/bin/time -f 'participant elapsed=%e maxrss_kb=%M' \
  docker exec postgres pg_dump -U cnadmin participant-app-provider \
  >"$CRV_ARTIFACTS/participant-app-provider.sql"
/usr/bin/time -f 'validator-custom elapsed=%e maxrss_kb=%M' \
  docker exec postgres pg_dump -Fc -U cnadmin validator-app-provider \
  >"$CRV_ARTIFACTS/validator-app-provider.dump"
wc -c "$CRV_ARTIFACTS/validator-app-provider.sql" \
  "$CRV_ARTIFACTS/participant-app-provider.sql" \
  "$CRV_ARTIFACTS/validator-app-provider.dump"

echo '== plain header: no source DB or timestamp =='
sed -n '1,16p' "$CRV_ARTIFACTS/validator-app-provider.sql"

echo '== custom archive header =='
docker run --rm -i postgres:14 pg_restore -l <"$CRV_ARTIFACTS/validator-app-provider.dump" | sed -n '1,14p'

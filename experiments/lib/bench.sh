#!/usr/bin/env bash
set -euo pipefail

CRV_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
CRV_BENCH_ROOT=${CRV_BENCH_ROOT:-"$CRV_ROOT/.crv-bench"}
CRV_QUICKSTART="$CRV_BENCH_ROOT/cn-quickstart"
CRV_ARTIFACTS="$CRV_BENCH_ROOT/artifacts"
CRV_QUICKSTART_COMMIT=3c8ca2fe7e45fc692f089d57909944410fe0f61c
CRV_IMAGE_TAG=0.6.11
CRV_LOCALNET="$CRV_QUICKSTART/quickstart/docker/modules/localnet"

need() {
  command -v "$1" >/dev/null || { echo "missing required command: $1" >&2; exit 2; }
}

prepare_bench() {
  need docker
  need git
  need jq
  need rg
  need curl
  need openssl
  docker compose version >/dev/null
  mkdir -p "$CRV_BENCH_ROOT" "$CRV_ARTIFACTS"
  if [[ ! -d "$CRV_QUICKSTART/.git" ]]; then
    git clone https://github.com/digital-asset/cn-quickstart.git "$CRV_QUICKSTART"
  fi
  git -C "$CRV_QUICKSTART" checkout --detach "$CRV_QUICKSTART_COMMIT" >/dev/null
  cat >"$CRV_QUICKSTART/quickstart/.env.local" <<'EOF'
OBSERVABILITY_ENABLED=false
AUTH_MODE=shared-secret
PARTY_HINT=crv-bench-1
TEST_MODE=off
PQS_APP_USER_PROFILE=off
PQS_SV_PROFILE=off
EOF
}

compose_bench() {
  (
    cd "$CRV_QUICKSTART/quickstart"
    IMAGE_TAG="$CRV_IMAGE_TAG" DOCKER_NETWORK=crv-bench-net APP_USER_PROFILE=off \
      docker compose -p crv-bench \
      -f docker/modules/localnet/compose.yaml \
      -f docker/modules/localnet/resource-constraints.yaml \
      --env-file .env \
      --env-file .env.local \
      --env-file docker/modules/localnet/compose.env \
      --env-file docker/modules/localnet/env/common.env \
      --profile sv --profile app-provider "$@"
  )
}

wait_healthy() {
  local name=$1
  local attempts=${2:-240}
  local status
  for ((i=1; i<=attempts; i++)); do
    status=$(docker inspect "$name" --format '{{if .State.Health}}{{.State.Health.Status}}{{else if .State.Running}}running{{else}}stopped{{end}}' 2>/dev/null || true)
    [[ "$status" == healthy ]] && return 0
    sleep 5
  done
  docker logs "$name" 2>&1 | tail -100 >&2 || true
  echo "$name did not become healthy" >&2
  return 1
}

start_bench() {
  prepare_bench
  compose_bench up -d postgres canton splice
  wait_healthy postgres 60
  wait_healthy canton 240
  wait_healthy splice 240
}

stop_bench() {
  prepare_bench
  compose_bench down -v
}

b64url() {
  openssl base64 -A | tr '+/' '-_' | tr -d '='
}

localnet_token() {
  local subject=$1
  local audience=$2
  local header payload signature
  header=$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | b64url)
  payload=$(printf '{"sub":"%s","aud":"%s"}' "$subject" "$audience" | b64url)
  signature=$(printf '%s' "$header.$payload" | openssl dgst -sha256 -hmac unsafe -binary | b64url)
  printf '%s.%s.%s' "$header" "$payload" "$signature"
}

redact_ids() {
  sed -E \
    -e 's/(PAR|SEQ|MED)::[^" ]+/<canton-id>/g' \
    -e 's/[A-Za-z_][A-Za-z0-9_-]*::[0-9a-f]{20,}/<party-id>/g' \
    -e 's/[0-9a-f]{64,}/<digest>/g'
}

#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
work=$(mktemp -d)
drill_status=SKIPPED
bench_started=false

cleanup() {
  rm -rf -- "$work"
  if [[ "$bench_started" == true && -d .crv-bench/cn-quickstart/.git ]]; then
    ./experiments/stop.sh >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

run_fixture() {
  local fixture=$1
  local expected_exit=$2
  local expected_verdict=$3
  local report=$4
  set +e
  node dist/cli.js verify "$fixture" --json >"$report"
  local status=$?
  set -e
  if [[ "$status" -ne "$expected_exit" ]]; then
    echo "$fixture: expected exit $expected_exit, received $status" >&2
    exit 1
  fi
  local verdict
  verdict=$(node -e 'const fs=require("fs"); console.log(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).preconditions.verdict)' "$report")
  if [[ "$verdict" != "$expected_verdict" ]]; then
    echo "$fixture: expected $expected_verdict, received $verdict" >&2
    exit 1
  fi
  printf '%-30s %s (exit %s)\n' "$fixture" "$verdict" "$status"
}

npm ci
npm run build
npm test
./experiments/10-cli-failure-contracts.sh
node experiments/render-release-notes.mjs --check

run_fixture test/fixtures/good 3 INDETERMINATE "$work/good.json"
run_fixture test/fixtures/reversed 2 FAILED "$work/reversed.json"

if command -v docker >/dev/null 2>&1 \
  && docker info >/dev/null 2>&1 \
  && docker compose version >/dev/null 2>&1; then
  bench_started=true
  CRV_IMAGE_TAG="${CRV_REVIEWER_SPLICE_VERSION:-0.7.5}" ./experiments/08-cli-drill.sh
  drill_status="RAN (${CRV_REVIEWER_SPLICE_VERSION:-0.7.5})"
fi

printf '\n%-28s %s\n' 'Step' 'Status'
printf '%-28s %s\n' 'npm ci/build/test' 'PASSED'
printf '%-28s %s\n' 'CLI failure contracts' 'PASSED'
printf '%-28s %s\n' 'good fixture verify' 'INDETERMINATE (exit 3)'
printf '%-28s %s\n' 'reversed fixture verify' 'FAILED (exit 2)'
printf '%-28s %s\n' 'release notes generation' 'PASSED'
printf '%-28s %s\n' 'LocalNet isolated drill' "$drill_status"

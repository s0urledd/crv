#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
npm run build >/dev/null
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT

expect() {
  local expected_status=$1
  local expected_text=$2
  shift 2
  set +e
  "$@" >"$work/output" 2>&1
  local status=$?
  set -e
  if [[ "$status" -ne "$expected_status" ]]; then
    cat "$work/output" >&2
    echo "expected exit $expected_status, received $status: $*" >&2
    exit 1
  fi
  if ! grep -F -- "$expected_text" "$work/output" >/dev/null; then
    cat "$work/output" >&2
    echo "missing expected text: $expected_text" >&2
    exit 1
  fi
}

synthetic_id="PAR::synthetic-validator::1220$(printf 'd%.0s' {1..64})"
write_identities() {
  jq -n --arg id "$synthetic_id" --arg version "$1" '{
    id: $id,
    version: $version,
    authorizedStoreSnapshot: "Ag==",
    keys: ["namespace", "signing", "encryption"] | map({name: ., keyPair: "AQ=="})
  }' >"$2"
}

expect 2 "Validator offset 66 exceeds participant ledger end 65." \
  node dist/cli.js verify test/fixtures/reversed

mkdir "$work/identities-only"
write_identities "0.6.11" "$work/identities-only/identities.json"
expect 3 "Recovery preconditions: INDETERMINATE" \
  node dist/cli.js verify "$work/identities-only"

mkdir "$work/half-pair"
cp test/fixtures/good/participant.sql "$work/half-pair/participant.sql"
write_identities "0.6.11" "$work/half-pair/identities.json"
expect 3 "An identities fallback artifact is present; database artifacts are present but do not form a complete pair." \
  node dist/cli.js verify "$work/half-pair"

cp -R test/fixtures/good "$work/corrupt-side"
printf '\x1f\x8b\x08\x00\x01' >"$work/corrupt-side/truncated.sql.gz"
expect 3 "could not be inspected:" \
  node dist/cli.js verify "$work/corrupt-side"

cp -R test/fixtures/good "$work/version-conflict"
write_identities "0.5.18" "$work/version-conflict/identities.json"
node dist/cli.js manifest "$work/version-conflict" >/dev/null
jq '.declared.spliceVersion = "0.6.11"' "$work/version-conflict/crv-manifest.json" >"$work/manifest.next"
mv "$work/manifest.next" "$work/version-conflict/crv-manifest.json"
expect 65 "0.5.18 (artifact:identities.json), 0.6.11 (manifest.declared.spliceVersion)" \
  node dist/cli.js drill "$work/version-conflict"

expect 65 "input path is not accessible: $work/not-present" \
  node dist/cli.js verify "$work/not-present"
expect 65 "crv inspect takes a file; use crv verify for a directory: $work" \
  node dist/cli.js inspect "$work"

echo "CLI failure contracts passed"

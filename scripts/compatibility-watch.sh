#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
command -v curl >/dev/null
command -v git >/dev/null
command -v jq >/dev/null
command -v sha256sum >/dev/null

npm run build >/dev/null
newest=$(git ls-remote --tags --refs https://github.com/hyperledger-labs/splice.git |
  awk -F/ '{print $3}' |
  grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' |
  sort -V |
  tail -1)
if [[ ! "$newest" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "could not select the newest Splice release tag" >&2
  exit 2
fi
echo "newest Splice tag seen: $newest"
latest=${1:-$newest}
if [[ ! "$latest" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "requested version is not an exact Splice release tag: $latest" >&2
  exit 2
fi
recorded=false
if jq -e --arg version "$latest" '.runtime.drillEvidence[$version] != null' compatibility.json >/dev/null; then
  recorded=true
fi

schema_path="apps/common/src/main/resources/db/migration/canton-network/postgres/stable/V001__create_schema.sql"
schema_url="https://raw.githubusercontent.com/hyperledger-labs/splice/$latest/$schema_path"
schema_file=$(mktemp)
if ! curl -fsSL "$schema_url" >"$schema_file"; then
  rm -f -- "$schema_file"
  node dist/compatibility-watch-cli.js "$latest" "$schema_path" unfetchable
  exit $?
fi
schema_hash=$(sha256sum "$schema_file" | awk '{print $1}')
rm -f -- "$schema_file"
node dist/compatibility-watch-cli.js "$latest" "$schema_path" "$schema_hash"
report=${CRV_DRILL_REPORT_PATH:-}
temporary_report=false
if [[ -z "$report" ]]; then
  report=$(mktemp)
  temporary_report=true
fi
cleanup() {
  if [[ "$temporary_report" == true ]]; then rm -f -- "$report"; fi
}
trap cleanup EXIT

CRV_IMAGE_TAG="$latest" CRV_DRILL_REPORT_PATH="$report" ./scripts/drill-bench.sh
status=$(jq -r '.structuralRestore.status' "$report")
d2_status=$(jq -r '[.checks[] | select(.id == "backup.offset_order")][0].status // "MISSING"' "$report")
if [[ "$d2_status" != PASS ]]; then
  echo "Splice $latest did not produce PASS for the recognized D2 schema family; received $d2_status" >&2
  exit 1
fi
expected_status=PASSED_UNVERIFIED_VERSION
if [[ "$recorded" == true ]]; then expected_status=PASSED; fi
if [[ "$status" != "$expected_status" ]]; then
  echo "expected $expected_status for Splice $latest; received $status" >&2
  exit 1
fi
participant_image=$(jq -r '.structuralRestore.runtime.participantImage // empty' "$report")
if [[ ! "$participant_image" =~ @sha256:[0-9a-f]{64}$ ]]; then
  echo "drill did not report an immutable participant image" >&2
  exit 1
fi
if [[ "$recorded" == true ]]; then
  echo "revalidated recorded drill compatibility for Splice $latest"
  exit 0
fi

tested_at=$(date -u +%F)
evidence=${CRV_COMPAT_EVIDENCE_URL:-local:scripts/compatibility-watch.sh}
postgres_major=$(jq -r '.runtime.postgresMajor' compatibility.json)
jq --arg version "$latest" --arg image "$participant_image" --arg tested_at "$tested_at" \
  --arg evidence "$evidence" --argjson postgres_major "$postgres_major" \
  '.runtime.drillEvidence[$version] = {
     participantImage: $image,
     postgresMajor: $postgres_major,
     testedAt: $tested_at,
     evidence: $evidence
   }' compatibility.json > compatibility.json.next
mv compatibility.json.next compatibility.json
echo "recorded drill compatibility for Splice $latest"

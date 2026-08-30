#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
command -v curl >/dev/null
command -v git >/dev/null
command -v jq >/dev/null
command -v sha256sum >/dev/null

latest=${1:-}
if [[ -z "$latest" ]]; then
  latest=$(git ls-remote --tags --refs https://github.com/canton-network/splice.git 'refs/tags/0.6.*' |
    awk -F/ '{print $3}' |
    grep -E '^0\.6\.[0-9]+$' |
    sort -V |
    tail -1)
fi
if [[ ! "$latest" =~ ^0\.6\.[0-9]+$ ]]; then
  echo "could not select one 0.6.x Splice tag" >&2
  exit 2
fi
recorded=false
if jq -e --arg version "$latest" '.runtime.drillEvidence[$version] != null' compatibility.json >/dev/null; then
  recorded=true
fi

schema_url="https://raw.githubusercontent.com/canton-network/splice/$latest/apps/common/src/main/resources/db/migration/canton-network/postgres/stable/V001__create_schema.sql"
schema_hash=$(curl -fsSL "$schema_url" | sha256sum | awk '{print $1}')
if ! jq -e --arg hash "$schema_hash" '.schemaFamilies | any(.sourceDefinitionSha256 == $hash)' compatibility.json >/dev/null; then
  echo "Splice $latest has an unrecognized V001 schema definition hash: $schema_hash" >&2
  exit 1
fi

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

CRV_IMAGE_TAG="$latest" CRV_DRILL_REPORT_PATH="$report" ./experiments/08-cli-drill.sh
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
evidence=${CRV_COMPAT_EVIDENCE_URL:-local:experiments/09-compatibility-watch.sh}
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

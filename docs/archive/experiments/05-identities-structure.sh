#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/../../../scripts/lib/bench.sh"

start_bench
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
token=$(localnet_token ledger-api-user https://canton.network.global)
curl -fsS http://127.0.0.1:3903/api/validator/v0/admin/participant/identities \
  -H "authorization: Bearer $token" >"$work/identities.json"

jq -e '
  type == "object" and
  (.version | type == "string") and
  (.id | type == "string" and startswith("PAR::")) and
  (.keys | type == "array" and length > 0) and
  (all(.keys[]; (.name | type == "string") and (.keyPair | type == "string"))) and
  (.authorizedStoreSnapshot | type == "string")
' "$work/identities.json" >/dev/null
jq -r '"top_level_keys=" + (keys | sort | join(",")), "key_count=" + (.keys|length|tostring), "version=" + .version' "$work/identities.json"
echo "snapshot_base64_decodes=$(jq -r .authorizedStoreSnapshot "$work/identities.json" | base64 -d >/dev/null 2>&1 && echo true || echo false)"
echo "keypairs_base64_decode=$(jq -r '.keys[].keyPair' "$work/identities.json" | while read -r value; do printf '%s' "$value" | base64 -d >/dev/null || exit 1; done && echo true || echo false)"
echo "party_hint_present=$(jq 'has("partyHint") or has("party_hint")' "$work/identities.json")"
echo 'conclusion=offline validation is structural; re-onboarding and party-hint equality require external evidence or a fresh participant workflow'

#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/bench.sh"

start_bench
work=$(mktemp -d)
temporary_report=
cleanup() {
  [[ -z "$temporary_report" ]] || rm -f -- "$temporary_report"
  rm -rf -- "$work"
}
trap cleanup EXIT

docker exec postgres pg_dump -U cnadmin participant-app-provider >"$work/participant.sql"
docker exec postgres pg_dump -U cnadmin validator-app-provider >"$work/validator.sql"
token=$(localnet_token ledger-api-user https://canton.network.global)
curl -fsS http://127.0.0.1:3903/api/validator/v0/admin/participant/identities \
  -H "authorization: Bearer $token" >"$work/identities.json"

npm run build >/dev/null
sha256sum "$work"/*.sql "$work/identities.json" >"$work/before.sha256"
node dist/cli.js manifest "$work" >/dev/null
expected=$(jq -r .id "$work/identities.json")
jq --arg expected "$expected" --arg splice_version "$CRV_IMAGE_TAG" \
  '.declared.spliceVersion=$splice_version
   | .declared.participantDatabase="participant-app-provider"
   | .declared.validatorDatabase="validator-app-provider"
   | .declared.expectedParticipantId=$expected' \
  "$work/crv-manifest.json" >"$work/crv-manifest.next"
mv "$work/crv-manifest.next" "$work/crv-manifest.json"

if [[ -n "${CRV_DRILL_REPORT_PATH:-}" ]]; then
  report=$CRV_DRILL_REPORT_PATH
else
  temporary_report=$(mktemp)
  report=$temporary_report
fi
set +e
node dist/cli.js drill "$work" --json >"$report"
status=$?
set -e
if [[ "$status" -ne 3 ]]; then
  echo "expected INDETERMINATE precondition exit 3 after a PASSED structural drill; received $status" >&2
  exit 1
fi
node --input-type=module -e 'import { readFileSync } from "node:fs"; import { formatReport } from "./dist/report/human.js"; console.log(formatReport(JSON.parse(readFileSync(process.argv[1], "utf8"))))' "$report"
for phase in imagePull postgresStartup sqlRestore participantStartup total; do
  jq -e --arg prefix "timing.${phase}Ms=" 'any(.structuralRestore.details[]; startswith($prefix) and (ltrimstr($prefix) | test("^[0-9]+$")))' "$report" >/dev/null
done

sha256sum -c "$work/before.sha256" >/dev/null
leftovers=$(docker ps -a --filter 'label=crv.run' --format '{{.Names}}')
leftovers+=$(docker network ls --filter 'label=crv.run' --format '{{.Name}}')
leftovers+=$(docker volume ls --filter 'label=crv.run' --format '{{.Name}}')
[[ -z "$leftovers" ]]
printf '%s\n' 'cleanup_inventory=empty'

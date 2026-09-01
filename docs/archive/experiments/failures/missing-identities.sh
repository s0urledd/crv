#!/usr/bin/env bash
set -euo pipefail
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
expected="$work/identities.json"
if [[ ! -f "$expected" ]]; then
  echo "IDENTITIES_FILE_MISSING: required recovery path is absent: identities.json"
  echo "result=failed_precondition"
  exit 0
fi
exit 1

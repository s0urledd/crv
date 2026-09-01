#!/usr/bin/env bash
set -euo pipefail

# This models timestamp comparison only. It does not model network pruning.
captured_epoch=$(date -u -d '31 days ago' +%s)
verified_epoch=$(date -u +%s)
declared_horizon_seconds=$((30*24*60*60))
age_seconds=$((verified_epoch-captured_epoch))
echo 'simulation=true'
echo "age_seconds=$age_seconds"
echo "declared_horizon_seconds=$declared_horizon_seconds"
if (( age_seconds >= declared_horizon_seconds )); then
  echo 'result=failed_precondition'
else
  echo 'result=passed'
  exit 1
fi

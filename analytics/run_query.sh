#!/usr/bin/env bash
# Run a .sql file in Athena (workgroup oil-gas-wg / db oil_gas_db),
# poll every 2s until done, download the result CSV to /tmp/, and
# pretty-print it with `column -t -s,`. Used by `make athena-test`.

set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: $0 <path/to/query.sql>" >&2
  exit 2
fi

SQL_FILE="$1"
if [ ! -f "$SQL_FILE" ]; then
  echo "error: $SQL_FILE not found" >&2
  exit 2
fi

AWS_REGION="${AWS_REGION:-us-east-1}"
WORKGROUP="oil-gas-wg"
DATABASE="oil_gas_db"

QUERY_TEXT="$(cat "$SQL_FILE")"

start_ts=$(date +%s)
QUERY_ID=$(aws athena start-query-execution \
  --query-string "$QUERY_TEXT" \
  --query-execution-context "Database=$DATABASE" \
  --work-group "$WORKGROUP" \
  --region "$AWS_REGION" \
  --output text --query 'QueryExecutionId')

while :; do
  state=$(aws athena get-query-execution \
    --query-execution-id "$QUERY_ID" \
    --region "$AWS_REGION" \
    --output text --query 'QueryExecution.Status.State')
  case "$state" in
    SUCCEEDED) break ;;
    FAILED|CANCELLED)
      reason=$(aws athena get-query-execution \
        --query-execution-id "$QUERY_ID" \
        --region "$AWS_REGION" \
        --output text --query 'QueryExecution.Status.StateChangeReason' 2>/dev/null \
        || echo "(no reason returned)")
      echo "!! query $state: $reason" >&2
      exit 1
      ;;
  esac
  sleep 2
done

end_ts=$(date +%s)
elapsed=$((end_ts - start_ts))

OUT_LOC=$(aws athena get-query-execution \
  --query-execution-id "$QUERY_ID" \
  --region "$AWS_REGION" \
  --output text --query 'QueryExecution.ResultConfiguration.OutputLocation')

CSV_LOCAL="/tmp/${QUERY_ID}.csv"
aws s3 cp "$OUT_LOC" "$CSV_LOCAL" --region "$AWS_REGION" --only-show-errors

echo "  query_id=$QUERY_ID  elapsed=${elapsed}s  csv=$CSV_LOCAL"
echo ""
column -t -s, "$CSV_LOCAL"

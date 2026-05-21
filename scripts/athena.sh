#!/usr/bin/env bash
# Uso: ./scripts/athena.sh "SELECT ..."
# Dispara una query en Athena, espera a que termine, e imprime el resultado.
set -euo pipefail

QUERY="$1"
REGION="us-east-1"
WG="oil-gas-wg"

QID=$(aws athena start-query-execution \
  --query-string "$QUERY" \
  --work-group "$WG" \
  --region "$REGION" \
  --query 'QueryExecutionId' --output text)

echo ">> query $QID lanzada, esperando..." >&2

while true; do
  STATE=$(aws athena get-query-execution \
    --query-execution-id "$QID" \
    --region "$REGION" \
    --query 'QueryExecution.Status.State' --output text)
  case "$STATE" in
    SUCCEEDED) break ;;
    FAILED|CANCELLED)
      echo ">> query $STATE" >&2
      aws athena get-query-execution --query-execution-id "$QID" \
        --region "$REGION" \
        --query 'QueryExecution.Status.StateChangeReason' --output text >&2
      exit 1 ;;
    *) sleep 1 ;;
  esac
done

aws athena get-query-results \
  --query-execution-id "$QID" \
  --region "$REGION" \
  --query 'ResultSet.Rows[].Data[].VarCharValue' \
  --output text

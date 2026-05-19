# Vaca Muerta lab — automation targets.
# Run `make help` (default) for descriptions.

SHELL       := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c

AWS_PROFILE ?= oil-gas-dev
AWS_REGION  ?= us-east-1
S3_BUCKET   ?= vaca-muerta-raw-919064997947

export AWS_PROFILE AWS_REGION

.DEFAULT_GOAL := help

.PHONY: help sim-smoke sim-full sim-upload sim-clean-local sim-clean-s3 \
        crawl athena-test tf-plan tf-apply all

help:  ## Show this help.
	@echo "Vaca Muerta lab targets:"
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "} {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ──────────────────────────────────────────────────────────────────────
# Simulator
# ──────────────────────────────────────────────────────────────────────

# Smoke-run the simulator with stock defaults (30d/5min).
sim-smoke:  ## Run simulator with defaults (30d/5min, smoke).
	@echo ">> sim-smoke: simulator with defaults (30d/5min)"
	cd simulator && uv run python -m src.simulator

# Full deterministic 180d/1min run anchored to the canonical S3 window
# (2025-11-20 → 2026-05-19), with SACADA + gas-lock injects baked in so
# `make all` is idempotent.
sim-full:  ## Full 180d/1min run with SACADA + gas-lock injects.
	@echo ">> sim-full: 180d/1min from 2025-11-20 with SACADA + gas-lock"
	cd simulator && uv run python -m src.simulator \
	  --days 180 --freq 1 --start 2025-11-20T00:00:00 \
	  --inject-sacada 2026-03-15T14:00:00 \
	  --sacada-reason FIRE_GAS_HIGH --sacada-duration-h 6 \
	  --inject-gas-lock LLL-002:2026-04-10T08:00:00

# Sync the three local layers to S3 in parallel. Fails the target if any
# of the three syncs returns non-zero.
sim-upload:  ## Sync wells/plant/utilities to S3 in parallel.
	@echo ">> sim-upload: parallel sync to s3://$(S3_BUCKET)/"
	@set -e; \
	pids=(); \
	for layer in wells plant utilities; do \
	  echo "  -> syncing $$layer"; \
	  aws s3 sync simulator/data/raw/$$layer/ s3://$(S3_BUCKET)/$$layer/ \
	    --region $(AWS_REGION) --only-show-errors & \
	  pids+=($$!); \
	done; \
	rc=0; \
	for pid in "$${pids[@]}"; do wait $$pid || rc=$$?; done; \
	[ $$rc -eq 0 ] || { echo "!! one or more syncs failed"; exit $$rc; }; \
	echo "OK: all 3 layers synced"

# Delete the local parquet output for the three layers.
sim-clean-local:  ## Remove local simulator/data/raw/{wells,plant,utilities}.
	@echo ">> sim-clean-local: removing local raw output"
	rm -rf simulator/data/raw/wells simulator/data/raw/plant simulator/data/raw/utilities

# Delete the three layers from S3 (with confirmation prompt).
sim-clean-s3:  ## Recursively delete wells/plant/utilities prefixes in S3 (prompts).
	@echo ">> sim-clean-s3: about to delete s3://$(S3_BUCKET)/{wells,plant,utilities}/"
	@read -p "Are you sure? [y/N] " ans; \
	case "$$ans" in \
	  y|Y) for layer in wells plant utilities; do \
	         echo "  -> aws s3 rm --recursive s3://$(S3_BUCKET)/$$layer/"; \
	         aws s3 rm --recursive "s3://$(S3_BUCKET)/$$layer/" --region $(AWS_REGION); \
	       done ;; \
	  *) echo "aborted"; exit 1 ;; \
	esac

# ──────────────────────────────────────────────────────────────────────
# Athena / Glue
# ──────────────────────────────────────────────────────────────────────

# Start the Glue crawler, poll every 15s until READY (max 30 min),
# then list the three tables with column counts.
crawl:  ## Start vaca-muerta-crawler, wait until READY, list tables.
	@echo ">> crawl: starting vaca-muerta-crawler"
	@set -e; \
	aws glue start-crawler --name vaca-muerta-crawler --region $(AWS_REGION) >/dev/null 2>&1 || true; \
	start_ts=$$(date +%s); \
	timeout=1800; \
	while :; do \
	  state=$$(aws glue get-crawler --name vaca-muerta-crawler --region $(AWS_REGION) \
	            --query 'Crawler.State' --output text); \
	  now=$$(date +%s); elapsed=$$((now - start_ts)); \
	  echo "  crawler state: $$state  (elapsed $${elapsed}s)"; \
	  case "$$state" in \
	    READY)  break ;; \
	    FAILED) echo "!! crawler FAILED"; exit 1 ;; \
	  esac; \
	  if [ $$elapsed -ge $$timeout ]; then \
	    echo "!! crawler did not reach READY within $${timeout}s"; exit 1; \
	  fi; \
	  sleep 15; \
	done; \
	echo ">> crawler READY — listing tables:"; \
	for t in wells plant utilities; do \
	  cols=$$(aws glue get-table --database-name oil_gas_db --name $$t \
	          --region $(AWS_REGION) \
	          --query 'length(Table.StorageDescriptor.Columns)' --output text 2>/dev/null \
	          || echo "?"); \
	  echo "  $$t: $$cols columns"; \
	done

# Run all five analytics queries in order via run_query.sh.
athena-test:  ## Run analytics/queries/*.sql in order against Athena.
	@echo ">> athena-test: running 5 analytics queries"
	@set -e; \
	for q in analytics/queries/01_overview.sql \
	         analytics/queries/02_sacada_timeline.sql \
	         analytics/queries/03_flare_during_sacada.sql \
	         analytics/queries/04_nag602_compliance.sql \
	         analytics/queries/05_well_lifecycle.sql; do \
	  echo ""; \
	  echo "================================================================"; \
	  echo "  $$q"; \
	  echo "================================================================"; \
	  analytics/run_query.sh "$$q"; \
	done

# ──────────────────────────────────────────────────────────────────────
# Terraform
# ──────────────────────────────────────────────────────────────────────

tf-plan:  ## terraform plan against the real AWS account.
	@echo ">> tf-plan: infra/aws"
	cd infra/aws && terraform plan

# -refresh=false works around a known QuickSight permissions bug: reading
# refresh properties on aws_quicksight_data_set requires the action
# quicksight:DescribeDataSetRefreshProperties, which is NOT honored by the
# quicksight:* wildcard and cannot be granted to a non-admin IAM user.
# See .github/ISSUE_TEMPLATE/quicksight_bug.md for the verbatim error.
tf-apply:  ## terraform apply (with -refresh=false QS workaround).
	@echo ">> tf-apply: infra/aws (with -refresh=false QS workaround)"
	cd infra/aws && terraform apply -refresh=false -auto-approve

# ──────────────────────────────────────────────────────────────────────
# End-to-end
# ──────────────────────────────────────────────────────────────────────

all: sim-clean-local sim-full sim-upload crawl athena-test  ## End-to-end: clean → generate → upload → crawl → query.
	@echo ">> all: pipeline complete"

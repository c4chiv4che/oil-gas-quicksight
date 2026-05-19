# Architecture

## Overview

The Vaca Muerta QuickSight lab is a self-contained data platform prototype
for unconventional shale operations. A Python simulator produces three
layers of synthetic SCADA data (wells, processing plant, utilities) as
date-partitioned Parquet, lands it in S3, and exposes it to Athena via a
Glue Data Catalog crawler. QuickSight reads from Athena to build dashboards.
Real Vaca Muerta physics, ISA 5.1 tag naming, and ENARGAS NAG-602 fiscal
gas specs drive the data — see `docs/SIMULATOR_SPEC.md`.

## Data flow

```
 ┌──────────────────────────────────────────────────────────────────┐
 │                       simulator/ (Python, uv)                     │
 │                                                                   │
 │   ┌─────────────┐    ┌─────────────┐    ┌──────────────────┐      │
 │   │  Layer 1    │    │  Layer 2    │    │  Layer 3         │      │
 │   │  wells      │──▶│  plant      │──▶│  utilities       │      │
 │   │  LLL-001..4 │    │  sep/TEG/   │    │  hot oil / flare │      │
 │   │  ESP+frac   │    │  LTS/comp.  │    │  inst. air       │      │
 │   └──────┬──────┘    └──────┬──────┘    └────────┬─────────┘      │
 │          │                  │                    │                │
 │          ▼                  ▼                    ▼                │
 │   Parquet (partitioned by pad=PAD-LLL-01 / date=YYYY-MM-DD)       │
 └──────────────────────────────────────────────────────────────────┘
                              │
                              │  aws s3 sync (parallel, all 3 layers)
                              ▼
 ┌──────────────────────────────────────────────────────────────────┐
 │  S3:  s3://vaca-muerta-raw-919064997947/{wells,plant,utilities}/ │
 └──────────────────────────────────────────────────────────────────┘
                              │
                              │  vaca-muerta-crawler (Glue)
                              ▼
 ┌──────────────────────────────────────────────────────────────────┐
 │  Glue Data Catalog:  oil_gas_db.{wells, plant, utilities}        │
 └──────────────────────────────────────────────────────────────────┘
                              │
                              │  Athena workgroup oil-gas-wg
                              ▼
 ┌──────────────────────────────────────────────────────────────────┐
 │  QuickSight (Standard edition, SPICE)                             │
 │    datasource: Athena (oil-gas)                                   │
 │    dataset:    wells (SPICE, manual refresh)                      │
 └──────────────────────────────────────────────────────────────────┘
```

## AWS resources currently deployed

Managed by Terraform under `infra/aws/`.

| Kind | Name | Purpose |
|---|---|---|
| S3 bucket | `vaca-muerta-raw-919064997947` | Raw Parquet from the simulator (versioned). |
| S3 bucket | `vaca-muerta-curated-919064997947` | Reserved for downstream curated outputs. |
| S3 bucket | `vaca-muerta-athena-results-919064997947` | Athena query result location. |
| IAM role | `oil-gas-glue-role` | Glue crawler execution role (S3 read/write + AWSGlueServiceRole). |
| Glue DB | `oil_gas_db` | Catalog database for the three layers. |
| Glue crawler | `vaca-muerta-crawler` | Crawls `s3://…/wells/`, `…/plant/`, `…/utilities/`. |
| Athena WG | `oil-gas-wg` | Enforced workgroup; results land in athena-results bucket. |
| IAM policy | `oil-gas-quicksight-author` | QuickSight + Athena + Glue read scope for the `oil-gas-dev` IAM user. |
| QuickSight user | `oil-gas-dev` (AUTHOR) | IAM-identity-type author in the `default` namespace. |
| QuickSight datasource | `athena-oil-gas` | ATHENA type, pointed at `oil-gas-wg`. |
| QuickSight dataset | `wells` (SPICE) | Subset of columns from `oil_gas_db.wells`, typed for QS. |

## Known issues

### QuickSight `DescribeDataSetRefreshProperties` permissions bug

`terraform apply` fails on any `aws_quicksight_data_set` resource with a 403
on `quicksight:DescribeDataSetRefreshProperties`, even when the IAM user is
granted `quicksight:*` (or the action listed explicitly) in an inline
policy. The action is **not honored by the `quicksight:*` wildcard** and
cannot be granted to a non-admin IAM user through any policy variant we
have tried.

**Workaround:** run `terraform apply -refresh=false -auto-approve`. This is
baked into the `tf-apply` Make target. Full verbatim error and
documentation lives in `.github/ISSUE_TEMPLATE/quicksight_bug.md`.

## Future work

- **Timestream**: Terraform stubs are commented out in `infra/aws/main.tf`.
  Pending AWS support for the account region / quota before enabling.
- **QuickSight v2 dashboards**: build cross-layer dashboards once the
  `plant` and `utilities` SPICE datasets are added alongside `wells`
  (3-layer SACADA timeline, NAG-602 compliance panel, flare/hot-oil
  cross-layer view).
- **LocalStack parity**: keep `infra/localstack/` in sync as a free
  iteration path for non-QuickSight changes (QS has no LocalStack emulator).

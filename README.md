# Vaca Muerta SCADA Simulator → AWS Analytics Pipeline

[![Python Tests](https://github.com/c4chiv4che/oil-gas-quicksight/actions/workflows/python-tests.yml/badge.svg)](https://github.com/c4chiv4che/oil-gas-quicksight/actions/workflows/python-tests.yml)
[![Terraform](https://github.com/c4chiv4che/oil-gas-quicksight/actions/workflows/terraform.yml/badge.svg)](https://github.com/c4chiv4che/oil-gas-quicksight/actions/workflows/terraform.yml)
![Coverage](https://img.shields.io/badge/coverage-93%25-brightgreen)
![Python](https://img.shields.io/badge/python-3.12-blue)
![Terraform](https://img.shields.io/badge/terraform-1.5%2B-7B42BC)
![AWS](https://img.shields.io/badge/AWS-S3%20%7C%20Glue%20%7C%20Athena%20%7C%20QuickSight-FF9900)
![License](https://img.shields.io/badge/license-MIT-green)

End-to-end data engineering project that simulates a realistic Vaca Muerta shale operation (wellpad + gas processing plant + utilities) and lands the data in AWS for analysis with Athena and QuickSight.

Built as a learning project to combine 15+ years of OT/industrial automation background with modern cloud data tooling.

---

## What this does

A multi-layer SCADA-style simulator generates ~1.5M signal records over 180 days for:

- **4 horizontal shale wells** with ESP lift, multi-stage frac, Arps decline curves, and lifecycle phases (IDLE → FLOWBACK → PRODUCING → DECLINE)
- **A full gas processing plant**: slug catcher → 3-phase separator → TEG dehydration → LTS/propane refrigeration → condensate stabilizer → centrifugal compression → fiscal metering
- **Utilities**: hot oil heater, instrument air, flare system with HP/LP/wet sections

Signals follow **ISA 5.1 tag naming** (PT, TT, FT, LT, VT, AI, etc.) and the gas quality output is benchmarked against **ENARGAS NAG-602** — the Argentinian norm for natural gas pipeline transport (PCS, Wobbe Index, H2S, water content, hydrocarbon dew point).

A full **ESD (Emergency Shutdown) state machine** simulates 8-step plant trip sequences with realistic timing: depressurization to flare → compressor trip → utilities down → hold → recovery.

Data lands in S3 (Parquet, date-partitioned), gets crawled into Glue, and is queryable via Athena. QuickSight datasets are wired but the v2 multi-layer dashboard is pending.

---

## Architecture

```mermaid
flowchart TB
    subgraph SIM["🐍 SIMULATOR (Python + Typer CLI)"]
        direction LR
        W["wells.py<br/>32 cols<br/>4 wells × 1-min"]
        P["plant.py<br/>60 cols<br/>8 unit sections"]
        U["utilities.py<br/>20 cols<br/>hot oil + IA + flare"]
        W -.->|flow-weighted<br/>composition| P
        P -.->|plant state| U
    end

    SIM ==>|"Parquet<br/>date-partitioned"| SYNC["aws s3 sync<br/>(3 layers in parallel)"]

    subgraph AWS["☁️ AWS"]
        direction TB
        S3["S3 (raw)<br/>vaca-muerta-raw-*"]
        GC["Glue Crawler<br/>vaca-muerta-crawler"]
        CAT["Glue Catalog<br/>oil_gas_db<br/>(3 tables)"]
        AT["Athena<br/>workgroup: oil-gas-wg"]
        QS["QuickSight<br/>Standard Edition"]

        S3 --> GC
        GC --> CAT
        CAT --> AT
        AT --> QS
    end

    SYNC ==> S3

    classDef sim fill:#1e3a5f,stroke:#4a9eff,color:#fff
    classDef aws fill:#3d2817,stroke:#ff9900,color:#fff
    class W,P,U sim
    class S3,GC,CAT,AT,QS aws
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for full details.

---

## Quickstart

### Prerequisites

- WSL2 / Linux / macOS
- Python 3.12+ with [`uv`](https://docs.astral.sh/uv/)
- Docker (for LocalStack development)
- AWS CLI v2 + Terraform 1.5+
- An AWS account (sandbox/learning OK — total cost runs <$1/month with QuickSight Standard already active)

### Clone and inspect

```bash
git clone https://github.com/c4chiv4che/oil-gas-quicksight.git
cd oil-gas-quicksight
make help
```

### Run the simulator locally (no AWS)

```bash
# Quick 30-day smoke test (~5 seconds)
make sim-smoke

# Full 180-day run with injected ESD event and gas-lock (~60 seconds)
make sim-full
```

Outputs land in `simulator/data/raw/{wells,plant,utilities}/` as Parquet files partitioned by date.

### Deploy to AWS (full pipeline)

```bash
# 1. Configure AWS profile
aws configure --profile oil-gas-dev

# 2. Deploy infrastructure (one-time)
cd infra/aws
terraform init
terraform apply

# 3. Generate, upload, crawl, query — end-to-end
cd ../..
make all
```

`make all` executes: clean local → generate 180d → upload to S3 → trigger Glue Crawler → run 5 validation queries.

---

## Make targets

| Target            | Description                                                       |
|-------------------|-------------------------------------------------------------------|
| `make help`       | Show all targets (default)                                        |
| `make sim-smoke`  | 30-day / 5-min simulation (smoke test, ~5s)                       |
| `make sim-full`   | 180-day / 1-min simulation with injected ESD + gas-lock (~60s)    |
| `make sim-upload` | Sync all 3 layers to S3 in parallel                               |
| `make crawl`      | Trigger Glue Crawler, wait until ready, list tables               |
| `make athena-test`| Run all 5 validation queries against Athena                       |
| `make tf-plan`    | Terraform plan on AWS infra                                       |
| `make tf-apply`   | Terraform apply with `-refresh=false` (see Known Issues)          |
| `make all`        | Full pipeline: clean → simulate → upload → crawl → query          |
| `make sim-clean-local` | Remove local Parquet output                                  |
| `make sim-clean-s3`    | Delete S3 data (prompts for confirmation)                    |

---

## Project structure

```text
.
├── simulator/                      # The simulator itself (uv-managed)
│   ├── pyproject.toml
│   └── src/
│       ├── config.py               # Pad/well/signal constants, S3 buckets
│       ├── physics.py              # Arps decline, GOR creep, hydrate curves, anti-surge
│       ├── quality.py              # GasComposition, PCS/Wobbe/density, TEG, LTS
│       ├── events.py               # WellEvent/PlantEvent/ESDReason enums, ESD state machine
│       ├── wells.py                # Layer 1: 4 wells with state machines
│       ├── plant.py                # Layer 2: 8 plant unit sections
│       ├── utilities.py            # Layer 3: hot oil + IA + flare
│       ├── output.py               # Parquet writes + S3 upload + Rich summary
│       ├── cli.py                  # Typer CLI
│       └── simulator.py            # Main entry point
├── infra/
│   ├── localstack/                 # Local AWS for dev/testing (S3 only)
│   └── aws/                        # Production AWS (S3, Glue, Athena, QuickSight, IAM)
├── analytics/
│   ├── queries/                    # 5 versioned Athena SQL queries
│   └── run_query.sh                # Athena runner with CSV output
├── docs/
│   ├── SIMULATOR_SPEC.md           # Full domain spec (IAPG/ITP Neuquén/NAG-602)
│   └── ARCHITECTURE.md             # Architecture details + known issues
├── .github/
│   ├── workflows/                  # CI: terraform fmt + validate on PRs
│   └── ISSUE_TEMPLATE/             # Bug report templates
└── Makefile
```

---

## Domain sources

This is not a toy simulator. The signal ranges, equipment behavior, and ESD sequence are calibrated against real Argentinian O&G operations material:

- **IAPG** (Instituto Argentino del Petróleo y del Gas) — industry reference for upstream operations
- **ITP Neuquén** — "Operador de Sala de Control de Procesos Hidrocarburíferos" 12-week course (real DCS screenshots, equipment specifications, ESD procedures)
- **ENARGAS NAG-602 (2019)** — Argentinian regulatory norm for natural gas quality in transport and distribution pipelines
- **API specs** for centrifugal compression (suction 60 kg/cm² / discharge 65 kg/cm² from real plant data)

The simulator's `quality.py` module computes PCS (Gross Heating Value) and Wobbe Index per ISO 6976 / IRAM-IAPG A 6854 standards, and the output is validated against NAG-602 Tabla 1 spec limits.

---

## Validation

Five Athena queries run as part of `make athena-test` and confirm the simulator output is physically correct:

| # | Query                       | Validates                                              |
|---|-----------------------------|--------------------------------------------------------|
| 1 | `01_overview.sql`           | Row counts and date ranges per layer                   |
| 2 | `02_esd_timeline.sql`    | 8-step ESD sequence: DEPRESSURE → COMPRESSOR_TRIP → UTILITIES_DOWN → HOLD → RECOVERY |
| 3 | `03_flare_during_esd.sql`| HP flare spike to ~140-176 Mm³/d during depressurization; hot oil drop from 260°C to 130°C |
| 4 | `04_nag602_compliance.sql`  | PCS within 8850-10200 kcal/m³ (✓); Wobbe Index above 12470 limit (intentional dashboard signal) |
| 5 | `05_well_lifecycle.sql`     | IDLE → FLOWBACK → PRODUCING transitions; injected GAS_LOCK appears on LLL-002 only |

Current dataset spans **2025-11-20 → 2026-05-19** (181 days, 1-minute frequency) with an injected ESD event at 2026-03-15 14:00 (reason: FIRE_GAS_HIGH) and a gas-lock event on LLL-002 at 2026-04-10 08:00.

---

## Status

### ✅ Working

- Simulator v2 — 3-layer modular architecture
- LocalStack-based dev environment (S3 only, community edition)
- Real AWS deployment via Terraform (S3, Glue, Athena, IAM)
- ESD state machine with realistic 8-step sequence
- Gas quality propagation with NAG-602 compliance checks
- Glue Crawler covering all 3 layers
- 5 validated Athena queries
- Automation layer (Makefile, run scripts, CI)
- QuickSight Author user + Athena data source + initial `wells` dataset

### 🚧 Pending

- **QuickSight v2 dashboards** — multi-layer ESD timeline, flare analytics, fiscal gas quality vs NAG-602
- **Amazon Timestream** integration — AWS Support ticket open to enable LiveAnalytics on the account

### 🐛 Known issues

- The Terraform AWS provider's `aws_quicksight_data_set` resource reads `DescribeDataSetRefreshProperties` during plan/refresh, but that action is not honored by `quicksight:*` wildcard policies — even when listed explicitly. Workaround: `terraform apply -refresh=false` (already wired into `make tf-apply`). See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#known-issues) for details.

---

## Tech stack

**Simulation**: Python 3.12, [uv](https://docs.astral.sh/uv/), [Typer](https://typer.tiangolo.com/), [Rich](https://rich.readthedocs.io/), Pandas, PyArrow

**Infrastructure**: Terraform 1.5+, AWS (S3, Glue, Athena, QuickSight, IAM, CloudWatch), [LocalStack](https://localstack.cloud/) for dev

**Automation**: GNU Make, AWS CLI v2, GitHub Actions (terraform fmt + validate)

**Development**: WSL2 Ubuntu 24.04, [Claude Code](https://docs.claude.com/en/docs/claude-code) for AI-assisted development

---

## Cost

Current monthly AWS cost: **~$0.50/month** (mostly QuickSight Standard, pre-existing on the account).

- S3: <$0.01/month (~130 MB total)
- Glue Crawler: ~$0.04 per crawl (run on-demand)
- Athena: ~$0.05 per 5 queries (~30 MB scanned each)
- QuickSight Standard: $9/month (1 author seat, already active)

Total project marginal cost since starting: <$0.10.

A CloudWatch billing alarm at $10/month is configured (`oil-gas-billing-10usd`).

---

## License

MIT.

---

## Disclaimer

This is a **learning project**. The simulator generates synthetic data calibrated against public domain industry references; it does not represent any actual operating asset. The author has 15+ years of OT background in industrial automation but is using this project to learn modern cloud data engineering tooling.

If you work in the Argentinian O&G industry and spot something physically incorrect, [open an issue](https://github.com/c4chiv4che/oil-gas-quicksight/issues) — feedback welcome.



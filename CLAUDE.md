# Oil & Gas QuickSight Lab — Project Context for Claude

## Purpose
Learning project to master Amazon QuickSight while building a data platform
prototype for unconventional O&G operations (Vaca Muerta-style shale).
Long-term goal: productize for the O&G segment leveraging OT background.

## Stack
- **Local dev**: WSL2 (Ubuntu 24.04) on Windows, Docker Desktop, LocalStack 4.0
- **IaC**: Terraform 1.15+ with AWS provider ~> 5.70
- **Language**: Python 3.12 managed with `uv`
- **AWS services**: S3, Lambda, Glue, Athena (emulated in LocalStack);
  Timestream + QuickSight (real AWS only — no emulator)
- **Editor**: Cursor connected to WSL

## Repo layout
- `infra/localstack/` — Terraform targeting LocalStack (free iteration)
- `infra/aws/` — Terraform targeting real AWS (Timestream, QuickSight)
- `simulator/` — Python synthetic data generator for shale wells
- `data/raw/`, `data/curated/` — local datasets (gitignored)
- `notebooks/` — Jupyter exploration
- `docs/` — architecture diagrams, decision records

## Conventions
- **Region**: us-east-1 for everything (lowest QuickSight latency from AR is debatable, revisit later)
- **Naming**: kebab-case for AWS resources, snake_case for Python/Terraform identifiers
- **Tags**: every AWS resource must have `project`, `env`, `owner`, `managed`
- **No secrets in repo**: `.env` files gitignored, use `terraform.tfvars` (also ignored)
- **LocalStack endpoint**: http://localhost:4566
- **awslocal**: wrapper to use instead of `aws` when targeting LocalStack

## Domain notes (Vaca Muerta shale context)
- Multi-pad operations with horizontal wells
- Aggressive decline curves (60-70% year-1 typical)
- Signals of interest: WHP (wellhead pressure), CHP (casing head pressure),
  flowline temp, gas/oil/water rates, ESP motor current/frequency, choke position,
  separator levels, fracking pump pressures during stimulation
- Common alarms: high-high WHP, low flow, ESP gas lock, sand production indicators

## How Claude should help here
- Prefer Terraform over console clicks
- When generating code, target `uv`-managed Python envs (not pip/venv directly)
- For AWS-real work, always include cost considerations
- For OT signals, use realistic ranges and physical relationships (don't invent values)

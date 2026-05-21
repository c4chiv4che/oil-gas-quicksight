# Contributing

Thanks for your interest in this project. It's a learning/portfolio project, but contributions, bug reports, and domain corrections (especially from Argentinian O&G professionals) are welcome.

## Development setup

### Prerequisites

- WSL2 / Linux / macOS
- Python 3.12+ with [uv](https://docs.astral.sh/uv/)
- Docker (for LocalStack)
- AWS CLI v2 + Terraform 1.5+
- GNU Make

### Local setup

```bash
git clone https://github.com/c4chiv4che/oil-gas-quicksight.git
cd oil-gas-quicksight

# Install simulator dependencies
cd simulator && uv sync --group dev && cd ..

# Run the test suite
cd simulator && uv run pytest && cd ..

# Generate a smoke-test dataset (no AWS needed)
make sim-smoke
```

## AWS profiles (two-identity model)

Two AWS CLI profiles are required for full development:

- **`default`** — admin / deploy credentials. Used by Terraform when applying anything that touches IAM, Kinesis, Firehose, CloudWatch Logs, or the QuickSight account subscription. Override `var.aws_profile` per-invocation:

  ```bash
  TF_VAR_aws_profile=default terraform apply
  ```

- **`oil-gas-dev`** — runtime credentials, narrowly scoped (S3 R/W on the three project buckets, Glue read, Athena query, Kinesis produce on the three layer streams). Used by the simulator/producer, the QuickSight author session, and the `terraform plan` refresh path. This is the default value of `var.aws_profile`, so no override is needed for read-only operations.

Configure both:

```bash
aws configure --profile default       # admin / deploy keys
aws configure --profile oil-gas-dev   # runtime keys
```

The producer always runs as the runtime user:

```bash
uv run python -m src.simulator --days 1 --freq 30 --stream --profile oil-gas-dev
```

See [`docs/ARCHITECTURE.md` → Deployment & permissions model](docs/ARCHITECTURE.md#deployment--permissions-model) for the policy ARNs and a documented trade-off about the `default` profile being the admin identity in this lab setup.

## Running tests

```bash
cd simulator
uv run pytest                          # all tests
uv run pytest --cov=src --cov-report=term-missing   # with coverage
uv run pytest tests/test_physics.py    # a single module
```

All tests must pass and coverage should stay above 90% before merging.

## Code style

- Python 3.12+ with type hints
- Deterministic tests (seed any randomness)
- Keep simulator modules focused (physics, quality, events, etc. stay separate)
- ISA 5.1 tag naming for any new signals

## Commit conventions

This project uses conventional-commit prefixes:

- `feat:` new feature
- `fix:` bug fix
- `test:` adding or fixing tests
- `docs:` documentation only
- `chore:` tooling, deps, CI
- `refactor:` code change that neither fixes a bug nor adds a feature

Scope in parentheses when useful: `feat(quicksight): ...`, `chore(infra): ...`

## Branching

- Work on a feature branch: `git checkout -b feat/my-thing`
- Open a PR to `main`
- CI must pass (Python tests + Terraform validate + CodeQL)

## Infrastructure changes

Terraform lives in `infra/aws/`. Always:

```bash
make tf-plan    # review the plan first
make tf-apply   # apply (uses -refresh=false for a known QuickSight bug)
```

Never commit `.tfstate`, `.tfvars`, or AWS credentials — these are gitignored.

## Domain corrections

If you spot something physically or technically incorrect in the simulator (signal ranges, equipment behavior, NAG-602 compliance logic), please open an issue. Real-world calibration is valuable.

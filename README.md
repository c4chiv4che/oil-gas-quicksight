# Oil & Gas QuickSight Lab

End-to-end data platform for unconventional O&G operations (Vaca Muerta-style),
combining local simulation, AWS-native services, and Amazon QuickSight dashboards.

## Stack
- **Local**: WSL2 + Docker + LocalStack (S3, Lambda, IAM emulation)
- **AWS**: Timestream (time-series), QuickSight (BI), S3, Glue
- **IaC**: Terraform
- **Data**: Synthetic OT signals (pressures, flow rates, ESP currents, etc.)

## Status
🚧 Work in progress — learning project.

## Repo layout
\`\`\`
infra/         # Terraform modules (LocalStack + AWS)
simulator/     # Synthetic data generator for shale wells
data/          # Local datasets (gitignored)
notebooks/     # Exploration & validation
docs/          # Architecture & diagrams
\`\`\`

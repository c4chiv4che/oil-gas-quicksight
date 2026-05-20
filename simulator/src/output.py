"""Parquet writing + S3 upload + Rich summary tables."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import boto3
import pandas as pd
from rich.console import Console
from rich.table import Table

from .config import PAD_ID, S3_BUCKETS, S3_ENDPOINTS

console = Console()


def write_layer_parquet(df: pd.DataFrame, layer: str, output_dir: Path) -> int:
    """Write a layer DataFrame partitioned by date.
    Path: output_dir/{layer}/pad={PAD_ID}/date=YYYY-MM-DD/data.parquet
    Returns number of files written."""
    if df.empty:
        return 0
    df = df.copy()
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df["_date"] = df["timestamp"].dt.date.astype(str)

    base = output_dir / layer / f"pad={PAD_ID}"
    base.mkdir(parents=True, exist_ok=True)

    n = 0
    for date_str, group in df.groupby("_date"):
        part_path = base / f"date={date_str}"
        part_path.mkdir(exist_ok=True)
        filepath = part_path / "data.parquet"
        group.drop(columns=["_date"]).to_parquet(filepath, index=False, engine="pyarrow")
        n += 1
    return n


def upload_layer_s3(local_dir: Path, layer: str, target: str) -> int:  # pragma: no cover
    """Upload all Parquet files for a layer to s3://{bucket}/{layer}/pad=.../date=.../data.parquet.
    target: 'local' (LocalStack) or 'aws' (real AWS)."""
    if target not in S3_BUCKETS:
        raise ValueError(f"upload target must be one of {list(S3_BUCKETS)}")
    bucket = S3_BUCKETS[target]
    endpoint = S3_ENDPOINTS[target]
    base = local_dir / layer / f"pad={PAD_ID}"
    if not base.exists():
        return 0

    client_kwargs: dict = {"region_name": "us-east-1"}
    if endpoint:
        client_kwargs["endpoint_url"] = endpoint
        client_kwargs["aws_access_key_id"] = "test"
        client_kwargs["aws_secret_access_key"] = "test"
    s3 = boto3.client("s3", **client_kwargs)

    uploaded = 0
    for date_dir in sorted(base.glob("date=*")):
        local_file = date_dir / "data.parquet"
        if not local_file.exists():
            continue
        key = f"{layer}/pad={PAD_ID}/{date_dir.name}/data.parquet"
        s3.upload_file(str(local_file), bucket, key)
        uploaded += 1
    return uploaded


def render_summary(layer_dfs: dict[str, pd.DataFrame], elapsed_s: float, output_dir: Path) -> None:
    """Pretty per-layer summary table."""
    table = Table(title="Vaca Muerta Simulator v2 — Run Summary", show_lines=True)
    table.add_column("Layer", style="cyan", no_wrap=True)
    table.add_column("Rows", justify="right", style="magenta")
    table.add_column("Columns", justify="right")
    table.add_column("Date span", style="green")
    table.add_column("Output", style="dim")

    for layer, df in layer_dfs.items():
        if df.empty:
            table.add_row(layer, "0", "0", "-", "(skipped)")
            continue
        dates = pd.to_datetime(df["timestamp"]).dt.date
        span = f"{dates.min()} → {dates.max()}"
        path = output_dir / layer / f"pad={PAD_ID}"
        table.add_row(layer, f"{len(df):,}", str(len(df.columns)), span, str(path))

    console.print()
    console.print(table)
    console.print(f"[dim]Elapsed: {elapsed_s:.1f}s[/dim]\n")

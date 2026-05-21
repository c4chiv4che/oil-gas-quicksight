"""Kinesis producer for wells-layer records.

Wraps boto3's kinesis client with batching, byte-limit awareness, and a
retry loop that re-sends only the records that PutRecords rejected.

Designed for accelerated replay: emits as fast as Kinesis accepts, with
exponential backoff only on throttling — no real-time pacing.
"""

from __future__ import annotations

import json
import random
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Iterable, Optional

import boto3
import numpy as np


# Kinesis PutRecords limits (AWS service quotas)
MAX_RECORDS_PER_CALL = 500
MAX_BATCH_BYTES = 5 * 1024 * 1024     # 5 MiB
MAX_RECORD_BYTES = 1024 * 1024        # 1 MiB

# Error codes that are worth retrying. Anything else is a hard failure.
RETRYABLE_ERROR_CODES = {
    "ProvisionedThroughputExceededException",
    "InternalFailure",
}


@dataclass
class SendStats:
    """Aggregate counters returned by KinesisProducer.send()."""
    total_sent: int = 0
    failed_after_retries: int = 0
    batches: int = 0
    retries: int = 0

    def merge(self, other: "SendStats") -> None:
        self.total_sent += other.total_sent
        self.failed_after_retries += other.failed_after_retries
        self.batches += other.batches
        self.retries += other.retries


def _json_default(obj: Any) -> Any:
    """JSON fallback for types the simulator emits but json.dumps can't handle."""
    if isinstance(obj, datetime):
        # Firehose JSON->Parquet conversion expects Athena/Glue's native
        # timestamp format ("yyyy-MM-dd HH:mm:ss"), not ISO 8601 with a "T"
        # separator or timezone offset.
        return obj.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return float(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


def serialize_record(record: dict) -> tuple[bytes, str]:
    """Convert a wells dict into (json_bytes, partition_key).
    Raises ValueError if well_id is missing or the encoded payload exceeds 1 MiB.
    """
    if "well_id" not in record or not record["well_id"]:
        raise ValueError("record must contain a non-empty 'well_id' for partition key")
    payload = json.dumps(record, default=_json_default, separators=(",", ":")).encode("utf-8")
    if len(payload) > MAX_RECORD_BYTES:
        raise ValueError(
            f"record exceeds Kinesis 1 MiB limit ({len(payload)} bytes); well_id={record['well_id']}"
        )
    return payload, str(record["well_id"])


@dataclass
class _PreparedRecord:
    data: bytes
    partition_key: str

    def to_entry(self) -> dict:
        return {"Data": self.data, "PartitionKey": self.partition_key}

    @property
    def size(self) -> int:
        # Kinesis bills by Data + PartitionKey bytes; use that for batch sizing too.
        return len(self.data) + len(self.partition_key.encode("utf-8"))


class KinesisProducer:
    """Batches wells dicts into Kinesis PutRecords calls with retry-on-throttle."""

    def __init__(
        self,
        stream_name: str,
        region: str = "us-east-1",
        profile: Optional[str] = None,
        *,
        client: Any = None,
        sleep_fn: Callable[[float], None] = time.sleep,
        max_retries: int = 5,
        backoff_base_s: float = 0.1,
        backoff_cap_s: float = 2.0,
    ) -> None:
        self.stream_name = stream_name
        self.max_retries = max_retries
        self.backoff_base_s = backoff_base_s
        self.backoff_cap_s = backoff_cap_s
        self._sleep = sleep_fn

        if client is not None:
            self.client = client
        else:
            session = boto3.Session(profile_name=profile, region_name=region)
            self.client = session.client("kinesis")

    # ── Chunking ────────────────────────────────────────────────────
    def _chunks(self, prepared: list[_PreparedRecord]) -> Iterable[list[_PreparedRecord]]:
        chunk: list[_PreparedRecord] = []
        chunk_bytes = 0
        for rec in prepared:
            # +1 byte of slack per record for the PutRecords envelope; cheap and safe.
            if chunk and (
                len(chunk) >= MAX_RECORDS_PER_CALL
                or chunk_bytes + rec.size > MAX_BATCH_BYTES
            ):
                yield chunk
                chunk = []
                chunk_bytes = 0
            chunk.append(rec)
            chunk_bytes += rec.size
        if chunk:
            yield chunk

    # ── Per-batch send with retry on failed records only ────────────
    def _send_batch(self, batch: list[_PreparedRecord], stats: SendStats) -> None:
        pending = batch
        attempt = 0
        while pending:
            entries = [r.to_entry() for r in pending]
            response = self.client.put_records(Records=entries, StreamName=self.stream_name)
            failed_count = response.get("FailedRecordCount", 0)
            results = response.get("Records", [])

            if failed_count == 0:
                stats.total_sent += len(pending)
                return

            # Partition pending into success vs retryable vs hard-fail
            retryable: list[_PreparedRecord] = []
            hard_failed = 0
            succeeded = 0
            for rec, result in zip(pending, results):
                err = result.get("ErrorCode")
                if not err:
                    succeeded += 1
                elif err in RETRYABLE_ERROR_CODES:
                    retryable.append(rec)
                else:
                    hard_failed += 1
            stats.total_sent += succeeded

            if attempt >= self.max_retries:
                # Out of retries — everything still pending is lost; count it, don't hide it.
                stats.failed_after_retries += len(retryable) + hard_failed
                return

            if hard_failed:
                stats.failed_after_retries += hard_failed

            if not retryable:
                return

            # Exponential backoff with jitter
            delay = min(
                self.backoff_base_s * (2 ** attempt) + random.uniform(0, self.backoff_base_s),
                self.backoff_cap_s,
            )
            self._sleep(delay)
            stats.retries += 1
            attempt += 1
            pending = retryable

    # ── Public API ──────────────────────────────────────────────────
    def send(self, records: Iterable[dict]) -> SendStats:
        prepared = [_PreparedRecord(*serialize_record(r)) for r in records]
        stats = SendStats()
        for batch in self._chunks(prepared):
            stats.batches += 1
            self._send_batch(batch, stats)
        return stats

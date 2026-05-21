"""Tests for the Kinesis producer.

All tests use a hand-rolled FakeKinesisClient stub so no boto3/AWS calls
happen. Retries are deterministic via an injected no-op sleep_fn.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Optional

import numpy as np
import pytest

from src.stream import (
    KinesisProducer,
    MAX_RECORDS_PER_CALL,
    SendStats,
    serialize_record,
)


# ── Fake Kinesis client ───────────────────────────────────────────────────────

class FakeKinesisClient:
    """Stand-in for boto3 kinesis client.

    fail_plan is a list of dicts, one per put_records call, e.g.:
        [{"fail_first": 50, "code": "ProvisionedThroughputExceededException"}, {}, ...]
    Any call beyond the plan succeeds entirely.
    """

    def __init__(self, fail_plan: Optional[list[dict]] = None):
        self.calls: list[dict] = []
        self.fail_plan = fail_plan or []

    def put_records(self, *, Records, StreamName):
        call_idx = len(self.calls)
        plan = self.fail_plan[call_idx] if call_idx < len(self.fail_plan) else {}
        fail_first = plan.get("fail_first", 0)
        err_code = plan.get("code", "ProvisionedThroughputExceededException")
        self.calls.append({"Records": list(Records), "StreamName": StreamName})

        out = []
        for i in range(len(Records)):
            if i < fail_first:
                out.append({"ErrorCode": err_code, "ErrorMessage": "fake"})
            else:
                out.append({"SequenceNumber": f"seq-{call_idx}-{i}", "ShardId": "shardId-0"})
        return {"FailedRecordCount": fail_first, "Records": out}


def _no_sleep(_seconds: float) -> None:
    pass


def _make_record(well_id: str, i: int = 0) -> dict:
    return {
        "timestamp": datetime(2026, 4, 15, 14, 0, 0, tzinfo=timezone.utc),
        "well_id": well_id,
        "pad_id": "PAD-LLL-01",
        "FT_OIL": 42.5 + i,
        "WHP": np.float64(120.3),
        "well_state": "PRODUCING",
    }


# ── Serialization ─────────────────────────────────────────────────────────────

class TestSerialization:
    def test_timestamp_becomes_iso8601_string(self) -> None:
        data, pk = serialize_record(_make_record("LLL-001"))
        decoded = json.loads(data)
        assert decoded["timestamp"] == "2026-04-15T14:00:00+00:00"
        assert pk == "LLL-001"

    def test_numpy_scalars_serialized(self) -> None:
        rec = {"well_id": "LLL-002", "x": np.int64(7), "y": np.float64(1.5)}
        data, _ = serialize_record(rec)
        decoded = json.loads(data)
        assert decoded["x"] == 7
        assert decoded["y"] == 1.5

    def test_partition_key_is_well_id(self) -> None:
        _, pk = serialize_record(_make_record("LLL-003"))
        assert pk == "LLL-003"

    def test_missing_well_id_raises(self) -> None:
        with pytest.raises(ValueError, match="well_id"):
            serialize_record({"timestamp": datetime.now(tz=timezone.utc), "x": 1})

    def test_empty_well_id_raises(self) -> None:
        with pytest.raises(ValueError, match="well_id"):
            serialize_record({"well_id": "", "x": 1})

    def test_oversized_record_raises(self) -> None:
        # 1.2 MiB payload — over the 1 MiB Kinesis limit
        rec = {"well_id": "LLL-001", "blob": "x" * (1024 * 1024 + 200_000)}
        with pytest.raises(ValueError, match="1 MiB"):
            serialize_record(rec)


# ── Batching ──────────────────────────────────────────────────────────────────

class TestBatching:
    def test_under_500_records_one_call(self) -> None:
        fake = FakeKinesisClient()
        prod = KinesisProducer("test-stream", client=fake, sleep_fn=_no_sleep)
        records = [_make_record(f"W-{i:03d}", i) for i in range(200)]
        stats = prod.send(records)
        assert len(fake.calls) == 1
        assert len(fake.calls[0]["Records"]) == 200
        assert stats.total_sent == 200
        assert stats.batches == 1
        assert stats.failed_after_retries == 0
        assert stats.retries == 0

    def test_over_500_splits_into_multiple_calls(self) -> None:
        fake = FakeKinesisClient()
        prod = KinesisProducer("test-stream", client=fake, sleep_fn=_no_sleep)
        records = [_make_record(f"W-{i:04d}", i) for i in range(1200)]
        stats = prod.send(records)
        # 1200 → 500 + 500 + 200
        assert len(fake.calls) == 3
        assert [len(c["Records"]) for c in fake.calls] == [500, 500, 200]
        assert stats.total_sent == 1200
        assert stats.batches == 3
        assert stats.failed_after_retries == 0

    def test_exact_500_boundary(self) -> None:
        fake = FakeKinesisClient()
        prod = KinesisProducer("test-stream", client=fake, sleep_fn=_no_sleep)
        records = [_make_record(f"W-{i:03d}") for i in range(MAX_RECORDS_PER_CALL)]
        stats = prod.send(records)
        assert len(fake.calls) == 1
        assert len(fake.calls[0]["Records"]) == 500
        assert stats.batches == 1

    def test_byte_limit_splits_below_500(self) -> None:
        """Records ~600 KiB each — only 8 fit per call before the 5 MiB chunk cap kicks in."""
        fake = FakeKinesisClient()
        prod = KinesisProducer("test-stream", client=fake, sleep_fn=_no_sleep)
        big_blob = "x" * (600 * 1024)
        records = [{"well_id": f"W-{i:03d}", "blob": big_blob} for i in range(20)]
        stats = prod.send(records)
        # 20 records × ~600 KiB > 5 MiB → must split into >1 batches well below 500 count
        assert stats.batches >= 2
        for call in fake.calls:
            assert len(call["Records"]) <= MAX_RECORDS_PER_CALL
        assert stats.total_sent == 20

    def test_stream_name_passed_through(self) -> None:
        fake = FakeKinesisClient()
        prod = KinesisProducer("vaca-muerta-wells-stream", client=fake, sleep_fn=_no_sleep)
        prod.send([_make_record("LLL-001")])
        assert fake.calls[0]["StreamName"] == "vaca-muerta-wells-stream"


# ── Partial-failure retries ───────────────────────────────────────────────────

class TestPartialFailureRetry:
    def test_partial_failure_retries_only_failed_records(self) -> None:
        # Call 1: first 50 of 500 fail with throttling. Call 2 (retry): all succeed.
        fake = FakeKinesisClient(fail_plan=[{"fail_first": 50}, {}])
        prod = KinesisProducer("test-stream", client=fake, sleep_fn=_no_sleep)
        records = [_make_record(f"W-{i:03d}", i) for i in range(500)]
        stats = prod.send(records)

        assert len(fake.calls) == 2
        # Second call must carry exactly the 50 retried records, no more.
        assert len(fake.calls[1]["Records"]) == 50
        assert stats.total_sent == 500
        assert stats.failed_after_retries == 0
        assert stats.batches == 1     # batches counts source chunks, not retries
        assert stats.retries == 1

    def test_retry_carries_correct_payloads(self) -> None:
        # Fail records 0..2 on first call; ensure those exact records are resent.
        fake = FakeKinesisClient(fail_plan=[{"fail_first": 3}, {}])
        prod = KinesisProducer("test-stream", client=fake, sleep_fn=_no_sleep)
        records = [_make_record(f"W-{i:03d}", i) for i in range(10)]
        prod.send(records)

        first_call = fake.calls[0]["Records"]
        retried = fake.calls[1]["Records"]
        # The first 3 entries of call 1 should match the entries of call 2 byte-for-byte.
        for sent, again in zip(first_call[:3], retried):
            assert sent["Data"] == again["Data"]
            assert sent["PartitionKey"] == again["PartitionKey"]

    def test_failed_after_retries_counted_not_silent(self) -> None:
        # Keep failing every call past max_retries
        fail_plan = [{"fail_first": 10}] * 20  # plenty
        fake = FakeKinesisClient(fail_plan=fail_plan)
        prod = KinesisProducer(
            "test-stream", client=fake, sleep_fn=_no_sleep, max_retries=3,
        )
        records = [_make_record(f"W-{i:03d}", i) for i in range(10)]
        stats = prod.send(records)

        # max_retries=3 → 1 initial + 3 retries = 4 calls
        assert len(fake.calls) == 4
        assert stats.failed_after_retries == 10
        assert stats.total_sent == 0
        assert stats.retries == 3

    def test_hard_error_not_retried(self) -> None:
        # Non-retryable error code → counted as failed, no retry
        fake = FakeKinesisClient(fail_plan=[
            {"fail_first": 2, "code": "ValidationException"},
        ])
        prod = KinesisProducer("test-stream", client=fake, sleep_fn=_no_sleep)
        records = [_make_record(f"W-{i:03d}", i) for i in range(10)]
        stats = prod.send(records)

        assert len(fake.calls) == 1                  # no retry attempted
        assert stats.failed_after_retries == 2
        assert stats.total_sent == 8
        assert stats.retries == 0

    def test_no_sleep_on_happy_path(self) -> None:
        slept: list[float] = []

        def spy_sleep(s: float) -> None:
            slept.append(s)

        fake = FakeKinesisClient()
        prod = KinesisProducer("test-stream", client=fake, sleep_fn=spy_sleep)
        prod.send([_make_record(f"W-{i:03d}", i) for i in range(100)])
        assert slept == []

    def test_sleep_called_between_retries(self) -> None:
        slept: list[float] = []

        def spy_sleep(s: float) -> None:
            slept.append(s)

        fake = FakeKinesisClient(fail_plan=[{"fail_first": 2}, {}])
        prod = KinesisProducer("test-stream", client=fake, sleep_fn=spy_sleep)
        prod.send([_make_record(f"W-{i:03d}", i) for i in range(5)])
        assert len(slept) == 1
        assert slept[0] > 0


# ── SendStats aggregation ─────────────────────────────────────────────────────

class TestSendStats:
    def test_merge_accumulates(self) -> None:
        a = SendStats(total_sent=10, batches=1, retries=0, failed_after_retries=0)
        b = SendStats(total_sent=5, batches=1, retries=2, failed_after_retries=1)
        a.merge(b)
        assert a.total_sent == 15
        assert a.batches == 2
        assert a.retries == 2
        assert a.failed_after_retries == 1

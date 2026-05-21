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


def _make_plant_record() -> dict:
    """Minimal plant-shaped record: pad-level aggregate, no well_id."""
    return {
        "timestamp": datetime(2026, 4, 15, 14, 0, 0, tzinfo=timezone.utc),
        "pad_id": "PAD-LLL-01",
        "plant_event": "NORMAL",
        "esd_phase": "INACTIVE",
        "esd_reason": "",
        "PT_INLET": 49.8,
        "TT_INLET": 42.1,
    }


def _make_utilities_record() -> dict:
    """Minimal utilities-shaped record: pad-level aggregate, no well_id."""
    return {
        "timestamp": datetime(2026, 4, 15, 14, 0, 0, tzinfo=timezone.utc),
        "pad_id": "PAD-LLL-01",
        "esd_phase": "INACTIVE",
        "esd_reason": "",
        "TT_HOTOIL_SUPPLY": 260.0,
        "PT_IA_HEADER": 8.5,
    }


# ── Serialization ─────────────────────────────────────────────────────────────

class TestSerialization:
    def test_timestamp_serialized_for_glue(self) -> None:
        # Firehose JSON->Parquet rejects ISO 8601 with "T" / tz offset; it expects
        # Athena/Glue's native "yyyy-MM-dd HH:mm:ss" format.
        data, pk = serialize_record(_make_record("LLL-001"))
        decoded = json.loads(data)
        assert decoded["timestamp"] == "2026-04-15 14:00:00"
        assert "T" not in decoded["timestamp"]
        assert "+" not in decoded["timestamp"]
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


# ── Multi-layer serialization (plant / utilities use pad_id as partition key) ─

class TestMultiLayerSerialization:
    """Locks in the contract that all three layers share the same Glue-native
    timestamp format and that pad_id can be used as the partition key field for
    layers that don't have well_id (plant, utilities)."""

    def test_plant_record_uses_pad_id_partition_key(self) -> None:
        data, pk = serialize_record(_make_plant_record(), partition_key_field="pad_id")
        assert pk == "PAD-LLL-01"
        decoded = json.loads(data)
        assert decoded["pad_id"] == "PAD-LLL-01"

    def test_utilities_record_uses_pad_id_partition_key(self) -> None:
        data, pk = serialize_record(_make_utilities_record(), partition_key_field="pad_id")
        assert pk == "PAD-LLL-01"
        decoded = json.loads(data)
        assert decoded["pad_id"] == "PAD-LLL-01"

    def test_plant_timestamp_glue_native_format(self) -> None:
        # Critical: Firehose JSON->Parquet conversion expects the same Glue/Athena
        # native format ("yyyy-MM-dd HH:mm:ss") that we already verified for wells.
        # This lock-in catches a regression where the fix gets reverted on the
        # plant/utilities branches.
        data, _ = serialize_record(_make_plant_record(), partition_key_field="pad_id")
        decoded = json.loads(data)
        assert decoded["timestamp"] == "2026-04-15 14:00:00"
        assert "T" not in decoded["timestamp"]
        assert "+" not in decoded["timestamp"]

    def test_utilities_timestamp_glue_native_format(self) -> None:
        data, _ = serialize_record(_make_utilities_record(), partition_key_field="pad_id")
        decoded = json.loads(data)
        assert decoded["timestamp"] == "2026-04-15 14:00:00"
        assert "T" not in decoded["timestamp"]
        assert "+" not in decoded["timestamp"]

    def test_plant_missing_pad_id_raises(self) -> None:
        rec = _make_plant_record()
        del rec["pad_id"]
        with pytest.raises(ValueError, match="pad_id"):
            serialize_record(rec, partition_key_field="pad_id")

    def test_default_partition_key_field_is_well_id(self) -> None:
        # Back-compat: existing callers that don't pass partition_key_field still get well_id behaviour.
        _, pk = serialize_record(_make_record("LLL-007"))
        assert pk == "LLL-007"


class TestKinesisProducerPartitionKey:
    """The producer must thread partition_key_field through to serialize_record."""

    def test_producer_with_pad_id_field_emits_pad_id_partition_key(self) -> None:
        fake = FakeKinesisClient()
        prod = KinesisProducer(
            "vaca-muerta-plant-stream",
            client=fake,
            sleep_fn=_no_sleep,
            partition_key_field="pad_id",
        )
        prod.send([_make_plant_record()])
        assert fake.calls[0]["StreamName"] == "vaca-muerta-plant-stream"
        assert fake.calls[0]["Records"][0]["PartitionKey"] == "PAD-LLL-01"

    def test_producer_defaults_to_well_id(self) -> None:
        fake = FakeKinesisClient()
        prod = KinesisProducer("vaca-muerta-wells-stream", client=fake, sleep_fn=_no_sleep)
        prod.send([_make_record("LLL-002")])
        assert fake.calls[0]["Records"][0]["PartitionKey"] == "LLL-002"


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


# ── Multi-layer dispatch (simulator-level, no real AWS) ───────────────────────

class TestSimulatorMultiLayerDispatch:
    """End-to-end: cfg.stream=True with all three layers wires up one producer
    per layer, each bound to the right stream name and partition_key_field.
    Patches src.simulator.KinesisProducer to capture dispatch without boto3."""

    def _run_with_fakes(self, monkeypatch, tmp_path):
        import io
        from datetime import datetime, timezone
        from pathlib import Path
        from rich.console import Console

        from src import output as output_module
        from src import simulator as simulator_module
        from src.cli import RunConfig
        from src.events import ESDReason

        # Silence rich output
        sink = Console(file=io.StringIO(), force_terminal=False, force_jupyter=False,
                       record=False, quiet=False, width=120)
        monkeypatch.setattr(simulator_module, "console", sink)
        monkeypatch.setattr(output_module, "console", sink)

        instances: dict[str, "FakeProducer"] = {}

        class FakeProducer:
            def __init__(self, *, stream_name, region, profile, partition_key_field):
                self.stream_name = stream_name
                self.partition_key_field = partition_key_field
                self.sent: list[dict] = []
                # Track instantiation by stream name
                instances[stream_name] = self

            def send(self, records):
                self.sent.extend(records)
                return SendStats(total_sent=len(records), batches=1)

        monkeypatch.setattr(simulator_module, "KinesisProducer", FakeProducer)

        start = datetime(2026, 4, 15, 0, 0, 0, tzinfo=timezone.utc)
        end = datetime(2026, 4, 15, 2, 0, 0, tzinfo=timezone.utc)  # 2 hours
        cfg = RunConfig(
            start=start, end=end, freq_minutes=60,
            layers=("wells", "plant", "utilities"),
            upload="none", output_dir=Path(tmp_path), seed=42,
            inject_esd_at=None, esd_reason=ESDReason.EXTERNAL_TRIP, esd_duration_h=4.0,
            inject_gas_lock_well=None, inject_gas_lock_at=None, gas_lock_duration_h=3.0,
            stream=True, no_local=False, profile="oil-gas-dev",
        )
        simulator_module.run(cfg)
        return instances

    def test_one_producer_per_streamed_layer(self, monkeypatch, tmp_path) -> None:
        instances = self._run_with_fakes(monkeypatch, tmp_path)
        assert set(instances.keys()) == {
            "vaca-muerta-wells-stream",
            "vaca-muerta-plant-stream",
            "vaca-muerta-utilities-stream",
        }

    def test_per_layer_partition_key_field(self, monkeypatch, tmp_path) -> None:
        instances = self._run_with_fakes(monkeypatch, tmp_path)
        assert instances["vaca-muerta-wells-stream"].partition_key_field == "well_id"
        assert instances["vaca-muerta-plant-stream"].partition_key_field == "pad_id"
        assert instances["vaca-muerta-utilities-stream"].partition_key_field == "pad_id"

    def test_records_routed_to_their_layer_stream(self, monkeypatch, tmp_path) -> None:
        instances = self._run_with_fakes(monkeypatch, tmp_path)
        # 2 hours × 60-min ticks = 2 ticks
        # wells: 4 wells × 2 ticks = 8 records ; plant/utilities: 2 records each
        assert len(instances["vaca-muerta-wells-stream"].sent) == 8
        assert len(instances["vaca-muerta-plant-stream"].sent) == 2
        assert len(instances["vaca-muerta-utilities-stream"].sent) == 2

        # Spot-check shape: wells records carry well_id, plant/utilities carry pad_id
        assert all("well_id" in r for r in instances["vaca-muerta-wells-stream"].sent)
        assert all("pad_id" in r for r in instances["vaca-muerta-plant-stream"].sent)
        assert all("pad_id" in r for r in instances["vaca-muerta-utilities-stream"].sent)

    def test_subset_of_layers_only_streams_those(self, monkeypatch, tmp_path) -> None:
        """--stream with --layers plant,utilities should NOT instantiate the wells producer."""
        import io
        from datetime import datetime, timezone
        from pathlib import Path
        from rich.console import Console

        from src import output as output_module
        from src import simulator as simulator_module
        from src.cli import RunConfig
        from src.events import ESDReason

        sink = Console(file=io.StringIO(), force_terminal=False, force_jupyter=False,
                       record=False, quiet=False, width=120)
        monkeypatch.setattr(simulator_module, "console", sink)
        monkeypatch.setattr(output_module, "console", sink)

        instances: dict[str, str] = {}

        class FakeProducer:
            def __init__(self, *, stream_name, region, profile, partition_key_field):
                instances[stream_name] = partition_key_field

            def send(self, records):
                return SendStats(total_sent=len(records), batches=1)

        monkeypatch.setattr(simulator_module, "KinesisProducer", FakeProducer)

        start = datetime(2026, 4, 15, 0, 0, 0, tzinfo=timezone.utc)
        cfg = RunConfig(
            start=start, end=start.replace(hour=1), freq_minutes=60,
            layers=("plant", "utilities"),
            upload="none", output_dir=Path(tmp_path), seed=42,
            inject_esd_at=None, esd_reason=ESDReason.EXTERNAL_TRIP, esd_duration_h=4.0,
            inject_gas_lock_well=None, inject_gas_lock_at=None, gas_lock_duration_h=3.0,
            stream=True, no_local=False, profile="oil-gas-dev",
        )
        simulator_module.run(cfg)

        assert "vaca-muerta-wells-stream" not in instances
        assert set(instances.keys()) == {
            "vaca-muerta-plant-stream",
            "vaca-muerta-utilities-stream",
        }

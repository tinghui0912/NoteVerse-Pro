"""Network-free behavior tests for the operational asset verifier."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app.modules.model_assets.generated.practice_acoustic_model_asset import MODEL_ASSET


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/verify_practice_acoustic_model_asset.py"


@pytest.fixture
def verifier():
    spec = importlib.util.spec_from_file_location("practice_asset_verifier", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def asset(verifier, monkeypatch, tmp_path):
    data = b"local asset fixture"
    model = tmp_path / "model.onnx"
    model.write_bytes(data)
    report = tmp_path / "receipt.json"
    monkeypatch.setattr(
        verifier,
        "MODEL_ASSET",
        MODEL_ASSET._replace(byte_size=len(data), sha256=hashlib.sha256(data).hexdigest()),
    )
    body = Mock()
    body.iter_chunks.return_value = [data[:5], data[5:]]
    client = Mock()
    client.get_bucket_acl.return_value = {
        "Owner": {"ID": "owner"},
        "Grants": [{"Grantee": {"Type": "CanonicalUser", "ID": "owner"}}],
    }
    client.head_object.return_value = {"ContentLength": len(data)}
    client.get_object.return_value = {"Body": body}
    storage = SimpleNamespace(
        client=client,
        bucket="test-objects",
        region="test",
        exists=Mock(return_value=True),
        object_metadata=Mock(return_value=SimpleNamespace(size_bytes=len(data))),
    )
    factory = Mock(return_value=storage)
    monkeypatch.setattr(verifier, "S3CompatibleObjectStorage", factory)
    return SimpleNamespace(
        data=data,
        model=model,
        report=report,
        body=body,
        client=client,
        factory=factory,
        storage=storage,
    )


def test_verifier_targets_the_current_delivery_object(verifier):
    assert verifier.MODEL_ASSET is MODEL_ASSET


def test_local_identity_failure_stops_before_object_access(verifier, asset):
    asset.model.write_bytes(b"incorrect")

    receipt = verifier.verify_asset(False, asset.report, asset.model)

    assert receipt["status"] == "EXACT_ASSET_DELIVERY_GATE_BLOCKED"
    assert receipt["failure"]["code"] == "EXACT_VALIDATED_ARTIFACT_UNAVAILABLE"
    asset.factory.assert_not_called()
    assert json.loads(asset.report.read_text()) == receipt


def test_existing_private_object_is_streamed_verified_and_closed(verifier, asset):
    receipt = verifier.verify_asset(False, asset.report, asset.model)

    assert receipt["status"] == "EXACT_VALIDATED_ASSET_DELIVERY_VERIFIED"
    assert receipt["assetIdentity"] == "practice-acoustic-robust-browser@v1"
    assert receipt["remoteBytes"] == len(asset.data)
    assert receipt["remoteSha256"] == hashlib.sha256(asset.data).hexdigest()
    assert receipt["uploaded"] is False
    asset.storage.exists.assert_called_once_with(verifier.MODEL_ASSET.storage_key)
    asset.storage.object_metadata.assert_called_once_with(verifier.MODEL_ASSET.storage_key)
    assert asset.client.get_object.call_args.kwargs["Key"] == verifier.MODEL_ASSET.storage_key
    asset.client.put_object.assert_not_called()
    asset.body.close.assert_called_once_with()


def test_public_bucket_blocks_all_object_access(verifier, asset):
    asset.client.get_bucket_acl.return_value["Grants"] = [
        {"Grantee": {"Type": "Group", "URI": "all-users"}}
    ]

    receipt = verifier.verify_asset(True, asset.report, asset.model)

    assert receipt["failure"]["code"] == "ASSET_BUCKET_NOT_PRIVATE"
    asset.client.head_object.assert_not_called()
    asset.client.put_object.assert_not_called()
    asset.client.get_object.assert_not_called()


@pytest.mark.parametrize("publish", [False, True])
def test_missing_object_requires_explicit_publish_and_forbids_overwrite(verifier, asset, publish):
    asset.storage.exists.return_value = False
    uploads = []

    def upload(**request):
        uploads.append((request["Key"], request["IfNoneMatch"], request["Body"].read()))

    asset.client.put_object.side_effect = upload

    receipt = verifier.verify_asset(publish, asset.report, asset.model)

    if publish:
        assert receipt["status"] == "EXACT_VALIDATED_ASSET_DELIVERY_VERIFIED"
        assert receipt["uploaded"] is True
        assert uploads == [(verifier.MODEL_ASSET.storage_key, "*", asset.data)]
        asset.body.close.assert_called_once_with()
    else:
        assert receipt["failure"]["code"] == "EXACT_DELIVERY_OBJECT_NOT_PUBLISHED"
        asset.client.put_object.assert_not_called()
        asset.client.get_object.assert_not_called()


@pytest.mark.parametrize("oversized", [False, True])
def test_remote_integrity_failure_closes_stream(verifier, asset, oversized):
    asset.body.iter_chunks.return_value = [b"x" * (len(asset.data) + int(oversized))]

    receipt = verifier.verify_asset(False, asset.report, asset.model)

    expected = "REMOTE_MODEL_BYTE_LIMIT_EXCEEDED" if oversized else "REMOTE_MODEL_IDENTITY_MISMATCH"
    assert receipt["failure"]["code"] == expected
    asset.body.close.assert_called_once_with()
    asset.client.put_object.assert_not_called()


def test_existing_receipt_is_never_overwritten(verifier, asset):
    asset.report.write_text("existing receipt")

    with pytest.raises(RuntimeError, match="APPEND_ONLY_REPORT_ALREADY_EXISTS"):
        verifier.verify_asset(False, asset.report, asset.model)

    assert asset.report.read_text() == "existing receipt"
    asset.factory.assert_not_called()


def test_cli_requires_an_explicit_receipt_path(tmp_path):
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--model", str(tmp_path / "model.onnx")],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 2
    assert "--report" in result.stderr
    assert list(tmp_path.iterdir()) == []


def test_existing_model_metadata_mismatch_blocks_publication(verifier, asset):
    asset.storage.object_metadata.return_value.size_bytes += 1
    receipt = verifier.verify_asset(True, asset.report, asset.model)
    assert receipt["failure"]["code"] == "EXISTING_CONTENT_ADDRESSED_OBJECT_SIZE_MISMATCH"
    asset.client.put_object.assert_not_called()
    asset.client.get_object.assert_not_called()

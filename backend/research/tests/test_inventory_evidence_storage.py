"""Evidence inventory behavior in small temporary committed repositories."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

import pytest

from inventory_evidence_storage import classify, inventory, json_profile


def commit(root):
    subprocess.run(["git", "-C", str(root), "add", "."], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(root), "-c", "user.name=Inventory Test",
                    "-c", "user.email=inventory@example.test", "commit", "-qm", "fixture"],
                   check=True, capture_output=True)


def write(root, relative, data):
    file = root / relative
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_bytes(data)
    return file


@pytest.fixture
def repo(tmp_path):
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    subprocess.run(["git", "-C", str(tmp_path), "config", "core.autocrlf", "false"], check=True)
    return tmp_path


def test_committed_bytes_hashes_and_determinism(repo):
    payload = b'{"verdict":"PASS"}\n'
    file = write(repo, "backend/research/reports/result.json", payload)
    write(repo, "backend/research/reports/readout.md", b"small conclusion\n")
    commit(repo)
    file.write_bytes(b"uncommitted changes\r\n")
    write(repo, "backend/research/reports/untracked.json", b"{}")
    first = inventory(repo)
    assert first == inventory(repo)
    row = next(r for r in first["files"] if r["path"].endswith("result.json"))
    assert row["bytes"] == len(payload)
    assert row["sha256"] == hashlib.sha256(payload).hexdigest()
    assert row["gitBlobSha"] == hashlib.sha1(b"blob " + str(len(payload)).encode() + b"\0" + payload).hexdigest()
    assert row["extension"] == ".json"
    assert row["payloadKind"] == "REPORT"
    assert row["reportFamily"] == "result"
    assert row["migrationCandidate"] == "KEEP_IN_GIT"
    assert first["summary"]["files"] == 2
    assert file.read_bytes() == b"uncommitted changes\r\n"


def test_nature_not_size_classifies_json():
    # A large canonical conclusion is still a report, not raw generated data.
    profile, _ = json_profile({"conclusion": "evidence " * 200000, "metrics": {"precision": .99}})
    assert profile["compactBytes"] > 1024 * 1024
    assert classify("final.json", profile)[0] == "REPORT"
    profile, _ = json_profile({"tensor": list(range(400))})
    assert classify("small.json", profile)[0] == "BULK_PAYLOAD"
    profile, _ = json_profile({"final": {"verdict": "PASS"}, "tensor": list(range(400))})
    assert classify("canonical.json", profile)[0] == "REPORT"
    profile, _ = json_profile({"receipts": [{"timeMs": i, "frame": i} for i in range(80)]})
    assert classify("trace.json", profile)[0] == "BULK_PAYLOAD"
    profile, _ = json_profile({"rows": [{"processingStartTimestamp": i,
                              "publicationFinishTimestamp": i + 1} for i in range(80)]})
    assert classify("measurements.json", profile)[0] == "BULK_PAYLOAD"
    assert classify("tiny.f32", None)[0] == "BULK_PAYLOAD"
    assert classify("small.wav", None)[0] == "BULK_PAYLOAD"
    assert classify("support.log", None)[0] == "SUPPORTING_EVIDENCE"


def test_active_evidence_history_and_absent_references(repo):
    prefix = "backend/research/reports/demo/"
    for name in ["active.json", "historical.json", "none.json", "documented.json"]:
        write(repo, prefix + name, b'{"result":"pass"}')
    write(repo, "backend/research/tools/check.py", (f"load('{prefix}active.json')\n" * 2).encode())
    write(repo, "backend/research/history/closed/check.py", f"load('{prefix}historical.json')".encode())
    write(repo, "backend/research/reports/receipt.json", json.dumps({"file": prefix + "active.json"}).encode())
    write(repo, "docs/result.md", (prefix + "documented.json").encode())
    commit(repo)
    rows = {Path(r["path"]).name: r for r in inventory(repo)["files"]}
    assert rows["active.json"]["referenceStatus"] == "ACTIVE_SOURCE_REFERENCE"
    assert rows["active.json"]["activeConsumerCount"] == 1
    assert rows["active.json"]["evidenceOnlyConsumerCount"] == 1
    assert rows["historical.json"]["referenceStatus"] == "EVIDENCE_REFERENCE"
    assert rows["historical.json"]["activeConsumerCount"] == 0
    assert rows["none.json"]["referenceStatus"] == "NO_TRACKED_REFERENCE"
    assert rows["documented.json"]["referenceStatus"] == "OTHER_TRACKED_REFERENCE"


def test_relative_reference_and_duplicate_basenames(repo):
    write(repo, "backend/research/reports/one/manifest.json", b'{"path":"tensor.f32"}')
    write(repo, "backend/research/reports/one/tensor.f32", b"1111")
    write(repo, "backend/research/reports/two/tensor.f32", b"2222")
    write(repo, "backend/research/tools/check.py", b"load('tensor.f32')")
    commit(repo)
    rows = {r["path"]: r for r in inventory(repo)["files"]}
    assert rows["backend/research/reports/one/tensor.f32"]["evidenceOnlyConsumerCount"] == 1
    assert rows["backend/research/reports/two/tensor.f32"]["referenceStatus"] == "NO_TRACKED_REFERENCE"
    assert not any(r["activeConsumerCount"] for r in rows.values())
    write(repo, "backend/research/tools/relative.py", b"load('../reports/two/tensor.f32')")
    commit(repo)
    rows = {r["path"]: r for r in inventory(repo)["files"]}
    assert rows["backend/research/reports/two/tensor.f32"]["activeConsumerCount"] == 1


def test_common_names_elsewhere_are_not_report_consumers(repo):
    write(repo, "backend/research/reports/guide.md", b"storage rules")
    write(repo, "guide.md", b"repository docs")
    write(repo, "backend/research/tools/check.py", b"read('guide.md')")
    write(repo, "backend/research/reports/old.json", b'{"upstreamFiles":["guide.md"]}')
    write(repo, "backend/research/guide.md", b"[storage](reports/guide.md)")
    commit(repo)
    row = next(r for r in inventory(repo)["files"] if r["path"] == "backend/research/reports/guide.md")
    assert row["referenceStatus"] == "OTHER_TRACKED_REFERENCE"
    assert row["activeConsumerCount"] == 0
    assert row["evidenceOnlyConsumerCount"] == 0


def test_identity_candidates_and_duplicate_accounting(repo):
    payload = b"\x00\x00\x80\x3f" * 12
    digest = hashlib.sha256(payload).hexdigest()
    prefix = "backend/research/reports/raw/"
    write(repo, prefix + "a.f32", payload)
    write(repo, prefix + "b.f32", payload)
    write(repo, prefix + "unknown.f32", b"different")
    write(repo, prefix + "manifest.json", json.dumps({"file": {"path": prefix + "a.f32",
          "bytes": len(payload), "sha256": digest}}).encode())
    commit(repo)
    result = inventory(repo)
    rows = {Path(r["path"]).name: r for r in result["files"]}
    assert rows["a.f32"]["migrationCandidate"] == "EXTERNALIZATION_CANDIDATE"
    assert rows["b.f32"]["compactIdentityRecords"][0]["recordedPath"] == prefix + "a.f32"
    assert rows["a.f32"]["currentReproducibility"] == "NOT_ESTABLISHED"
    assert rows["unknown.f32"]["migrationCandidate"] == "NEEDS_MANUAL_CLASSIFICATION"
    assert result["summary"]["duplicates"] == {"groups": 1, "fileCount": 2,
        "trackedBytes": 2 * len(payload), "potentialRedundantBytes": len(payload)}
    assert len(result["duplicateContentGroups"]) == 1
    write(repo, "backend/research/tests/test_reader.py", (prefix + "a.f32").encode())
    commit(repo)
    rows = {Path(r["path"]).name: r for r in inventory(repo)["files"]}
    assert rows["a.f32"]["migrationCandidate"] == "KEEP_IN_GIT"


def test_digest_without_matching_size_does_not_prove_identity(repo):
    payload = b"raw"
    write(repo, "backend/research/reports/raw.f32", payload)
    write(repo, "backend/research/reports/manifest.json", json.dumps({
        "sha256": hashlib.sha256(payload).hexdigest(), "bytes": 999}).encode())
    commit(repo)
    raw = next(r for r in inventory(repo)["files"] if r["extension"] == ".f32")
    assert raw["compactIdentityRecords"] == []
    assert raw["migrationCandidate"] == "NEEDS_MANUAL_CLASSIFICATION"


def test_cli_root_backend_stdout_and_output_protection(repo, tmp_path):
    write(repo, "backend/research/reports/summary.json", b"{}")
    commit(repo)
    script = Path(__file__).resolve().parents[1] / "tools/inventory_evidence_storage.py"
    commands = [str(script)]
    root = subprocess.check_output([sys.executable, *commands], cwd=repo)
    backend = subprocess.check_output([sys.executable, *commands], cwd=repo / "backend")
    assert json.loads(root) == json.loads(backend)
    output = repo / "diagnostic.json"
    subprocess.run([sys.executable, *commands, "--output", str(output)], cwd=repo, check=True)
    assert json.loads(output.read_bytes()) == json.loads(root)
    refused = subprocess.run([sys.executable, *commands, "--output", str(output)], cwd=repo, capture_output=True)
    assert refused.returncode != 0
    for location in ["reports/new.json", "history/new.json"]:
        refused = subprocess.run([sys.executable, *commands, "--output", str(repo / "backend/research" / location)], cwd=repo, capture_output=True)
        assert refused.returncode != 0
    assert (repo / "backend/research/reports/summary.json").read_bytes() == b"{}"

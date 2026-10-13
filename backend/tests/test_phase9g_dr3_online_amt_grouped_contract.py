from __future__ import annotations

import sys
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend" / "research"))

from online_amt_grouped_manifest_dr3 import GroupedGraphIdentity, build_grouped_browser_manifest  # noqa: E402


def graph(k: int, file: str | None = None) -> GroupedGraphIdentity:
    return GroupedGraphIdentity(
        k=k,
        file=f"online_amt_grouped_k{k}_opset18.onnx" if file is None else file,
        sha256=("0" * 63) + str(k),
        byte_size=1000 + k,
    )


def manifest() -> dict[str, object]:
    return build_grouped_browser_manifest(
        graphs={k: graph(k) for k in [1, 2, 4, 8]},
        k1_fallback=graph(1),
        hop_fixture="hops.npy",
        initial_state={"h": "initial_h.npy"},
        reference={"chosen": "reference_chosen.npy"},
        checkpoint_sha256="54ab4907b517dbfa2dbbee834db18d31d103ee25d690860595181162d235e3a0",
        ort_version="1.30.0",
    )


def test_grouped_manifest_binds_correct_k_graphs() -> None:
    result = manifest()
    grouped = result["graphs"]["grouped"]  # type: ignore[index]
    assert grouped["2"]["file"] == "online_amt_grouped_k2_opset18.onnx"
    assert grouped["4"]["file"] == "online_amt_grouped_k4_opset18.onnx"
    assert grouped["8"]["file"] == "online_amt_grouped_k8_opset18.onnx"
    assert result["graphs"]["k1Fallback"]["file"] == "online_amt_grouped_k1_opset18.onnx"  # type: ignore[index]


def test_grouped_manifest_rejects_null_graph_filename() -> None:
    graphs = {k: graph(k) for k in [1, 2, 4, 8]}
    graphs[2] = graph(2, "")
    with pytest.raises(ValueError, match="filename"):
        build_grouped_browser_manifest(
            graphs=graphs,
            k1_fallback=graph(1),
            hop_fixture="hops.npy",
            initial_state={},
            reference={},
            checkpoint_sha256="sha",
            ort_version="1.30.0",
        )


def test_grouped_manifest_rejects_routing_k_greater_than_one_through_k1_graph() -> None:
    graphs = {k: graph(k) for k in [1, 2, 4, 8]}
    graphs[4] = graph(4, "online_amt_grouped_k1_opset18.onnx")
    with pytest.raises(ValueError, match="K=4"):
        build_grouped_browser_manifest(
            graphs=graphs,
            k1_fallback=graph(1),
            hop_fixture="hops.npy",
            initial_state={},
            reference={},
            checkpoint_sha256="sha",
            ort_version="1.30.0",
        )


def test_grouped_worker_serializes_jobs_with_explicit_queue() -> None:
    worker = (REPO_ROOT / "backend/research/browser_runtime/online_amt_grouped_browser_worker_dr3.mjs").read_text(encoding="utf-8")
    assert "let chain = Promise.resolve()" in worker
    assert ".then(() => processGroup" in worker
    assert "outstandingPostedNotCompletedDepth" in worker
    assert "captureToPublicationAgeMs" in worker


def test_grouped_harness_producer_does_not_await_prior_completion_and_respects_group_ready_time() -> None:
    harness = (REPO_ROOT / "backend/research/browser_runtime/online_amt_grouped_browser_harness_dr3.mjs").read_text(encoding="utf-8")
    assert "producerDoesNotAwaitPriorCompletion: true" in harness
    assert "scheduledGroupReadyTimestamp = feedStartTimestamp + ((startHopIndex + hopCountInMessage) * 32)" in harness
    assert "buildGroupPlan()" in harness
    assert "hopCountInMessage = remaining >= K ? K : 1" in harness
    assert "futureAudioPostPolicy: 'GROUP_POSTS_AT_LAST_INTERNAL_HOP_READY'" in harness
    assert "overloadDetected" in harness


def test_browser_evidence_cannot_claim_pass_without_grouped_worker_result() -> None:
    harness = (REPO_ROOT / "backend/research/browser_runtime/online_amt_grouped_browser_harness_dr3.mjs").read_text(encoding="utf-8")
    assert "window.__DR3_RESULT__" in harness
    assert "online_amt_grouped_browser_worker_dr3.mjs" in harness
    assert "worker-combined" not in harness


def test_dr3r_entrypoint_does_not_subprocess_dr2_qualifier() -> None:
    source = (REPO_ROOT / "backend/scripts/qualify_online_amt_grouped_browser_dr3.py").read_text(encoding="utf-8")
    assert "backend/scripts/qualify_online_amt_grouped_browser_dr2.py" not in source
    assert "import qualify_online_amt_grouped_browser_dr2 as dr2" in source


def test_dr3r_entrypoint_refuses_host_runtime_before_scientific_execution() -> None:
    source = (REPO_ROOT / "backend/scripts/qualify_online_amt_grouped_browser_dr3.py").read_text(encoding="utf-8")
    assert "HOST_RUNTIME_FORBIDDEN_FOR_DR3R" in source
    assert "insideContainer" in source
    assert "has_drive_letter" in source


def test_grouped_worker_init_loads_real_ort_session_or_fails_closed() -> None:
    worker = (REPO_ROOT / "backend/research/browser_runtime/online_amt_grouped_browser_worker_dr3.mjs").read_text(encoding="utf-8")
    assert "ort.InferenceSession.create" in worker
    assert "CONTAINER_BROWSER_WEBGPU_UNAVAILABLE" in worker
    assert "executionProviders: ['webgpu']" in worker
    assert "REAL_GROUPED_MODEL_RUNTIME" in worker


def test_harness_group_messages_contain_pcm_and_overload_is_synthetic_only() -> None:
    harness = (REPO_ROOT / "backend/research/browser_runtime/online_amt_grouped_browser_harness_dr3.mjs").read_text(encoding="utf-8")
    assert "pcm: transfer" in harness
    assert "fetchNpy('hops.npy')" in harness
    assert "const HOP_SAMPLES" in harness
    assert "hopSamples !== 512" in harness
    assert "SYNTHETIC_QUEUE_INSTRUMENTATION_PROOF_ONLY" in (REPO_ROOT / "backend/research/browser_runtime/online_amt_grouped_browser_worker_dr3.mjs").read_text(encoding="utf-8")


def test_manifest_declares_full_fixture_hop_count_and_hop_samples() -> None:
    result = manifest()
    fixtures = result["fixtures"]  # type: ignore[index]
    assert fixtures["hopCount"] == 326
    assert fixtures["hopSamples"] == 512


def test_dr3r_decide_distinguishes_partial_ort_from_full_semantic_parity() -> None:
    source = (REPO_ROOT / "backend/scripts/qualify_online_amt_grouped_browser_dr3.py").read_text(encoding="utf-8")
    assert 'row.get("semanticHopCount") == 326' in source
    assert "ONLINE_AMT_GROUPED_SEMANTIC_PARITY_FAILED" in source


def test_worker_uses_start_hop_identity_and_loads_only_required_sessions() -> None:
    worker = (REPO_ROOT / "backend/research/browser_runtime/online_amt_grouped_browser_worker_dr3.mjs").read_text(encoding="utf-8")
    assert "startHopIndex" in worker
    assert "hopCountInMessage" in worker
    assert "requiredKeys = targetK === 1 ? ['1'] : ['1', String(targetK)]" in worker

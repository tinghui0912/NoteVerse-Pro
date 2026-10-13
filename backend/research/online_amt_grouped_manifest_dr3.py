from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class GroupedGraphIdentity:
    k: int
    file: str
    sha256: str
    byte_size: int


def build_grouped_browser_manifest(
    *,
    graphs: dict[int, GroupedGraphIdentity],
    k1_fallback: GroupedGraphIdentity,
    hop_fixture: str,
    initial_state: dict[str, str],
    reference: dict[str, str],
    checkpoint_sha256: str,
    ort_version: str,
) -> dict[str, Any]:
    if set(graphs) != {1, 2, 4, 8}:
        raise ValueError("DR3 grouped manifest must bind K=1,2,4,8 graphs.")
    if k1_fallback.k != 1:
        raise ValueError("DR3 grouped manifest fallback graph must be K=1.")
    grouped: dict[str, dict[str, Any]] = {}
    for k, graph in sorted(graphs.items()):
        validate_graph_identity(graph)
        if k != graph.k:
            raise ValueError(f"DR3 grouped manifest graph key {k} does not match identity K={graph.k}.")
        if k > 1 and Path(graph.file).name == Path(k1_fallback.file).name:
            raise ValueError(f"DR3 grouped manifest K={k} must not point to the K=1 fallback graph.")
        grouped[str(k)] = {
            "k": graph.k,
            "file": graph.file,
            "sha256": graph.sha256,
            "bytes": graph.byte_size,
            "inputContract": "audio_last_2048_sequence plus recurrent state",
            "outputContract": "per-hop probabilities/chosen states plus final recurrent state",
        }
    return {
        "schemaVersion": 1,
        "artifact": "phase9g_dr3_online_amt_grouped_browser_manifest",
        "graphs": {
            "grouped": grouped,
            "k1Fallback": {
                "k": k1_fallback.k,
                "file": k1_fallback.file,
                "sha256": k1_fallback.sha256,
                "bytes": k1_fallback.byte_size,
            },
        },
        "fixtures": {
            "hops": hop_fixture,
            "initialState": initial_state,
            "reference": reference,
        },
        "checkpointSha256": checkpoint_sha256,
        "ortTarget": {
            "package": "onnxruntime-web",
            "version": ort_version,
            "executionProvider": "webgpu",
            "wasmFallback": False,
            "unsafeWebGpuFlag": False,
        },
    }


def validate_graph_identity(graph: GroupedGraphIdentity) -> None:
    if graph.k not in {1, 2, 4, 8}:
        raise ValueError("DR3 grouped graph K must be one of 1,2,4,8.")
    if not graph.file or Path(graph.file).name != graph.file:
        raise ValueError("DR3 grouped graph filename must be a non-empty basename.")
    if not graph.file.endswith(".onnx"):
        raise ValueError("DR3 grouped graph filename must be an ONNX file.")
    if len(graph.sha256) != 64 or any(ch not in "0123456789abcdef" for ch in graph.sha256):
        raise ValueError("DR3 grouped graph SHA must be lowercase SHA256 hex.")
    if graph.byte_size <= 0:
        raise ValueError("DR3 grouped graph byte size must be positive.")

import json
import shutil
import subprocess
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[3]


def run_node_snippet(source: str) -> dict:
    if shutil.which("node") is None:
        pytest.skip("Node.js is required for browser-runtime module semantic tests.")
    completed = subprocess.run(
        ["node", "--input-type=module", "-e", source],
        cwd=REPO_ROOT,
        check=True,
        text=True,
        capture_output=True,
    )
    return json.loads(completed.stdout)


def test_robust_decoder_contiguous_peak_and_100hz_absolute_time_mapping():
    result = run_node_snippet(
        """
import { decodeRobustRawOutputs } from './backend/research/browser_runtime/xc1_robust_decoder.mjs';
const frames = 12;
const pitches = 88;
const reg = new Float32Array(frames * pitches);
const frame = new Float32Array(frames * pitches);
function set(frameIndex, pitchIndex, onset, support) {
  reg[frameIndex * pitches + pitchIndex] = onset;
  frame[frameIndex * pitches + pitchIndex] = support;
}
set(0, 0, 0.7, 0.8);
set(3, 10, 0.31, 0.8);
set(4, 10, 0.9, 0.8);
set(5, 10, 0.5, 0.8);
set(8, 12, 0.85, 0.01);
set(11, 20, 0.6, 0.7);
const events = decodeRobustRawOutputs({
  regData: reg,
  frameData: frame,
  dims: [1, frames, pitches],
  inputWindowStartMs: 1200,
  sampleRateHz: 16000,
  takeId: 'fixture',
  windowId: 'owned_2200',
});
console.log(JSON.stringify({ events }));
"""
    )
    events = result["events"]
    assert [(event["pitch"], event["peakFrame"], event["performanceTimeMs"]) for event in events] == [
        (21, 0, 1200),
        (31, 4, 1240),
        (41, 11, 1310),
    ]


def test_stage_a_synthetic_fixture_requires_multiple_ownership_windows():
    result = run_node_snippet(
        """
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { materializeSyntheticStageARoot } from './backend/research/browser_runtime/xc1_browser_runtime_shared.mjs';
import { planOwnedWindows } from './backend/research/browser_runtime/xc1_robust_decoder.mjs';
const root = await mkdtemp(path.join(os.tmpdir(), 'xc1-r3c-stage-a-'));
try {
  const fixture = await materializeSyntheticStageARoot({ root });
  const durationMs = fixture.take.canonicalPcm.sampleCount / 16000 * 1000;
  const windows = planOwnedWindows({
    durationMs,
    scoreableStartMs: fixture.take.scoreableInterior.startMs,
    scoreableEndMs: fixture.take.scoreableInterior.endMs,
  });
  console.log(JSON.stringify({ sampleCount: fixture.take.canonicalPcm.sampleCount, windowCount: windows.length }));
} finally {
  await rm(root, { recursive: true, force: true });
}
"""
    )
    assert result["sampleCount"] == 67200
    assert result["windowCount"] > 1

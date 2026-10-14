import json
import sys
from pathlib import Path
import numpy as np
from backend.scripts.phase9g_xc1_r3d_stage_b import container_guard, write_immutable
from backend.research.xc1_scientific_bakeoff import sha256_file

ROOT = Path(__file__).resolve().parents[2]
def main():
    container_guard()
    gate = '--gate' in sys.argv
    fixture_root = ROOT / ('backend/data/work/phase9g_dr3r1h/gate_fixture' if gate else 'backend/data/work/phase9g_dr3r1h/fixtures')
    root = ROOT / ('backend/data/work/xc1_r3d_validation/gate_fixture' if gate else 'backend/data/work/xc1_r3d_validation/reference_fixture')
    (root / 'audio').mkdir(parents=True, exist_ok=True)
    hops = np.load(fixture_root / 'hops.npy').astype('<f4').reshape(-1)
    pcm = root / 'audio/input.pcm'
    hops.tofile(pcm)
    manifest = { 'fixtureClass': 'NON_SMD_GATE' if gate else 'NON_SMD_REFERENCE_P07', 'takes': [{ 'takeId': 'non-smd-gate' if gate else 'non-smd-reference-p07',
        'sourceAcousticWavSha256': 'historical-non-protected-p07-reference', 'canonicalPcm': {
            'relativeStageAPath': 'audio/input.pcm', 'sha256': sha256_file(pcm), 'byteSize': pcm.stat().st_size,
            'sampleCount': len(hops), 'sampleRateHz': 16000, 'dtype': 'float32-le-raw' },
        'scoreableInterior': { 'startMs': 1000, 'endMs': len(hops) / 16 - 220 } }] }
    write_immutable(root / 'manifest.json', manifest)

if __name__ == '__main__':
    main()

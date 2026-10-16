"""Docker-only audio/coefficient/reference preparation; never loads models or MIDI."""
import hashlib
import io
import json
from pathlib import Path
import wave
import zipfile

import numpy as np
import scipy
from scipy.signal import firwin, resample_poly

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'backend/data/work/xc2_r1_bounded_runtime'


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('xb') as handle:
        handle.write(data)
    return {'path': path.relative_to(ROOT).as_posix(), 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}


def main():
    if not Path('/.dockerenv').exists() or scipy.__version__ != '1.14.1' or np.__version__ != '1.26.4':
        raise RuntimeError('DOCKER_PINNED_SCIENCE_REQUIRED')
    h = (firwin(8821, 1 / 441, window=('kaiser', 5.0)).astype(np.float32) * np.float32(160)).astype('<f4')
    coefficients = write(OUT / 'audio_only/fir_160_441.f32', h.tobytes())
    manifest = json.loads((ROOT / 'backend/data/work/xc2_robust_product_baseline_v1/audio_only/manifest.json').read_text())
    takes = json.loads((ROOT / 'backend/research/reports/phase9g_xc1_r3d_full_take_manifest_f5_stream_2026-10-15.json').read_text())['takes']
    selected = sorted(manifest['clips'], key=lambda c: c['clipId'])[:3]
    rows = []
    with zipfile.ZipFile(ROOT / 'backend/data/work/smd_v2/SMD-piano_v2.zip') as archive:
        for clip in selected:
            take = next(t for t in takes if t['takeId'] == clip['takeId'])
            data = archive.read(take['acousticWavRelativePath'])
            if hashlib.sha256(data).hexdigest() != clip['sourceWavSha256']:
                raise ValueError('WAV_IDENTITY_DRIFT')
            with wave.open(io.BytesIO(data)) as wav:
                if (wav.getframerate(), wav.getnchannels(), wav.getsampwidth()) != (44100, 2, 2):
                    raise ValueError('SOURCE_FORMAT')
                wav.setpos((clip['sourceStartSeconds'] - 1) * 44100)
                stereo = np.frombuffer(wav.readframes(30 * 44100), dtype='<i2').reshape(-1, 2)
            mono = (stereo.astype(np.float32) / np.float32(32768)).astype(np.float64).mean(axis=1).astype('<f4')
            source = write(OUT / f'audio_only/{clip["clipId"]}_guarded_44100.f32', mono.tobytes())
            source.update(samples=len(mono), sampleRateHz=44100, dtype='float32-le', clipOffsetSamples=44100)
            reference = resample_poly(mono, 160, 441, window=('kaiser', 5.0), padtype='constant', cval=0).astype('<f4')
            expected = (ROOT / clip['pcm']['BAND_LIMITED']['path'].replace('\\', '/')).read_bytes()
            if reference[16000:464000].tobytes() != expected:
                raise ValueError('EXISTING_BAND_PCM_DISAGREEMENT')
            rows.append({'clip': clip, 'guardedSource': source})
    rng = np.random.default_rng(13371)
    fixtures = []
    for length in [1, 2, 27, 28, 127, 441, 1001, 44100]:
        for kind in ['impulse', 'noise', 'sine']:
            x = (rng.uniform(-1, 1, length) if kind == 'noise' else np.sin(np.arange(length) * 2 * np.pi * 997 / 44100) if kind == 'sine' else np.eye(1, length, length // 2)[0]).astype('<f4')
            y = resample_poly(x, 160, 441, window=('kaiser', 5.0), padtype='constant', cval=0).astype('<f4')
            fixtures.append({'id': f'{kind}_{length}', 'source': write(OUT / f'fixtures/{kind}_{length}_in.f32', x.tobytes()),
                             'reference': write(OUT / f'fixtures/{kind}_{length}_out.f32', y.tobytes())})
    write(OUT / 'preparation.json', (json.dumps({'coefficients': coefficients, 'runtimeClips': rows, 'fixtures': fixtures,
          'numpy': np.__version__, 'scipy': scipy.__version__, 'midiOpened': False, 'modelInference': False}, sort_keys=True) + '\n').encode())


if __name__ == '__main__':
    main()

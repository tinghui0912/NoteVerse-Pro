"""Docker-only XC2 audio preparation and downstream counterfactual construction."""
from __future__ import annotations
import argparse
import hashlib
import io
import json
import platform
import re
import wave
import zipfile
from pathlib import Path

import numpy as np
import scipy
from scipy.signal import resample_poly

from backend.scripts.bytedance_pcm_preprocessing import extract_resample_linear

ROOT = Path(__file__).resolve().parents[2]
PHASE = 'PHASE_9G_XC2_ROBUST_PRODUCT_VERDICT_AND_LATENCY_BASELINE'
FAMILIES = ['CORRECT_SINGLE', 'CORRECT_CHORD', 'MISSING_SINGLE', 'WRONG_SEMITONE',
            'INCOMPLETE_CHORD', 'EXTRA_NOTE', 'SAME_PITCH_RETRIGGER', 'SUSTAINED_NO_RETRIGGER']


def sha(data):
    return hashlib.sha256(data).hexdigest()


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf8') as handle:
        json.dump(value, handle, indent=2, sort_keys=True, allow_nan=False)
        handle.write('\n')


def prepare(output):
    if scipy.__version__ != '1.14.1' or np.__version__ != '1.26.4':
        raise ValueError('XC2_PREPROCESS_VERSION_DRIFT')
    manifest = json.loads((ROOT / 'backend/research/reports/phase9g_xc1_r3d_full_take_manifest_f5_stream_2026-10-15.json').read_text())
    ordered = sorted(manifest['takes'], key=lambda take: sha(('XC2_METADATA_SELECTION_V1:' + take['takeId']).encode()))
    chosen, works = [], set()
    for take in ordered:
        selection_work = re.sub(r'_\d{2}$', '', take['workId'])
        if selection_work in works or take['audioDurationSeconds'] < 30:
            continue
        works.add(selection_work)
        chosen.append(take)
        if len(chosen) == 10:
            break
    archive_path = ROOT / 'backend/data/work/smd_v2/SMD-piano_v2.zip'
    rows = []
    with zipfile.ZipFile(archive_path) as archive:
        for index, take in enumerate(chosen):
            data = archive.read(take['acousticWavRelativePath'])
            if sha(data) != take['acousticWavSha256']:
                raise ValueError('SOURCE_WAV_IDENTITY_DRIFT')
            with wave.open(io.BytesIO(data)) as wav:
                rate, channels = wav.getframerate(), wav.getnchannels()
                if wav.getsampwidth() != 2 or rate != 44100 or channels != 2:
                    raise ValueError('EXPECTED_PCM16_44100_STEREO')
                source = np.frombuffer(wav.readframes(wav.getnframes()), dtype='<i2').reshape(-1, channels)
            start_seconds = int((take['audioDurationSeconds'] - 28) // 2)
            segment = source[start_seconds * rate:(start_seconds + 28) * rate]
            # Float32 PCM16 conversion, float64 arithmetic mean, cast back to float32;
            # identical to the F3/F5 source mono path. No normalization.
            mono = (segment.astype(np.float32) / np.float32(32768)).astype(np.float64).mean(axis=1).astype(np.float32)
            linear = extract_resample_linear(mono, rate, 0, 28000, 448000)
            # Real samples from the surrounding recording supply FIR boundary context.
            padding = rate
            left = max(0, start_seconds * rate - padding)
            right = min(source.shape[0], (start_seconds + 28) * rate + padding)
            extended = (source[left:right].astype(np.float32) / np.float32(32768)).astype(np.float64).mean(axis=1).astype(np.float32)
            band = resample_poly(extended, 160, 441, window=('kaiser', 5.0), padtype='constant', cval=0.0)
            offset = round((start_seconds * rate - left) * 16000 / rate)
            band = band[offset:offset + 448000].astype(np.float32)
            pcm = {}
            clip_id = f'xc2_{index:02d}_{take["takeId"]}'
            for label, array in [('LINEAR', linear), ('BAND_LIMITED', band)]:
                if len(array) != 448000 or not np.isfinite(array).all():
                    raise ValueError('INVALID_CANONICAL_PCM')
                path = Path(output) / 'audio_only' / f'{clip_id}_{label}.f32'
                path.parent.mkdir(parents=True, exist_ok=True)
                with path.open('xb') as handle:
                    handle.write(array.astype('<f4').tobytes())
                pcm[label] = {'path': str(path.relative_to(ROOT)), 'sha256': sha(path.read_bytes()),
                              'bytes': path.stat().st_size, 'samples': len(array), 'sampleRateHz': 16000,
                              'dtype': 'float32-le', 'peakAbs': float(np.max(np.abs(array))),
                              'samplesOverUnitMagnitude': int(np.sum(np.abs(array) > 1.0))}
            rows.append({'clipId': clip_id, 'takeId': take['takeId'], 'workId': take['workId'],
                         'workSelectionGroup': re.sub(r'_\d{2}$', '', take['workId']),
                         'split': 'DEVELOPMENT' if index % 2 == 0 else 'EVALUATION',
                         'sourceStartSeconds': start_seconds, 'durationMs': 28000,
                         'sourceWavSha256': take['acousticWavSha256'], 'pcm': pcm,
                         'physicalMidi': {'path': take['midiRelativePath'], 'sha256': take['midiSha256']}})
    save(Path(output) / 'full_manifest.json', {'phase': PHASE, 'clips': rows,
         'selection': 'First ten distinct conservative filename work-prefix groups (strip terminal _NN movement/collection-item suffix from workId), ordered by SHA256(XC2_METADATA_SELECTION_V1:takeId), alternate DEVELOPMENT/EVALUATION; center 28s, integer-second start. No performer identity claim.',
         'sourceArchive': str(archive_path.relative_to(ROOT)),
         'preprocessing': {'numpy': np.__version__, 'scipy': scipy.__version__, 'mixing': 'float32(int16/32768) -> float64 channel arithmetic mean -> float32',
                          'linear': 'extract_resample_linear: np.linspace endpoint=False, exactly 448000 float32 samples',
                          'bandLimited': 'scipy.signal.resample_poly, up=160/down=441, Kaiser beta=5.0, default FIR length 20*max(up,down)+1, float32 computation, constant-zero outside extended real +/-1s source; crop exact 28s',
                          'gainNormalization': False, 'timeMapping': 'sourceStartSeconds + outputIndex/16000; zero additional alignment'}})
    save(Path(output) / 'audio_only/manifest.json', {'phase': PHASE, 'clips': [
        {key: value for key, value in row.items() if key not in ['physicalMidi']} for row in rows]})


def build_scenarios(notes, clip_id):
    active = [note for note in notes if 1380 <= note['timeMs'] < 27780]
    groups = []
    for note in active:
        if not groups or note['timeMs'] - groups[-1]['timeMs'] > 20 or note['pitch'] in [n['pitch'] for n in groups[-1]['notes']]:
            groups.append({'id': f'{clip_id}:g{len(groups)}', 'timeMs': note['timeMs'], 'notes': []})
        groups[-1]['notes'].append(note)
    def absent(time, occupied):
        return next((pitch for pitch in range(60, 109) if pitch not in occupied and not any(
            n['pitch'] == pitch and abs(n['timeMs'] - time) <= 250 for n in notes)), None)
    base = [{'strikeId': f'{group["id"]}:s{i}', 'groupId': group['id'], 'pitch': n['pitch'],
             'timeMs': n['timeMs']} for group in groups for i, n in enumerate(group['notes'])]
    result = []
    for family in FAMILIES:
        for group in groups:
            if not 1500 <= group['timeMs'] < 26500: continue
            physical = group['notes']; selected = physical[0]
            if family == 'CORRECT_SINGLE' and len(physical) != 1: continue
            if family in ['CORRECT_CHORD', 'INCOMPLETE_CHORD'] and len(physical) < 2: continue
            targets, extra = [group['id']], []
            expected = [dict(strike) for strike in base]
            expected_label = 'CORRECT'
            if family == 'MISSING_SINGLE':
                pitch = absent(group['timeMs'], [])
                if pitch is None: continue
                gid = group['id'] + ':missing'
                expected.append({'strikeId': gid + ':s0', 'groupId': gid, 'pitch': pitch, 'timeMs': group['timeMs']})
                targets, expected_label = [gid], 'MISSING'
            elif family == 'WRONG_SEMITONE':
                pitch = selected['pitch'] + 1
                if pitch > 108 or pitch in [n['pitch'] for n in physical] or any(n['pitch'] == pitch and abs(n['timeMs'] - selected['timeMs']) <= 250 for n in notes): continue
                next(strike for strike in expected if strike['strikeId'] == group['id'] + ':s0')['pitch'] = pitch
                expected_label = 'WRONG'
            elif family == 'INCOMPLETE_CHORD':
                pitch = absent(group['timeMs'], [n['pitch'] for n in physical])
                if pitch is None: continue
                expected.append({'strikeId': group['id'] + ':added', 'groupId': group['id'], 'pitch': pitch, 'timeMs': group['timeMs']})
                expected_label = 'INCOMPLETE_CHORD'
            elif family == 'EXTRA_NOTE':
                expected = [strike for strike in expected if strike['strikeId'] != group['id'] + ':s0']
                targets, extra, expected_label = [], [selected], 'EXTRA'
            elif family == 'SAME_PITCH_RETRIGGER':
                later = next((g for g in groups if g['timeMs'] > group['timeMs'] and g['timeMs'] - group['timeMs'] <= 500
                              and any(n['pitch'] == selected['pitch'] for n in g['notes'])), None)
                if later is None: continue
                targets.append(later['id'])
            elif family == 'SUSTAINED_NO_RETRIGGER':
                if selected['endMs'] - selected['timeMs'] < 700 or any(n['pitch'] == selected['pitch'] and selected['timeMs'] < n['timeMs'] < selected['endMs'] for n in notes): continue
            result.append({'id': f'{clip_id}:{family}:{len([s for s in result if s["family"] == family])}',
                           'clipId': clip_id, 'family': family, 'expected': expected, 'targetGroupIds': targets,
                           'targetExtra': extra, 'conceptualTargetVerdict': expected_label,
                           'anchorPhysicalNote': selected, 'fixedBpm': 120,
                           'beatPositions': [strike['timeMs'] * 120 / 60000 for strike in expected]})
            if sum(item['family'] == family for item in result) >= 8: break
    return result


def truth(output, split):
    import pretty_midi
    manifest = json.loads((Path(output) / 'full_manifest.json').read_text())
    # Caller seals the entire requested acoustic split before this downstream CLI.
    seal = json.loads((Path(output) / f'{split.lower()}_truth_permission.json').read_text())
    if seal['status'] != 'ACOUSTIC_PREDICTIONS_SEALED' or seal['split'] != split:
        raise ValueError('XC2_TRUTH_GATE_REQUIRED')
    expected_clips = {clip['clipId'] for clip in manifest['clips'] if clip['split'] == split}
    sealed_clips = set()
    for receipt in seal['rawArtifacts']:
        artifact_path = ROOT / receipt['path']
        if sha(artifact_path.read_bytes()) != receipt['sha256']:
            raise ValueError('XC2_SEALED_ACOUSTIC_ARTIFACT_CHANGED')
        artifact = json.loads(artifact_path.read_text())
        if artifact['status'] != 'REAL_AUDIO_ONLY_BROWSER_EXECUTION_COMPLETE' or artifact['runtime']['actualSessionRunCount'] <= 0:
            raise ValueError('XC2_REAL_MODEL_EXECUTION_REQUIRED')
        for tensor in artifact['rawWindows']:
            for file_key, hash_key in [('onsetPath', 'onsetSha256'), ('framePath', 'frameSha256')]:
                if sha((ROOT / tensor[file_key]).read_bytes()) != tensor[hash_key]:
                    raise ValueError('XC2_SEALED_RAW_TENSOR_CHANGED')
        sealed_clips.add(artifact['clipId'])
    if sealed_clips != expected_clips:
        raise ValueError('XC2_TRUTH_GATE_CLIP_COVERAGE')
    rows = []
    with zipfile.ZipFile(ROOT / manifest['sourceArchive']) as archive:
        for clip in manifest['clips']:
            if clip['split'] != split: continue
            data = archive.read(clip['physicalMidi']['path'])
            if sha(data) != clip['physicalMidi']['sha256']: raise ValueError('MIDI_IDENTITY_DRIFT')
            midi = pretty_midi.PrettyMIDI(io.BytesIO(data))
            start = clip['sourceStartSeconds'] * 1000
            notes = sorted([{'pitch': note.pitch, 'timeMs': note.start * 1000 - start, 'endMs': note.end * 1000 - start}
                            for instrument in midi.instruments if not instrument.is_drum for note in instrument.notes
                            if note.velocity > 0 and 21 <= note.pitch <= 108 and start <= note.start * 1000 < start + 28000],
                           key=lambda n: (n['timeMs'], n['pitch'], n['endMs']))
            for i, note in enumerate(notes): note['id'] = f'{clip["clipId"]}:physical:{i}'
            rows.append({'clipId': clip['clipId'], 'physicalMidi': clip['physicalMidi'], 'notes': notes,
                         'scenarios': build_scenarios(notes, clip['clipId'])})
    save(Path(output) / f'{split.lower()}_truth.json', {'phase': PHASE, 'split': split, 'additionalAlignmentMs': 0, 'clips': rows})


if __name__ == '__main__':
    if platform.system() != 'Linux' or not Path('/.dockerenv').exists(): raise RuntimeError('HOST_SCIENCE_FORBIDDEN')
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['prepare', 'truth'])
    parser.add_argument('--output', required=True)
    parser.add_argument('--split', choices=['DEVELOPMENT', 'EVALUATION'])
    args = parser.parse_args()
    prepare(args.output) if args.command == 'prepare' else truth(args.output, args.split)

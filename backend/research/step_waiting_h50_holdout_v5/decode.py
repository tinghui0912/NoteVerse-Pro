"""Exactly one frozen decoder, fresh processes, no fallback or audio adjustment."""
import sys
import subprocess
from contracts import *


def deterministic(rows, minimum=3):
    keys = ('nativeSampleRate', 'channels', 'frames', 'monoPcmSha256')
    if len(rows) < minimum or len({tuple(r[k] for k in keys) for r in rows}) != 1:
        raise ValueError('STEP_WAITING_H50_SELECTED_AUDIO_DECODER_DETERMINISM_NOT_ESTABLISHED')


def one(ident, trial):
    proof = require_protocol(); started = now()
    contract = read(HERE / 'decoder-contract.json')
    if contract['fallback'] or contract['implementation'] != 'python-soundfile/libsndfile': raise ValueError('DECODER_FALLBACK_REJECTED')
    import numpy as np
    import soundfile as sf
    if sf.__version__ != contract['environment']['soundfile'] or sf.__libsndfile_version__ != contract['environment']['libsndfile']:
        raise ValueError('FROZEN_DECODER_RUNTIME_CHANGED')
    source = read(OUT / 'selected-truth-and-sources.json')['sources'][ident]
    if ident in SELECTED:
        acquired = next(r for r in read(OUT / 'audio-acquisition.json')['objects'] if r['recordingId'] == ident)
        path = ROOT / acquired['localPath']; data = path.read_bytes()
        if digest(data) != acquired['audioSha256']: raise ValueError('AUDIO_BYTES_CHANGED')
        check_object(ident, acquired['path'], data)
        audio_sha = acquired['audioSha256']
    else:
        path = ROOT / source['audio']['path']; audio_sha = source['audio']['sha256']
        if digest(path.read_bytes()) != audio_sha: raise ValueError('VIENNA_AUDIO_BYTES_CHANGED')
    # This is the first and sole selected-audio decoding implementation.
    with sf.SoundFile(path) as audio:
        rate, channels, frames, fmt, subtype = audio.samplerate, audio.channels, audio.frames, audio.format, audio.subtype
        pcm = audio.read(dtype='float32', always_2d=True)
    if pcm.shape != (frames, channels) or not np.isfinite(pcm).all(): raise ValueError('DECODE_GEOMETRY_INVALID')
    mono = pcm.mean(axis=1, dtype=np.float32).astype('<f4')
    mono_bytes = mono.tobytes(); pcm_path = WORK / 'decoded' / (ident + '.f32')
    if trial == 1:
        pcm_path.parent.mkdir(parents=True, exist_ok=True)
        with pcm_path.open('xb') as file: file.write(mono_bytes)
    result = dict(proof, executionStartedAt=started, completedAt=now(), recordingId=ident, trial=trial,
        audioSha256=audio_sha, decoderProtocolSha256=digest((HERE / 'decoder-contract.json').read_bytes()),
        nativeSampleRate=rate, channels=channels, frames=frames, monoPcmFrames=len(mono),
        decodedDurationSeconds=frames/rate, monoPcmSha256=digest(mono_bytes), pcmPath=pcm_path.relative_to(ROOT).as_posix(),
        format=fmt, subtype=subtype, alignmentTransformSeconds=0, newNeuralRuns=0)
    save(OUT / 'decode-trials' / (ident + '-' + str(trial) + '.json'), result)
    print({'recordingId': ident, 'trial': trial, 'rate': rate, 'frames': frames, 'channels': channels, 'monoPcmSha256': result['monoPcmSha256']})


def all_sources():
    require_protocol()
    sources = read(OUT / 'selected-truth-and-sources.json')['sources']
    output = {}
    for ident in sorted(sources):
        count = 3 if ident in SELECTED else 1
        for trial in range(1, count + 1):
            subprocess.run(['docker', 'run', '--rm', '--network', 'none', '-e', 'PYTHONDONTWRITEBYTECODE=1',
                '-v', str(ROOT) + ':/workspace', '-w', '/workspace', IMAGE, 'python',
                'backend/research/step_waiting_h50_holdout_v5/decode.py', 'one', ident, str(trial)], check=True)
        rows = [read(OUT / 'decode-trials' / (ident + '-' + str(i) + '.json')) for i in range(1, count + 1)]
        deterministic(rows, count)
        output[ident] = dict(rows[0], deterministicTrials=count, trialsIdentical=True)
    save(OUT / 'decoded-audio.json', {'sources': output, 'implementation': 'python-soundfile/libsndfile',
        'selectedMp3FreshProcessDecodes': 12, 'viennaWavDecodes': 4, 'newNeuralRuns': 0})


if __name__ == '__main__':
    if sys.argv[1] == 'one': one(sys.argv[2], int(sys.argv[3]))
    elif sys.argv[1] == 'all': all_sources()

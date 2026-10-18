"""Existing test-side rate conversion; immutable case binding, no inference."""
from math import gcd, floor, ceil
import numpy as np
import scipy
from scipy.signal import resample_poly
from contracts import *


def source_conversion(pcm, native, rate):
    if rate not in (44100, 48000): raise ValueError('UNQUALIFIED_FIXTURE_RATE')
    if native == rate: return pcm.copy()
    divisor = gcd(native, rate)
    return resample_poly(pcm, rate // divisor, native // divisor).astype('<f4')


def main():
    proof = require_protocol(); started = now()
    if scipy.__version__ != '1.14.1' or np.__version__ != '1.26.4': raise ValueError('FROZEN_PREPARATION_RUNTIME_CHANGED')
    selected = read(OUT / 'selected-truth-and-sources.json'); decoded = read(OUT / 'decoded-audio.json')['sources']
    acquisitions = {r['recordingId']: r for r in read(OUT / 'audio-acquisition.json')['objects']}
    context = {}; bound_cases = {}; jobs = []; source_trials = {}
    decoder_sha = digest((HERE / 'decoder-contract.json').read_bytes())
    for family, case in selected['cases'].items():
        ident = case['recordingId']; audio = decoded[ident]
        valid = context_valid(case, audio['decodedDurationSeconds']); context[family] = valid
        first = case['gestures'][0]['onsetMs']
        begin_ms = floor((first - 4350) / 20) * 20
        end_ms = ceil((valid['lastRequiredTruthTimeMs'] + 3000) / 20) * 20
        if begin_ms < 0 or end_ms > audio['decodedDurationSeconds'] * 1000: raise ValueError('FROZEN_CLIP_REAL_CONTEXT_INVALID')
        external = acquisitions.get(ident)
        binding = {'v4TruthTopologySealSha256': selected['v4TruthTopologySealSha256'], 'family': family,
            'truthSelectionIdentity': {'truthPairId': case.get('pair', {}).get('pairId'),
                'gestureIds': [g['gestureId'] for g in case['gestures']],
                'onsetsMs': [g['onsetMs'] for g in case['gestures']], 'guard': case.get('guard')},
            'recordingId': ident, 'midiSha256': case['midiSha256'],
            'upstreamRepositoryCommit': UPSTREAM if external else None,
            'upstreamAudioPath': external['path'] if external else selected['sources'][ident]['audio']['path'],
            'upstreamGitBlobSha1': external['actualGitBlobSha1'] if external else None,
            'audioSha256': audio['audioSha256'], 'decoderProtocolSha256': decoder_sha,
            'decodedPcmSha256': audio['monoPcmSha256']}
        bound_cases[family] = {'audioBoundCaseId': bound_identity(binding), 'binding': binding,
            'originalTruthCase': case, 'clipStartMs': begin_ms, 'clipEndMs': end_ms,
            'decodedOriginalSourceStartSample': begin_ms * audio['nativeSampleRate'] / 1000,
            'decodedOriginalSourceEndSample': end_ms * audio['nativeSampleRate'] / 1000,
            'context': valid}
    for ident, audio in decoded.items():
        pcm_bytes = (ROOT / audio['pcmPath']).read_bytes()
        if digest(pcm_bytes) != audio['monoPcmSha256']: raise ValueError('DECODED_PCM_CHANGED')
        pcm = np.frombuffer(pcm_bytes, dtype='<f4')
        for rate in (44100, 48000):
            converted = source_conversion(pcm, audio['nativeSampleRate'], rate)
            path = WORK / 'rates' / (ident + '-' + str(rate) + '.f32'); path.parent.mkdir(parents=True, exist_ok=True)
            data = converted.astype('<f4').tobytes()
            with path.open('xb') as file: file.write(data)
            trial = {'recordingId': ident, 'sourceRateHz': rate, 'nativeRate': audio['nativeSampleRate'],
                'decodedPcmSha256': audio['monoPcmSha256'], 'path': path.relative_to(ROOT).as_posix(),
                'sha256': digest(data), 'frames': len(converted), 'bytes': len(data),
                'conversion': 'native-direct' if audio['nativeSampleRate'] == rate else 'scipy1.14.1 resample_poly default Kaiser5 float32',
                'gainNormalization': False}
            source_trials[ident + '-' + str(rate)] = trial
            for family, bound in bound_cases.items():
                if bound['binding']['recordingId'] != ident: continue
                start = int(round(bound['clipStartMs'] * rate / 1000)); end = int(round(bound['clipEndMs'] * rate / 1000))
                if not 0 <= start < end <= len(converted): raise ValueError('REAL_CLIP_OUTSIDE_PREPARED_SOURCE')
                clip = converted[start:end].astype('<f4').tobytes()
                job_id = 'j-' + digest(canonical({'case': bound['audioBoundCaseId'], 'rate': rate}))[:24]
                clip_path = WORK / 'audio_only' / (job_id + '.f32'); clip_path.parent.mkdir(parents=True, exist_ok=True)
                with clip_path.open('xb') as file: file.write(clip)
                case = bound['originalTruthCase']
                jobs.append({'jobId': job_id, 'family': family, 'recordingId': ident, 'truthSelectionId': bound['binding']['truthSelectionIdentity'],
                    'audioBoundCaseId': bound['audioBoundCaseId'], 'audioSourceSha256': audio['audioSha256'],
                    'decodedPcmSha256': audio['monoPcmSha256'], 'sourceRateHz': rate,
                    'sourceRatePcmSha256': trial['sha256'], 'recordingPcmPath': trial['path'],
                    'clipPath': clip_path.relative_to(ROOT).as_posix(), 'clipPcmSha256': digest(clip),
                    'sourceOriginSample': start, 'sourceEndSample': end, 'sourceOriginTargetSample': start * 16000 // rate,
                    'originalAbsoluteMidiEventTimesMs': [g['onsetMs'] for g in case['gestures']],
                    'truthEventSourceSamples': [floor(g['onsetMs'] * rate / 1000 + .5) for g in case['gestures']],
                    'analysisRegionStartLocalTargetSample': 19200,
                    'originalRecordingSourceTimeRetained': True})
    save(OUT / 'audio-bound-cases.json', {'cases': bound_cases, 'alignmentTransformSeconds': 0,
        'v4TruthTopologySealSha256': selected['v4TruthTopologySealSha256'], 'v4IdentitiesRecomputed': False})
    save(OUT / 'actual-audio-context.json', dict(proof, executionStartedAt=started, cases=context, invalidCases=[]))
    save(OUT / 'source-rate-trials.json', dict(proof, executionStartedAt=started, completedAt=now(),
        sourceTrials=source_trials, jobs=jobs, totalCases=len(bound_cases), totalRateJobs=len(jobs),
        newNeuralRuns=0, alignmentTransformSeconds=0))
    print({'totalCases': len(bound_cases), 'totalRateJobs': len(jobs), 'sourceTrials': len(source_trials), 'newNeuralRuns': 0})


if __name__ == '__main__': main()

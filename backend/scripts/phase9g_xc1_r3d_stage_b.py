"""Docker-only truth reveal, sealed prediction scoring and scientific decision."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import platform
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import pretty_midi
import rfc8785

from backend.research.xc1_scientific_bakeoff import (
    OnsetEvent, score_take, paired_bootstrap, decide_front_runner, sha256_file, percentile,
)

PHASE = "PHASE_9G_XC1_R3D_F5_RECOVERY_AND_FULL_SEALED_BAKEOFF"
ROOT = Path(__file__).resolve().parents[2]
CANDIDATES = ["robust-browser-v1", "online-amt-k8-browser-v1", "basic-pitch-browser-v1"]


def container_guard():
    if platform.system() != "Linux" or not Path('/.dockerenv').exists():
        raise ValueError('HOST_SCIENTIFIC_RUNTIME_FORBIDDEN')
    return {"system": platform.system(), "python": sys.version, "executable": sys.executable,
            "containerEvidence": "/.dockerenv", "cwd": str(Path.cwd())}


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf8'))


def digest(value):
    return hashlib.sha256(rfc8785.dumps(value)).hexdigest()


def verify_canonical(value):
    if digest({key: item for key, item in value.items() if key != 'artifactCanonicalSha256'}) != value.get('artifactCanonicalSha256'):
        raise ValueError('XC1_ARTIFACT_CANONICAL_DIGEST_MISMATCH')


def write_immutable(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        raise ValueError('XC1_IMMUTABLE_RECEIPT_EXISTS')
    temp = path.with_suffix('.tmp')
    with temp.open('x', encoding='utf8') as handle:
        json.dump(value, handle, sort_keys=True, indent=2, allow_nan=False)
        handle.write('\n')
        handle.flush()
        os.fsync(handle.fileno())
    temp.rename(path)


def verify_seal(seal_path, manifest, commit, freeze_digest):
    seal = read_json(seal_path)
    verify_canonical(seal)
    if not seal.get('complete') or not seal.get('scoreable') or seal.get('f5Commit') != commit or seal.get('f5FreezeSha256') != freeze_digest:
        raise ValueError('XC1_STAGE_B_INVALID_SEAL')
    expected = {(candidate, take['takeId']) for candidate in CANDIDATES for take in manifest['takes']}
    takes = {take['takeId']: take for take in manifest['takes']}
    artifacts = {}
    for row in seal['cells']:
        key = (row['candidateId'], row['takeId'])
        if key not in expected:
            raise ValueError('XC1_SEAL_DUPLICATE_OR_UNKNOWN_CELL')
        expected.remove(key)
        path = (ROOT / row['artifactPath']).resolve()
        if ROOT not in path.parents or sha256_file(path) != row['artifactSha256']:
            raise ValueError('XC1_INVALID_EVALUATION_PREDICTION_CHANGED_AFTER_TRUTH_REVEAL')
        artifact = read_json(path)
        verify_canonical(artifact)
        if artifact.get('stage') != 'XC1_STAGE_A_SCIENTIFIC_PREDICTION' or artifact.get('status') != 'XC1_STAGE_A_SCIENTIFIC_PREDICTION_COMPLETE':
            raise ValueError('XC1_STAGE_B_REJECTS_FAILURE_OR_ACCEPTANCE')
        if (artifact.get('deploymentId'), artifact.get('takeId')) != key or artifact.get('f5Commit') != commit or artifact.get('f5FreezeSha256') != freeze_digest:
            raise ValueError('XC1_STAGE_B_F5_IDENTITY_MISMATCH')
        pcm = artifact['frozenAcousticInput']
        take = takes[key[1]]
        for actual, frozen in [('pcmSha256', 'sha256'), ('byteSize', 'byteSize'), ('sampleCount', 'sampleCount')]:
            if pcm[actual] != take['canonicalPcm'][frozen]:
                raise ValueError('XC1_STAGE_B_FROZEN_PCM_MISMATCH')
        if pcm['scoreableInterval'] != take['scoreableInterior']:
            raise ValueError('XC1_STAGE_B_INTERVAL_MISMATCH')
        artifacts[key] = artifact
    if expected:
        raise ValueError('XC1_SEAL_MISSING_CELL')
    return seal, artifacts


def midi_truth(zf, take):
    data = zf.read(take['midiRelativePath'])
    if hashlib.sha256(data).hexdigest() != take['midiSha256']:
        raise ValueError('XC1_SYNCHRONIZED_MIDI_IDENTITY_DRIFT')
    midi = pretty_midi.PrettyMIDI(io.BytesIO(data))
    interval = take['scoreableInterior']
    notes = sorted((note.start * 1000, note.pitch, instrument_index, note_index)
                   for instrument_index, instrument in enumerate(midi.instruments)
                   for note_index, note in enumerate(instrument.notes)
                   if not instrument.is_drum and note.velocity > 0 and 21 <= note.pitch <= 108
                   and interval['startMs'] <= note.start * 1000 < interval['endMs'])
    return [OnsetEvent(f"truth:{take['takeId']}:{ordinal}:{pitch}", pitch, time)
            for ordinal, (time, pitch, _, _) in enumerate(notes)]


def score_run(args):
    runtime_identity = container_guard()
    manifest = read_json(args.manifest)
    full_manifest = read_json(args.truth_manifest)
    if manifest.get('fixtureClass') != 'NON_SMD_SYNTHETIC':
        if not args.freeze:
            raise ValueError('XC1_STAGE_B_F5_FREEZE_REQUIRED')
        frozen = read_json(args.freeze)
        frozen_content = {key: value for key, value in frozen.items() if key != 'freezeSha256'}
        if digest(frozen_content) != args.f5_freeze_sha256 or frozen['freezeSha256'] != args.f5_freeze_sha256:
            raise ValueError('XC1_STAGE_B_FREEZE_DIGEST_MISMATCH')
        if sha256_file(Path(args.truth_manifest)) != frozen['truthManifestSha256'] or sha256_file(Path(args.archive)) != frozen['archiveSha256']:
            raise ValueError('XC1_STAGE_B_FROZEN_TRUTH_SOURCE_DRIFT')
        for file, expected_sha in frozen['sourceHashBoundary'].items():
            if sha256_file(ROOT / file) != expected_sha:
                raise ValueError('XC1_STAGE_B_FROZEN_SOURCE_DRIFT')
    full_takes = {take['takeId']: take for take in full_manifest['takes']}
    if set(full_takes) != {take['takeId'] for take in manifest['takes']}:
        raise ValueError('XC1_TRUTH_MANIFEST_COVERAGE_MISMATCH')
    seal, artifacts = verify_seal(args.seal, manifest, args.f5_commit, args.f5_freeze_sha256)
    if seal['manifestSha256'] != sha256_file(Path(args.manifest)):
        raise ValueError('XC1_STAGE_B_MANIFEST_DRIFT')
    measured = read_json(args.runtime)
    if measured.get('f5Commit') != args.f5_commit or measured.get('f5FreezeSha256') != args.f5_freeze_sha256:
        raise ValueError('XC1_RUNTIME_EVIDENCE_F5_MISMATCH')
    for candidate in CANDIDATES:
        row = measured['candidates'].get(candidate)
        if not row or not isinstance(row.get('runtimeEligible'), bool) or row.get('schedulingMode') != 'causal':
            raise ValueError('XC1_REAL_RUNTIME_EVIDENCE_REQUIRED')
        threshold = 204.8 if candidate == 'online-amt-k8-browser-v1' else 480
        receipts = row.get('receipts', [row])
        eligible = all(receipt.get('warmProcessingMs', {}).get('count', 0) >= 20
                       and receipt['warmProcessingMs']['p95'] <= threshold
                       and receipt.get('backlog', {}).get('status') == 'NO_SUSTAINED_BACKLOG'
                       for receipt in receipts)
        if row['runtimeEligible'] != eligible:
            raise ValueError('XC1_RUNTIME_ELIGIBILITY_RECEIPT_INCONSISTENT')
        for key, artifact in artifacts.items():
            if key[0] == candidate and row['xc1DeploymentIdentitySha256'] != artifact['xc1DeploymentIdentitySha256']:
                raise ValueError('XC1_RUNTIME_DEPLOYMENT_IDENTITY_MISMATCH')
    verification_timestamp = datetime.now(timezone.utc).isoformat()
    reveal = {"phase": PHASE, "f5Commit": args.f5_commit, "f5FreezeSha256": args.f5_freeze_sha256,
              "sealCanonicalSha256": seal['artifactCanonicalSha256'], "sealFilesystemSha256": sha256_file(Path(args.seal)),
              "sealVerificationTimestamp": verification_timestamp, "truthRevealTimestamp": datetime.now(timezone.utc).isoformat(),
              "priorMidiReadsByThisScoringInvocation": 0}
    write_immutable(args.truth_reveal, reveal)
    truth = {}
    with zipfile.ZipFile(args.archive) as archive:
        for take_id, take in full_takes.items():
            truth[take_id] = midi_truth(archive, take)
    rows = []
    errors_by_tolerance_candidate = {}
    sealed_files = {(row['candidateId'], row['takeId']): row for row in seal['cells']}
    for tolerance in [50, 25, 100]:
        for (candidate, take_id), artifact in sorted(artifacts.items()):
            # Revalidate filesystem evidence after truth becomes available.
            sealed = sealed_files[(candidate, take_id)]
            if sha256_file(ROOT / sealed['artifactPath']) != sealed['artifactSha256'] or sha256_file(Path(args.seal)) != reveal['sealFilesystemSha256']:
                raise ValueError('XC1_INVALID_EVALUATION_PREDICTION_CHANGED_AFTER_TRUTH_REVEAL')
            interval = full_takes[take_id]['scoreableInterior']
            predicted = [OnsetEvent(event['candidateObservationId'], int(event['pitch']), event['performanceTimeMs'], event['confidence'])
                         for event in artifact['acousticObservations'] if interval['startMs'] <= event['performanceTimeMs'] < interval['endMs']]
            score = score_take(truth[take_id], predicted, (interval['endMs'] - interval['startMs']) / 1000, tolerance)
            errors_by_tolerance_candidate.setdefault((tolerance, candidate), []).extend(item['absErrorMs'] for item in score['matching']['matches'])
            rows.append({"candidateId": candidate, "takeId": take_id, "toleranceMs": tolerance,
                         **{key: value for key, value in score.items() if key != 'matching'},
                         'chordNoteCompletenessDiagnostic': 'NOT_AVAILABLE_IN_XC1_R3D',
                         "matchedOnsets": len(score['matching']['matches']), "truthOnsets": len(truth[take_id]),
                         "predictedOnsets": len(predicted)})
    primary = [row for row in rows if row['toleranceMs'] == 50]
    pairwise = {}
    for candidate in CANDIDATES:
        for other in CANDIDATES:
            if candidate == other:
                continue
            for metric in ['f1', 'falsePositiveOnsetsPerMinute', 'missedOnsetRate']:
                pairwise[f'{candidate}__{other}__{metric}'] = paired_bootstrap(primary, candidate, other, metric, draws=5000, seed=13371)
    eligibility = {candidate: {"completeCoverage": sum(row['candidateId'] == candidate for row in primary) == len(manifest['takes']),
                               "runtimeEligible": measured['candidates'][candidate]['runtimeEligible']} for candidate in CANDIDATES}
    aggregate = {}
    total_minutes = sum((take['scoreableInterior']['endMs'] - take['scoreableInterior']['startMs']) / 60000 for take in manifest['takes'])
    for tolerance in [50, 25, 100]:
        aggregate[tolerance] = {}
        for candidate in CANDIDATES:
            items = [row for row in rows if row['candidateId'] == candidate and row['toleranceMs'] == tolerance]
            matched = sum(row['matchedOnsets'] for row in items)
            expected = sum(row['truthOnsets'] for row in items)
            predicted = sum(row['predictedOnsets'] for row in items)
            errors = sorted(errors_by_tolerance_candidate[(tolerance, candidate)])
            aggregate[tolerance][candidate] = {
                'takeCount': len(items), 'macroTakeMeans': {metric: sum(row[metric] for row in items) / len(items)
                    for metric in ['precision', 'recall', 'f1', 'falsePositiveOnsetsPerMinute', 'missedOnsetRate']},
                'pooledPrecision': matched / predicted if predicted else 0,
                'pooledRecall': matched / expected if expected else 0,
                'pooledF1': 2 * matched / (predicted + expected) if predicted + expected else 0,
                'pooledFalsePositiveOnsetsPerMinute': (predicted - matched) / total_minutes,
                'pooledMissedOnsetRate': (expected - matched) / expected if expected else 0,
                'onsetAbsoluteMedianMs': percentile(errors, 50), 'onsetAbsoluteP95Ms': percentile(errors, 95),
                'duplicateRetriggerFalseDetections': sum(row['duplicateRetriggerFalseDetections'] for row in items),
            }
    result = {"phase": PHASE, "dockerScienceRuntimeIdentity": runtime_identity, "truthReveal": reveal,
              "primary50ms": primary, "sensitivity25ms": [row for row in rows if row['toleranceMs'] == 25],
              "sensitivity100ms": [row for row in rows if row['toleranceMs'] == 100], "pairedBootstrap": pairwise,
              "runtimeEligibility": eligibility, "scientificFrontRunnerDecision": decide_front_runner(eligibility, pairwise),
              "aggregateMetricsByTolerance": aggregate,
              "commercialQualificationStatus": "NOT_PERFORMED", "bootstrapPrimaryUnit": "performance_take"}
    write_immutable(args.output, result)
    return result


def main():
    parser = argparse.ArgumentParser()
    for arg in ['seal', 'manifest', 'truth-manifest', 'archive', 'runtime', 'truth-reveal', 'output', 'f5-commit', 'f5-freeze-sha256']:
        parser.add_argument(f'--{arg}', required=True)
    parser.add_argument('--freeze')
    result = score_run(parser.parse_args())
    print(json.dumps({"scientificFrontRunnerDecision": result['scientificFrontRunnerDecision'], "primaryRows": len(result['primary50ms'])}))


if __name__ == '__main__':
    main()

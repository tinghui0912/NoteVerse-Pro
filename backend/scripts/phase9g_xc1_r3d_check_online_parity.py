"""Compare fresh non-SMD browser hops to the frozen sequential references."""
import json
import sys
from pathlib import Path
import numpy as np
from backend.scripts.phase9g_xc1_r3d_stage_b import container_guard, write_immutable

ROOT = Path(__file__).resolve().parents[2]
def main():
    identity = container_guard()
    results = {}
    final = '--final' in sys.argv
    for name, source in [('reference_fixture', 'fixtures'), ('gate_fixture', 'gate_fixture')]:
        root = ROOT / f'backend/data/work/xc1_r3d_validation/{name}'
        reference = ROOT / ('backend/data/work/xc1_r3d_validation/gate_reference' if name == 'gate_fixture' else f'backend/data/work/phase9g_dr3r1h/{source}')
        browser = json.loads((root / ('browser_final.json' if final else 'browser.json')).read_text())
        chosen = np.array([row['chosenStates'] for row in browser['rawHopRows']])
        probabilities = np.array([row['probabilities'] for row in browser['rawHopRows']]).reshape(-1, 88, 5)
        expected_chosen = np.load(reference / 'reference_chosen_states.npy').reshape(-1, 88)
        expected_probabilities = np.load(reference / 'reference_probabilities.npy').reshape(-1, 88, 5)
        if chosen.shape != expected_chosen.shape:
            raise ValueError('XC1_ONLINE_REFERENCE_HOP_COUNT_MISMATCH')
        mismatch = int(np.count_nonzero(chosen != expected_chosen))
        delta = np.abs(probabilities - expected_probabilities)
        states = {}
        elementwise = {}
        for state, file in [('mel', 'mel_buffer'), ('cache0', 'cache0'), ('cache1', 'cache1'), ('h', 'h'), ('c', 'c')]:
            reference_path = reference / f'reference_{file}.npy'
            if not reference_path.exists():
                continue
            array = np.load(reference_path).astype(np.float64)
            if array.size != browser['finalState'][state]['length'] and array.shape[0] == len(chosen):
                array = array[-1]
            array = array.reshape(-1)
            snapshot = browser['finalState'][state]
            states[state] = { 'lengthEqual': len(array) == snapshot['length'],
                'sumDelta': abs(float(array.sum()) - snapshot['sum']),
                'absSumDelta': abs(float(np.abs(array).sum()) - snapshot['absSum']),
                'maxAbsDelta': abs(float(np.abs(array).max()) - snapshot['maxAbs']) }
            if final:
                actual = np.asarray(browser['finalStateValues'][state], dtype=np.float64)
                difference = np.abs(array - actual)
                elementwise[state] = { 'meanAbsDelta': float(difference.mean()), 'maxAbsDelta': float(difference.max()),
                    'absoluteTolerance': .001, 'pass': bool(np.all(difference <= .001)) }
        result = { 'chosenStateMismatchCount': mismatch, 'semanticHopCount': len(chosen),
            'probabilityMeanAbsDelta': float(delta.mean()), 'probabilityMaxAbsDelta': float(delta.max()),
            'probabilityAbsoluteTolerance': 0.001, 'finalStateSummaryDeltas': states,
            'finalStateEvidenceLimitation': 'Numeric summaries, not independent elementwise recurrent equivalence.',
            'authoritativePublicationBridge': json.loads((root / ('bridge_parity_final.json' if final else 'bridge_parity.json')).read_text()),
            'finalNativeCounter': browser['finalState']['numUnderThr'] }
        summary_pass = all(row['lengthEqual'] and row['maxAbsDelta'] <= .001
                           and row['sumDelta'] <= .001 * browser['finalState'][state]['length']
                           and row['absSumDelta'] <= .001 * browser['finalState'][state]['length']
                           for state, row in states.items())
        expected_prev = expected_chosen[-1]
        prev = browser['finalState']['prev']
        prev_pass = prev['sum'] == int(expected_prev.sum()) and prev['nonzero'] == int(np.count_nonzero(expected_prev))
        result['discretePrevSummaryParity'] = prev_pass
        result['finalStateSummaryParity'] = summary_pass
        if final:
            expected_persistent_prev = np.load(reference / 'reference_prev.npy').reshape(-1) if (reference / 'reference_prev.npy').exists() else expected_chosen[-1]
            result['persistentPrevMismatchCount'] = int(np.count_nonzero(np.asarray(browser['finalStateValues']['prev']) != expected_persistent_prev))
            result['elementwiseFinalStateParity'] = elementwise
            original_fixture = ROOT / f'backend/data/work/phase9g_dr3r1h/{source}'
            expected_audio = np.load(original_fixture / 'initial_audio_buffer.npy').reshape(-1).copy()
            expected_counter = 0
            for hop in np.load(original_fixture / 'hops.npy').reshape(-1, 512):
                expected_audio[:-512] = expected_audio[512:]; expected_audio[-512:] = hop
                expected_counter = expected_counter + 1 if float(expected_audio.max() - expected_audio.min()) < .05 else 0
            result['audioBufferMismatchCount'] = int(np.count_nonzero(np.asarray(browser['finalStateValues']['audio']) != expected_audio))
            result['nativeCounterEqual'] = expected_counter == browser['finalStateValues']['numUnderThr']
            summary_pass = (summary_pass and all(row['pass'] for row in elementwise.values()) and result['persistentPrevMismatchCount'] == 0
                            and result['audioBufferMismatchCount'] == 0 and result['nativeCounterEqual'])
        result['status'] = 'PASS' if mismatch == 0 and float(delta.max()) <= .001 and summary_pass and prev_pass else 'FAIL'
        results[name] = result
    write_immutable(ROOT / ('backend/data/work/xc1_r3d_validation/online_semantic_parity_f5_gate.json' if final else 'backend/data/work/xc1_r3d_validation/online_semantic_parity_final.json'), {
        'dockerScienceRuntimeIdentity': identity, 'results': results,
        'status': 'PASS' if all(row['status'] == 'PASS' for row in results.values()) else 'FAIL' })
    print(json.dumps({key: (value['status'], value['chosenStateMismatchCount'], value['probabilityMaxAbsDelta']) for key, value in results.items()}))
    if any(row['status'] != 'PASS' for row in results.values()):
        raise SystemExit(1)

if __name__ == '__main__':
    main()

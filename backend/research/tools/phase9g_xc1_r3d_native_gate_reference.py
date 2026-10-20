"""Fresh exact K1 ORT CPU reference for the non-SMD native gate fixture."""
import json
import platform
from pathlib import Path
import numpy as np
import onnxruntime as ort

ROOT = Path(__file__).resolve().parents[3]
def main():
    if platform.system() != 'Linux' or not Path('/.dockerenv').exists():
        raise ValueError('HOST_SCIENTIFIC_RUNTIME_FORBIDDEN')
    fixture = ROOT / 'backend/data/work/phase9g_dr3r1h/gate_fixture'
    output_root = ROOT / 'backend/data/work/xc1_r3d_validation/gate_reference'
    output_root.mkdir(parents=True, exist_ok=True)
    state = { key: np.load(fixture / filename).copy() for key, filename in {
        'audio': 'initial_audio_buffer.npy', 'mel': 'initial_mel_buffer.npy', 'cache0': 'initial_cache0.npy',
        'cache1': 'initial_cache1.npy', 'h': 'initial_h.npy', 'c': 'initial_c.npy', 'prev': 'initial_prev.npy' }.items() }
    options = ort.SessionOptions(); options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
    session = ort.InferenceSession(str(fixture / 'online_amt_grouped_k1_opset18.onnx'), sess_options=options, providers=['CPUExecutionProvider'])
    counter = 0; probabilities = []; chosen = []; boundary = []
    for index, hop in enumerate(np.load(fixture / 'hops.npy').reshape(-1, 512)):
        audio = state['audio'].reshape(-1)
        audio[:-512] = audio[512:]; audio[-512:] = hop
        counter = counter + 1 if float(audio.max() - audio.min()) < .05 else 0
        shortcut = counter > 100
        if shortcut:
            probability = np.zeros((88, 5), dtype=np.float32); probability[:, 0] = 1
            selected = np.zeros(88, dtype=np.int64)
        else:
            result = dict(zip([item.name for item in session.get_outputs()], session.run(None, {
                'audio_last_2048_sequence': audio[-2048:].reshape(1, 1, 2048),
                'mel_buffer_in': state['mel'], 'cache0_in': state['cache0'], 'cache1_in': state['cache1'],
                'h_in': state['h'], 'c_in': state['c'], 'prev_output_in': state['prev'].astype(np.int64) })))
            for key, name in [('mel', 'mel_buffer_out'), ('cache0', 'cache0_out'), ('cache1', 'cache1_out'), ('h', 'h_out'), ('c', 'c_out')]:
                state[key] = result[name].copy()
            selected = result['chosen_state_sequence'].reshape(88)
            state['prev'] = selected.reshape(1, 1, 88).copy()
            probability = result['probabilities_sequence'].reshape(88, 5)
        probabilities.append(probability); chosen.append(selected)
        if 95 <= index <= 108:
            boundary.append({ 'hopIndex': index, 'numUnderThr': counter, 'shortcut': shortcut,
                'persistentPrev': state['prev'].reshape(-1).tolist() })
    np.save(output_root / 'reference_probabilities.npy', np.stack(probabilities))
    np.save(output_root / 'reference_chosen_states.npy', np.stack(chosen))
    for key, file in [('mel', 'mel_buffer'), ('cache0', 'cache0'), ('cache1', 'cache1'), ('h', 'h'), ('c', 'c'), ('audio', 'audio'), ('prev', 'prev')]:
        np.save(output_root / f'reference_{file}.npy', state[key])
    (output_root / 'reference_receipt.json').write_text(json.dumps({ 'executionProvider': 'CPUExecutionProvider',
        'onnxruntimeVersion': ort.__version__, 'finalCounter': counter, 'boundary': boundary }, indent=2))
    print(json.dumps({ 'hopCount': len(chosen), 'finalCounter': counter }))

if __name__ == '__main__':
    main()

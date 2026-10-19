"""Static graph descriptors only. No runtime session or model inference."""
from pathlib import Path
import json
import onnx

ROOT = Path('/workspace')
paths = [
    'backend/data/work/phase9gd1_robust_browser_onnx/robust_bytedance_fixed_1820_opset18.onnx',
    'backend/data/work/bytedance_browser_runtime_feasibility/bytedance_note_model_fixed_anchor.onnx',
]
rows = []
for path in paths:
    graph = onnx.load(ROOT / path, load_external_data=False).graph
    def descriptor(value):
        t = value.type.tensor_type
        return {'name': value.name, 'dtype': t.elem_type,
                'shape': [d.dim_value if d.HasField('dim_value') else d.dim_param for d in t.shape.dim]}
    inputs, outputs = [descriptor(v) for v in graph.input], [descriptor(v) for v in graph.output]
    if inputs != [{'name': 'audio', 'dtype': 1, 'shape': [1, 29120]}]:
        raise ValueError('STATIC_INPUT_DESCRIPTOR_MISMATCH')
    for name in ('reg_onset_output', 'frame_output'):
        if not any(v == {'name': name, 'dtype': 1, 'shape': [1, 183, 88]} for v in outputs):
            raise ValueError('STATIC_OUTPUT_DESCRIPTOR_MISMATCH')
    rows.append({'path': path, 'inputs': inputs, 'outputs': outputs, 'onnxVersion': onnx.__version__})
print(json.dumps({'staticGraphParseOnly': True, 'neuralRuns': 0, 'modelSessions': 0, 'graphs': rows}))

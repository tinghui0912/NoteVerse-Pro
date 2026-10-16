"""Deterministic fake-device file, not a dataset or model experiment. Docker only."""
import math
import struct
import wave
from pathlib import Path

if not Path('/.dockerenv').exists(): raise RuntimeError('DOCKER_ONLY')
root=Path(__file__).resolve().parents[2]
path=root/'backend/data/work/xc6_capture/fake-device.wav'
path.parent.mkdir(parents=True,exist_ok=True)
if path.exists(): raise RuntimeError('FIXTURE_ALREADY_EXISTS')
with wave.open(str(path),'wb') as f:
    f.setnchannels(1);f.setsampwidth(2);f.setframerate(48000)
    f.writeframes(b''.join(struct.pack('<h',round(5000*math.sin(2*math.pi*261.625565*n/48000))) for n in range(48000*5)))
print(path)

"""Single conditional1/3 FIR and deterministic reference fixtures; Docker only."""
import hashlib
import inspect
import json
import math
from pathlib import Path
import numpy as np
import scipy
from scipy.signal import firwin,resample_poly

if not Path('/.dockerenv').exists():raise RuntimeError('DOCKER_ONLY')
if scipy.__version__!='1.14.1':raise RuntimeError('SCIPY_VERSION_DRIFT')
ROOT=Path(__file__).resolve().parents[2]
WORK=ROOT/'backend/data/work/xc6_capture'
APP=ROOT/'apps/customer-web'
CORE='93a9914278e3aa3d659ca73aec8ac10dde5bb51d2101a87abfadcbc75ed01443'
def sha(b):return hashlib.sha256(b).hexdigest()
def canonical(x):return json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode('ascii')
def write(p,b):
    p.parent.mkdir(parents=True,exist_ok=True)
    with p.open('xb')as f:f.write(b)
def js(p,x):write(p,(json.dumps(x,indent=2,sort_keys=True)+'\n').encode())
probe=json.loads((WORK/'metadata_fake.json').read_text())
r=probe['result']
if r['status']!='CAPTURE_METADATA_PROBE_COMPLETE' or r['audioContextSampleRateHz']!=48000 or r['audioWorkletSampleRateHz']!=48000:raise RuntimeError('48K_NOT_OBSERVED_DO_NOT_DESIGN_FILTER')
# SciPy1.14.1 source: half_len=10*max_rate, cutoff=1/max_rate,
# firwin(...).astype(input.dtype), then multiply by up.
up,down=1,3
h=firwin(2*10*max(up,down)+1,1/max(up,down),window=('kaiser',5.0)).astype(np.float32)
h*=up
asset=APP/'public/engineering/xc6/fir-1-3.f32'
write(asset,h.astype('<f4').tobytes())
base={'schemaVersion':1,'acousticCoreIdentitySha256':CORE,'sourceRateHz':48000,'targetRateHz':16000,
    'up':1,'down':3,'tapCount':61,'scipyVersion':scipy.__version__,
    'firwin':{'numtaps':61,'cutoff':1/3,'window':['kaiser',5],'scale':True,'fs':2},
    'coefficients':{'sha256':sha(asset.read_bytes()),'bytes':244,'dtype':'float32-le'},
    'realSourceLookaheadSamples':30,'realSourceLookaheadMs':.625,'firstFullyRealOutputIndex':10,
    'timeMapping':'Target sample m represents original source3*m; wait through source3*m+30. No fitted shift.',
    'precision':'float32 input/coefficients/product/each accumulation',
    'boundary':'Origin zeros only in first10 outputs, which are excluded from qualified model inputs. No padded finish.',
    'runtimeFeed':'Qualified adapter uses the explicit already16k injection boundary; never assumes physical microphone16k. Outer publications retain original48k source coordinates.',
    'implementation':{'path':'apps/customer-web/src/lib/practice/acoustic-inference/xc6-source-48000.ts',
                      'sha256':sha((APP/'src/lib/practice/acoustic-inference/xc6-source-48000.ts').read_bytes())}}
base44={'schemaVersion':1,'acousticCoreIdentitySha256':CORE,'sourceRateHz':44100,'targetRateHz':16000,'up':160,'down':441,
    'tapCount':8821,'coefficientSha256':'d54df355dba1e60395e165f0a44a3d016e25632af639be767c861e1bfd61e620',
    'realSourceLookaheadSamples':28,'runtimeFeed':'Unchanged XC5 CAPTURE branch and frozen XC4 FIR.'}
identities={str(k):{'identity':v,'identitySha256':sha(canonical(v))}for k,v in [(44100,base44),(48000,base)]}
js(APP/'src/lib/practice/acoustic-inference/xc6-source-identities.json',identities)
fixtures=[];rng=np.random.default_rng(13371)
for n in [1,29,30,31,61,127,48001]:
    for kind in ['impulse','random','sine','sweep']:
        t=np.arange(n,dtype=np.float64)/48000
        x=(np.eye(1,n,0,dtype=np.float32)[0] if kind=='impulse' else
           rng.uniform(-1,1,n).astype(np.float32) if kind=='random' else
           (.7*np.sin(2*np.pi*997*t)).astype(np.float32) if kind=='sine' else
           (.7*np.sin(2*np.pi*(50*t+9500*t*t))).astype(np.float32))
        reference=resample_poly(x,up,down,window=h,padtype='constant').astype('<f4')
        valid=max(0,math.ceil((n-30)/3))
        stem=f'{kind}_{n}'
        a=WORK/f'dsp48/{stem}.input.f32';b=WORK/f'dsp48/{stem}.reference.f32'
        write(a,x.astype('<f4').tobytes());write(b,reference[:valid].tobytes())
        fixtures.append({'id':stem,'input':a.relative_to(WORK).as_posix(),'reference':b.relative_to(WORK).as_posix(),
            'inputSha256':sha(a.read_bytes()),'referenceSha256':sha(b.read_bytes()),'inputSamples':n,
            'fullScipyOutputSamples':len(reference),'realFutureQualifiedPrefixSamples':valid})
js(WORK/'dsp48_reference.json',{'scipyVersion':scipy.__version__,'resamplePolySourceSha256':sha(inspect.getsource(resample_poly).encode()),
    'firwinSourceSha256':sha(inspect.getsource(firwin).encode()),'observed48kTrigger':{'probeSha256':sha((WORK/'metadata_fake.json').read_bytes()),'rate':48000},
    'filter':base,'adapterIdentity':identities['48000']['identitySha256'],
    'scipyAlignment':{'filterPrePad':3,'preRemoveOutputs':11,'additionalAlignmentMs':0},
    'frozenNumericTolerance':{'maxAbs':3e-6,'rms':5e-7,'chunkVsSingleMaxAbs':0,'sampleCountExact':True,
        'rationale':'Float32 summation over61 taps; same frozen XC4 family tolerance. No gain or timing fitting. Compare real-future-valid prefix only; SciPy padded-tail outputs explicitly excluded.'},
    'fixtures':fixtures})
print(json.dumps({'sourceAdapterIdentities':identities,'fixtures':len(fixtures)}))

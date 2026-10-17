import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const fixtureRoot = join(
  repoRoot,
  'backend',
  'data',
  'work',
  'bytedance_browser_runtime_feasibility',
  'golden_fixtures'
);
const outputPath = join(
  repoRoot,
  'apps',
  'customer-web',
  'src',
  'lib',
  'practice',
  'acoustic-inference',
  '__fixtures__',
  'bytedance-python-reference-contract.json'
);

const manifest = JSON.parse(readFileSync(join(fixtureRoot, 'manifest.json'), 'utf8'));
const fixture = manifest.fixtures.find((item) => item.fixture_id === 's01_correct_chord_001_g01');
if (!fixture) {
  throw new Error('Required ByteDance reference fixture s01_correct_chord_001_g01 is missing.');
}

const input = readNpy(join(fixtureRoot, fixture.input_tensor_npy));
const onset = readNpy(join(fixtureRoot, fixture.reg_onset_output_npy));
const frame = readNpy(join(fixtureRoot, fixture.frame_output_npy));
const localStartFrame = 155;
const localEndFrame = 172;
const referenceEvents = [];
const sparseLocalRawValues = [];

for (const pitch of fixture.expected_pitches) {
  const pitchIndex = pitchToMidi(pitch) - 21;
  let peakFrame = localStartFrame;
  let peakScore = Number.NEGATIVE_INFINITY;
  for (let frameIndex = localStartFrame; frameIndex <= localEndFrame; frameIndex += 1) {
    const score = valueAt(onset, frameIndex, pitchIndex);
    if (score > peakScore) {
      peakFrame = frameIndex;
      peakScore = score;
    }
  }
  referenceEvents.push({
    pitch,
    midiPitch: pitchToMidi(pitch),
    pitchIndex,
    frameIndex: peakFrame,
    sampleIndex: Math.round(peakFrame / 100 * 16000),
    sessionMsFromClipStart: peakFrame * 10,
    onsetScore: round8(valueAt(onset, peakFrame, pitchIndex)),
    frameScoreAtOnsetPeak: round8(valueAt(frame, peakFrame, pitchIndex)),
    localWindowFrameRangeInclusive: [localStartFrame, localEndFrame],
  });
  for (let frameIndex = localStartFrame; frameIndex <= localEndFrame; frameIndex += 1) {
    const onsetValue = valueAt(onset, frameIndex, pitchIndex);
    const frameValue = valueAt(frame, frameIndex, pitchIndex);
    if (onsetValue >= 0.001 || frameValue >= 0.001) {
      sparseLocalRawValues.push({
        pitch,
        frameIndex,
        onset: round8(onsetValue),
        frame: round8(frameValue),
      });
    }
  }
}

writeFileSync(outputPath, `${JSON.stringify({
  fixtureId: 'bytedance-python-reference-s01-correct-chord-g01-v1',
  source: 'Generated mechanically from existing non-frozen dev/cal browser-feasibility PyTorch golden fixture under backend/data/work/bytedance_browser_runtime_feasibility/golden_fixtures.',
  generator: 'apps/customer-web/scripts/generate-bytedance-reference-contract-fixture.mjs',
  frozenEvaluationSetUsed: false,
  fixtureIdSource: fixture.fixture_id,
  caseId: fixture.case_id,
  caseKind: fixture.case_kind,
  expectedPitches: fixture.expected_pitches,
  sampleRateHz: 16000,
  targetAnchorMs: 1600,
  futureMs: 220,
  onsetThreshold: 0.2,
  frameThreshold: 0.2,
  outputFrameRateHz: 100,
  inputTensor: {
    file: fixture.input_tensor_npy,
    sha256: sha256(join(fixtureRoot, fixture.input_tensor_npy)),
    shape: input.shape,
    dtype: input.dtype,
  },
  rawOutputs: {
    regOnset: {
      file: fixture.reg_onset_output_npy,
      sha256: sha256(join(fixtureRoot, fixture.reg_onset_output_npy)),
      shape: onset.shape,
      dtype: onset.dtype,
    },
    frame: {
      file: fixture.frame_output_npy,
      sha256: sha256(join(fixtureRoot, fixture.frame_output_npy)),
      shape: frame.shape,
      dtype: frame.dtype,
    },
  },
  referenceTemporallyBoundEvents: referenceEvents.sort((left, right) => (
    left.sampleIndex - right.sampleIndex || left.midiPitch - right.midiPitch
  )),
  sparseLocalRawValues,
}, null, 2)}\n`);

function readNpy(path) {
  const bytes = readFileSync(path);
  if (bytes.toString('latin1', 0, 6) !== '\x93NUMPY') {
    throw new Error(`Invalid npy file: ${path}`);
  }
  const major = bytes[6];
  const headerLength = major === 1 ? bytes.readUInt16LE(8) : bytes.readUInt32LE(8);
  const headerOffset = major === 1 ? 10 : 12;
  const header = bytes.toString('latin1', headerOffset, headerOffset + headerLength);
  const dtype = /'descr': '([^']+)'/.exec(header)?.[1];
  if (dtype !== '<f4') {
    throw new Error(`Only little-endian float32 npy files are supported, got ${dtype}.`);
  }
  const shapeText = /'shape': \(([^)]*)\)/.exec(header)?.[1] ?? '';
  const shape = shapeText.split(',').map((item) => item.trim()).filter(Boolean).map(Number);
  const dataOffset = headerOffset + headerLength;
  const data = new Float32Array((bytes.byteLength - dataOffset) / 4);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = bytes.readFloatLE(dataOffset + index * 4);
  }
  return { data, shape, dtype: 'float32' };
}

function valueAt(array, frameIndex, pitchIndex) {
  return array.data[frameIndex * array.shape[1] + pitchIndex] ?? 0;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function pitchToMidi(pitch) {
  const names = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let accidental = 0;
  let octaveIndex = 1;
  if (pitch.length >= 3 && ['#', 'b'].includes(pitch[1])) {
    accidental = pitch[1] === '#' ? 1 : -1;
    octaveIndex = 2;
  }
  return (Number(pitch.slice(octaveIndex)) + 1) * 12 + names[pitch[0]] + accidental;
}

function round8(value) {
  return Math.round(value * 100000000) / 100000000;
}

import { BasicPitch } from '@spotify/basic-pitch';
import * as tf from '@tensorflow/tfjs';

const BASIC_PITCH_SAMPLE_RATE = 22050;
const INPUT_SAMPLE_RATE = 16000;
const ONSET_THRESHOLD = 0.5;
const FRAME_THRESHOLD = 0.3;
const TARGET_ANCHOR_SECONDS = 1.6;
const LOCAL_PRE_SECONDS = 0.05;
const LOCAL_POST_SECONDS = 0.12;
const MIDI_OFFSET = 21;

function parseNpy(buffer) {
  const bytes = new Uint8Array(buffer);
  const magic = String.fromCharCode(...bytes.slice(0, 6));
  if (magic !== '\x93NUMPY') throw new Error('not an npy file');
  const major = bytes[6];
  let headerLen;
  let offset;
  if (major === 1) {
    headerLen = bytes[8] | (bytes[9] << 8);
    offset = 10;
  } else if (major === 2) {
    headerLen = bytes[8] | (bytes[9] << 8) | (bytes[10] << 16) | (bytes[11] << 24);
    offset = 12;
  } else {
    throw new Error(`unsupported npy version ${major}`);
  }
  const header = new TextDecoder('latin1').decode(bytes.slice(offset, offset + headerLen));
  if (!header.includes("'descr': '<f4'") && !header.includes('"descr": "<f4"')) {
    throw new Error(`only little-endian float32 npy is supported: ${header}`);
  }
  const shapeMatch = header.match(/'shape': \(([^)]*)\)/) || header.match(/"shape": \[([^\]]*)\]/);
  if (!shapeMatch) throw new Error(`cannot parse npy shape: ${header}`);
  const shape = shapeMatch[1].split(',').map((part) => part.trim()).filter(Boolean).map(Number);
  return { shape, data: new Float32Array(buffer, offset + headerLen) };
}

async function fetchNpy(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`fetch failed: ${url}`);
  return parseNpy(await response.arrayBuffer());
}

function linearResample(input, fromRate, toRate) {
  const outputLength = Math.round((input.length * toRate) / fromRate);
  const output = new Float32Array(outputLength);
  const ratio = fromRate / toRate;
  for (let i = 0; i < outputLength; i += 1) {
    const source = i * ratio;
    const left = Math.floor(source);
    const right = Math.min(input.length - 1, left + 1);
    const frac = source - left;
    output[i] = input[left] * (1 - frac) + input[right] * frac;
  }
  return output;
}

function pitchToMidi(pitch) {
  const match = /^([A-G])([#b]?)(-?\d+)$/.exec(pitch);
  if (!match) throw new Error(`bad pitch ${pitch}`);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1]];
  const accidental = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
  const octave = Number(match[3]);
  return 12 * (octave + 1) + base + accidental;
}

function expectedDecision(frames, onsets, fixture) {
  const clipStart = fixture.target_second - TARGET_ANCHOR_SECONDS;
  for (const pitch of fixture.expected_pitches) {
    const pitchIndex = pitchToMidi(pitch) - MIDI_OFFSET;
    let onsetMax = -Infinity;
    let frameMax = -Infinity;
    for (let t = 0; t < onsets.length; t += 1) {
      const absoluteTime = clipStart + t / 86;
      if (absoluteTime < fixture.target_second - LOCAL_PRE_SECONDS) continue;
      if (absoluteTime > fixture.target_second + LOCAL_POST_SECONDS) continue;
      onsetMax = Math.max(onsetMax, onsets[t][pitchIndex]);
      frameMax = Math.max(frameMax, frames[t][pitchIndex]);
    }
    if (!(onsetMax >= ONSET_THRESHOLD && frameMax >= FRAME_THRESHOLD)) return false;
  }
  return true;
}

async function runBasicPitch(model, input) {
  let frames = [];
  let onsets = [];
  let contours = [];
  const started = performance.now();
  await model.evaluateModel(
    input,
    (frameChunk, onsetChunk, contourChunk) => {
      frames = frames.concat(frameChunk);
      onsets = onsets.concat(onsetChunk);
      contours = contours.concat(contourChunk);
    },
    () => {},
  );
  return {
    inferenceMs: performance.now() - started,
    frames,
    onsets,
    contours,
  };
}

async function main() {
  const warmRuns = window.__CONFIG__.warmRuns;
  const manifest = await (await fetch('/fixtures/manifest.json')).json();
  const fixtures = [];
  for (const fixture of manifest.fixtures) {
    const input = await fetchNpy(`/fixtures/${fixture.input_tensor_npy}`);
    fixtures.push({
      ...fixture,
      input16k: input.data,
      input22050: linearResample(input.data, INPUT_SAMPLE_RATE, BASIC_PITCH_SAMPLE_RATE),
    });
  }

  const loadStarted = performance.now();
  const model = new BasicPitch('/model/model.json');
  await model.model;
  const modelLoadMs = performance.now() - loadStarted;

  const first = await runBasicPitch(model, fixtures[0].input22050);
  const comparisons = [
    {
      fixture_id: fixtures[0].fixture_id,
      output_shapes: {
        frames: [first.frames.length, first.frames[0]?.length ?? 0],
        onsets: [first.onsets.length, first.onsets[0]?.length ?? 0],
        contours: [first.contours.length, first.contours[0]?.length ?? 0],
      },
      accepted: expectedDecision(first.frames, first.onsets, fixtures[0]),
    },
  ];

  const warmLatencies = [];
  for (let i = 0; i < warmRuns; i += 1) {
    const fixture = fixtures[i % fixtures.length];
    const result = await runBasicPitch(model, fixture.input22050);
    warmLatencies.push(result.inferenceMs);
    if (i < fixtures.length) {
      comparisons.push({
        fixture_id: fixture.fixture_id,
        output_shapes: {
          frames: [result.frames.length, result.frames[0]?.length ?? 0],
          onsets: [result.onsets.length, result.onsets[0]?.length ?? 0],
          contours: [result.contours.length, result.contours[0]?.length ?? 0],
        },
        accepted: expectedDecision(result.frames, result.onsets, fixture),
      });
    }
  }
  warmLatencies.sort((a, b) => a - b);
  const p95Index = Math.min(warmLatencies.length - 1, Math.ceil(warmLatencies.length * 0.95) - 1);
  return {
    package: '@spotify/basic-pitch',
    backend: 'tensorflowjs-browser',
    tf_backend: tf.getBackend(),
    user_agent: navigator.userAgent,
    model_load_ms: modelLoadMs,
    first_inference_ms: first.inferenceMs,
    warm_inference_ms: {
      runs: warmLatencies.length,
      median: warmLatencies[Math.floor(warmLatencies.length / 2)] ?? null,
      p95: warmLatencies[p95Index] ?? null,
    },
    input: {
      original_sample_rate: INPUT_SAMPLE_RATE,
      model_sample_rate: BASIC_PITCH_SAMPLE_RATE,
      original_samples: fixtures[0].input16k.length,
      resampled_samples: fixtures[0].input22050.length,
    },
    verifier: {
      onset_threshold: ONSET_THRESHOLD,
      frame_threshold: FRAME_THRESHOLD,
      timing_note: 'Smoke decision uses t/86 frame timing; dev/cal metrics are taken from existing benchmark reports.',
    },
    comparisons,
  };
}

main()
  .then((result) => {
    window.__RESULT__ = result;
    document.body.textContent = JSON.stringify(result, null, 2);
  })
  .catch((error) => {
    window.__ERROR__ = String(error && error.stack ? error.stack : error);
    document.body.textContent = window.__ERROR__;
  });

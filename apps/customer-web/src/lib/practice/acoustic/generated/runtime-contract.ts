// Generated from contracts/practice/acoustic/runtime-contract.json. Do not edit.
export const ACOUSTIC_RUNTIME_CONTRACT = Object.freeze({
"decoder": Object.freeze({
"frameThreshold": 0.05,
"identity": "A",
"midiPitchStart": 21,
"onsetThreshold": 0.3,
"outputFrameRateHz": 100
} as const),
"input": Object.freeze({
"dtype": "float32",
"name": "audio",
"sampleRateHz": 16000,
"shape": Object.freeze([1, 29120] as const)
} as const),
"model": Object.freeze({
"assetId": "practice-acoustic-robust-browser",
"assetVersion": "v1",
"byteSize": 98689283,
"mediaType": "application/octet-stream",
"sha256": "4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3",
"storageKey": "models/continuous/robust-browser-v1/4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3/model.onnx"
} as const),
"outputs": Object.freeze([Object.freeze({
"dtype": "float32",
"name": "reg_onset_output",
"shape": Object.freeze([1, 183, 88] as const)
} as const), Object.freeze({
"dtype": "float32",
"name": "frame_output",
"shape": Object.freeze([1, 183, 88] as const)
} as const)] as const),
"runtime": Object.freeze({
"automaticFallback": false,
"executionProvider": "webgpu",
"graphOptimizationLevel": "disabled",
"packageName": "onnxruntime-web",
"packageVersion": "1.20.1"
} as const),
"schemaVersion": 1,
"sourceAdapters": Object.freeze({
"44100": Object.freeze({
"coefficientAsset": Object.freeze({
"byteSize": 35284,
"path": "apps/customer-web/public/model-assets/practice-acoustic/fir-160-441.f32",
"sha256": "d54df355dba1e60395e165f0a44a3d016e25632af639be767c861e1bfd61e620"
} as const),
"down": 441,
"sourceRateHz": 44100,
"up": 160
} as const),
"48000": Object.freeze({
"coefficientAsset": Object.freeze({
"byteSize": 244,
"path": "apps/customer-web/public/model-assets/practice-acoustic/fir-1-3.f32",
"sha256": "0edd2896f0923a575a7f01fb2460b529409899e9ba187f213a36037f3ef9218f"
} as const),
"down": 3,
"sourceRateHz": 48000,
"up": 1
} as const)
} as const),
"window": Object.freeze({
"futureContextSamples": 2720,
"ownedSamples": 9600
} as const)
} as const);
export const ACOUSTIC_ANALYSIS_IDENTITY = Object.freeze({
"identityName": "practice-acoustic-robust-browser@v1",
"analysisIdentitySha256": "d469a156a0acbe34ab3e3285d4d6857824f0d71992deae4f3e2b1a03e839304f"
} as const);
export const SOURCE_ADAPTER_CONTRACTS = Object.freeze({
"44100": Object.freeze({
"coefficientAsset": Object.freeze({
"byteSize": 35284,
"path": "apps/customer-web/public/model-assets/practice-acoustic/fir-160-441.f32",
"sha256": "d54df355dba1e60395e165f0a44a3d016e25632af639be767c861e1bfd61e620"
} as const),
"down": 441,
"sourceRateHz": 44100,
"up": 160,
"targetRateHz": 16000,
"tapCount": 8821,
"realSourceLookaheadSamples": 28,
"firstFullyRealOutputIndex": 10,
"coefficientUrl": "/model-assets/practice-acoustic/fir-160-441.f32",
"identitySha256": "913707d8a9340ac9ae3f8154645aa63440f8bf37145bf3a920f29041f1b141ff"
} as const),
"48000": Object.freeze({
"coefficientAsset": Object.freeze({
"byteSize": 244,
"path": "apps/customer-web/public/model-assets/practice-acoustic/fir-1-3.f32",
"sha256": "0edd2896f0923a575a7f01fb2460b529409899e9ba187f213a36037f3ef9218f"
} as const),
"down": 3,
"sourceRateHz": 48000,
"up": 1,
"targetRateHz": 16000,
"tapCount": 61,
"realSourceLookaheadSamples": 30,
"firstFullyRealOutputIndex": 10,
"coefficientUrl": "/model-assets/practice-acoustic/fir-1-3.f32",
"identitySha256": "76526a9fed0cade27a3510b9293db7fed2a87775ab932148b5b01b87539a2cc1"
} as const)
} as const);
export const ACOUSTIC_MODEL_ASSET_DESCRIPTOR = Object.freeze({
"schemaVersion": 1,
"assetId": "practice-acoustic-robust-browser",
"assetVersion": "v1",
"expectedByteSize": 98689283,
"sha256": "4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3",
"mediaType": "application/octet-stream"
} as const);
export const ACOUSTIC_TARGET_SAMPLES_PER_MS = ACOUSTIC_RUNTIME_CONTRACT.input.sampleRateHz / 1000;

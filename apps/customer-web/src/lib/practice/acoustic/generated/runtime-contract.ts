// Generated from contracts/practice/acoustic/runtime-contract.json and evidence-attestation.json. Do not edit.
export const ACOUSTIC_RUNTIME_CONTRACT = Object.freeze({
"decoder": Object.freeze({
"frameThreshold": 0.05,
"identity": "A",
"midiPitchStart": 21,
"onsetThreshold": 0.3,
"outputFrameRateHz": 100
} as const),
"identityName": "practice-acoustic-robust-browser@v1",
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
export const ACOUSTIC_EVIDENCE_ATTESTATION = Object.freeze({
"coefficientAssets": Object.freeze([Object.freeze({
"scope": "Exact raw float32 little-endian FIR bytes declared by the runtime contract.",
"sourceRateHz": 44100
} as const), Object.freeze({
"scope": "Exact raw float32 little-endian FIR bytes declared by the runtime contract.",
"sourceRateHz": 48000
} as const)] as const),
"schemaVersion": 1,
"scope": "Selected evidence-producing source implementations and exact shipped FIR assets; not an executable dependency closure.",
"sourceFiles": Object.freeze({
"decoder": Object.freeze({
"byteSize": 2963,
"normalization": "UTF8_CRLF_TO_LF",
"path": "apps/customer-web/src/lib/practice/acoustic/model/robust-piano-decoder.ts",
"scope": "Contiguous onset regions choose the first maximum, gate on frame support and retain the minimum confidence. Events sort by time then pitch.",
"sha256": "fbe70e5a64dac97cb3109fabef88b13d79548f1bfc62b815d5720ae38feb82cf"
} as const),
"sourceAdapter": Object.freeze({
"byteSize": 2788,
"normalization": "UTF8_CRLF_TO_LF",
"path": "apps/customer-web/src/lib/practice/acoustic/source/source-adapter.ts",
"scope": "Rational FIR uses float32 products and each accumulation, persistent bounded source state, origin zeros only and no fitted shift or gain normalization.",
"sha256": "0a35ad923f30e70abe8c7a7f2d2d3cc7ffd708356e0ad960a9a48bdda42670b5"
} as const),
"sourceAnalysis": Object.freeze({
"byteSize": 13041,
"normalization": "UTF8_CRLF_TO_LF",
"path": "apps/customer-web/src/lib/practice/acoustic/runtime/source-analysis-runtime.ts",
"scope": "Sequential source windows produce immutable all-pitch observations with source sample identity, half-open ownership and analyzed-through coverage. Source event time and publication availability use separate clocks. No score, target or verdict enters source analysis.",
"sha256": "b9ce4414252dc3b46d50ea0d755e3379ccc4b9100b9249667b7119894958b47c"
} as const),
"sourcePublication": Object.freeze({
"byteSize": 8461,
"normalization": "UTF8_CRLF_TO_LF",
"path": "apps/customer-web/src/lib/practice/acoustic/runtime/source-publication.ts",
"scope": "Immutable source observations use half-open ownership and a publication clock independent of source event time.",
"sha256": "5b01c9e2f4e05f31e96d67050d8dc0352de2b1659c916422d758980c40001dfc"
} as const),
"windowPlanner": Object.freeze({
"byteSize": 2260,
"normalization": "UTF8_CRLF_TO_LF",
"path": "apps/customer-web/src/lib/practice/acoustic/runtime/window-planner.ts",
"scope": "Half-open sample ownership uses real past and future context; final partial ownership shifts the full input without padding.",
"sha256": "6e3cd261465b8517a02c4a82aaac8e2b8306e5a9cc86201de7a58690587a663b"
} as const)
} as const)
} as const);
export const ACOUSTIC_ANALYSIS_IDENTITY = Object.freeze({
"identityName": "practice-acoustic-robust-browser@v1",
"runtimeContractSha256": "e009b656bc73df18192d012d36170dcd9b5d05f9739bfa179293315baf1bb562",
"evidenceAttestationSha256": "a02cde8335103152dd8949abdfb6868b890e59e12b7064572fa8884941978cb2",
"analysisIdentitySha256": "242820728f9acccfe3bf2b1402ae79ccb0e14c6894e1a52a3f1637425d198e51"
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
"analysisIdentitySha256": "242820728f9acccfe3bf2b1402ae79ccb0e14c6894e1a52a3f1637425d198e51",
"identitySha256": "baaba6e41f462b582a9722fde5d219dc5d4e34c061c9c6fb718f3c47017c8b2b"
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
"analysisIdentitySha256": "242820728f9acccfe3bf2b1402ae79ccb0e14c6894e1a52a3f1637425d198e51",
"identitySha256": "ac7c2707f1079f235d604dc08c7b6acef30218f32d2586c77ba1973f72b01f17"
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

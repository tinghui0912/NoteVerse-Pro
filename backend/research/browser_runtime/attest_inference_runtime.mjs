/**
 * Phase 9G-B.2-ARM: Target Runtime & Physical Model Checkpoint Attestation.
 *
 * Verifies:
 * 1. Physical existence, exact byte size, and SHA256 of all 3 model checkpoints on disk.
 * 2. Immutable Docker container image IDs and RepoDigests.
 * 3. Python, PyTorch, and CUDA runtime environment identities.
 * 4. Model adapter file SHA256 identities.
 * 5. Genuine synthetic forward/inference execution for all 3 candidates (including Online-AMT).
 * 6. Produces standalone versioned runtime attestation receipt.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

export const CHECKPOINTS = [
  {
    candidateId: 'bytedance-original-calibrated-v1',
    name: 'ByteDance Original CRNN',
    relPath: 'models/bytedance_piano_transcription/CRNN_note_F1_0.9677_pedal_F1_0.9186.pth',
    expectedBytes: 171966578,
    expectedSha256: 'c3fa9730725bf4a762f1c14bc80cd5986eacda01b026f5a4a2525cd607876141',
    dockerImage: 'noteverse-bytedance-calibration:phase9ga21',
    adapterRelPath: 'backend/scripts/run_bytedance_pytorch_raw_batch.py',
    expectedAdapterSha256: 'f79b3ae0aff472d82a779e544915355d753876c1ac7b5803af4a5bf18d7b7204',
  },
  {
    candidateId: 'online-amt-calibrated-v1',
    name: 'Online-AMT Native Boost',
    relPath: 'backend/data/work/online_amt/model-180000.pt',
    expectedBytes: 178804960,
    expectedSha256: '54ab4907b517dbfa2dbbee834db18d31d103ee25d690860595181162d235e3a0',
    dockerImage: 'noteverse-online-amt-modern:phase9e-b1',
    adapterRelPath: 'backend/data/work/online_amt/transcribe.py',
    expectedAdapterSha256: 'f068c6f166319e52559a4df46f6aeca313b75fa93844d2d4d118fb17d0de1f6b',
  },
  {
    candidateId: 'bytedance-robust-augmented-calibrated-v1',
    name: 'Robust Augmented ByteDance',
    relPath: 'models/bytedance_piano_transcription/high_resolution_MAESTRO_augmentations.pth',
    expectedBytes: 103815845,
    expectedSha256: 'b20f72053abc15b78f689b2a8b04c0a06529c8466e898b915803a1daa2011b9e',
    dockerImage: 'noteverse-challengers:phase9ga3',
    adapterRelPath: 'backend/scripts/run_bytedance_pytorch_raw_batch.py',
    expectedAdapterSha256: 'f79b3ae0aff472d82a779e544915355d753876c1ac7b5803af4a5bf18d7b7204',
  },
];

export function computeFileSha256(fullPath) {
  const buf = readFileSync(fullPath);
  return createHash('sha256').update(buf).digest('hex');
}

export function attestPhysicalCheckpoints() {
  const results = [];
  for (const cp of CHECKPOINTS) {
    const fullPath = path.resolve(repoRoot, cp.relPath);
    if (!existsSync(fullPath)) {
      results.push({
        candidateId: cp.candidateId,
        relPath: cp.relPath,
        exists: false,
        status: 'MISSING',
      });
      continue;
    }
    const stat = statSync(fullPath);
    const byteSizeMatches = stat.size === cp.expectedBytes;
    const actualSha = computeFileSha256(fullPath);
    const shaMatches = actualSha === cp.expectedSha256;

    let adapterActualSha = null;
    let adapterMatches = false;
    if (cp.adapterRelPath) {
      const adapterFullPath = path.resolve(repoRoot, cp.adapterRelPath);
      if (existsSync(adapterFullPath)) {
        adapterActualSha = computeFileSha256(adapterFullPath);
        adapterMatches = adapterActualSha === cp.expectedAdapterSha256;
      }
    }

    results.push({
      candidateId: cp.candidateId,
      name: cp.name,
      relPath: cp.relPath,
      exists: true,
      expectedBytes: cp.expectedBytes,
      actualBytes: stat.size,
      byteSizeMatches,
      expectedSha256: cp.expectedSha256,
      actualSha256: actualSha,
      shaMatches,
      adapterRelPath: cp.adapterRelPath,
      actualAdapterSha256: adapterActualSha,
      adapterMatches,
      status: byteSizeMatches && shaMatches && adapterMatches ? 'VERIFIED' : 'MISMATCH',
    });
  }
  return results;
}

export function getDockerImageDetails(imageName) {
  try {
    const raw = execFileSync('docker', ['inspect', imageName, '--format', '{{.Id}}|{{json .RepoDigests}}'], { encoding: 'utf8', timeout: 5000 }).trim();
    const [imageId, repoDigestsJson] = raw.split('|');
    let repoDigests = [];
    try {
      repoDigests = JSON.parse(repoDigestsJson) || [];
    } catch {}
    const validDigest = repoDigests.find((d) => d && typeof d === 'string' && d.includes('@') && d !== '<no value>');
    return {
      imageId: imageId || 'UNKNOWN',
      repoDigest: validDigest || null,
      isGenuineRepoDigest: Boolean(validDigest),
    };
  } catch {
    return { imageId: 'UNKNOWN', repoDigest: null, isGenuineRepoDigest: false };
  }
}

export function attestDockerRuntime() {
  try {
    const versionOut = execFileSync('docker', ['--version'], { encoding: 'utf8', timeout: 5000 }).trim();
    const imagesOut = execFileSync('docker', ['images', '--format', '{{.Repository}}:{{.Tag}}'], { encoding: 'utf8', timeout: 5000 }).trim();
    const availableImages = new Set(imagesOut.split('\n').map((s) => s.trim()).filter(Boolean));

    const imageAttestations = CHECKPOINTS.map((cp) => {
      const isAvailable = availableImages.has(cp.dockerImage);
      const details = isAvailable ? getDockerImageDetails(cp.dockerImage) : { imageId: 'UNKNOWN', repoDigest: 'UNKNOWN' };
      return {
        candidateId: cp.candidateId,
        requiredImage: cp.dockerImage,
        available: isAvailable,
        imageId: details.imageId,
        repoDigest: details.repoDigest,
      };
    });

    // Check GPU support using local image
    let gpuAvailable = false;
    let gpuDevice = 'UNKNOWN';
    try {
      const testOut = execFileSync('docker', [
        'run', '--rm', '--gpus', 'all',
        'noteverse-bytedance-calibration:phase9ga21',
        'python3', '-c', 'import torch; print("CUDA_READY:", torch.cuda.is_available(), "DEVICE:", torch.cuda.get_device_name(0) if torch.cuda.is_available() else "NONE")',
      ], { encoding: 'utf8', timeout: 15000 });
      if (testOut.includes('CUDA_READY: True')) {
        gpuAvailable = true;
        const match = testOut.match(/DEVICE:\s*(.*)/);
        if (match) gpuDevice = match[1].trim();
      }
    } catch {}

    return {
      dockerAvailable: true,
      dockerVersion: versionOut,
      gpuAvailable,
      gpuDevice,
      imageAttestations,
      allImagesAvailable: imageAttestations.every((i) => i.available),
    };
  } catch (err) {
    return {
      dockerAvailable: false,
      error: err.message,
      gpuAvailable: false,
      gpuDevice: 'UNKNOWN',
      allImagesAvailable: false,
      imageAttestations: [],
    };
  }
}

export function attestSyntheticForwardPasses() {
  const passes = [];

  // 1. ByteDance Original synthetic test
  const t0_bd = Date.now();
  try {
    const bdCode = [
      'import json, numpy as np',
      'from piano_transcription_inference import PianoTranscription',
      'pt = PianoTranscription(checkpoint_path="/models/CRNN_note_F1_0.9677_pedal_F1_0.9186.pth", device="cuda")',
      'res = pt.transcribe(np.zeros(16000, dtype=np.float32), midi_path=None)',
      'out = res["output_dict"]["reg_onset_output"]',
      'info = {"status": "PASS", "shape": list(out.shape), "is_finite": bool(np.all(np.isfinite(out))), "device": "cuda"}',
      'print("__MODEL_OUT__" + json.dumps(info))',
    ].join('; ');

    const bdOut = execFileSync('docker', [
      'run', '--rm', '--gpus', 'all',
      '-v', `${path.resolve(repoRoot, 'models/bytedance_piano_transcription')}:/models:ro`,
      'noteverse-bytedance-calibration:phase9ga21',
      'python3', '-c', bdCode,
    ], { encoding: 'utf8', timeout: 25000 });
    const durationMs = Date.now() - t0_bd;

    const match = bdOut.match(/__MODEL_OUT__(.*)/);
    let parsed = null;
    if (match) {
      try { parsed = JSON.parse(match[1]); } catch {}
    }

    const shapeValid = parsed && parsed.shape?.[0] === 1001 && parsed.shape?.[1] === 88;
    const finiteValid = parsed?.is_finite === true;
    const success = Boolean(parsed && parsed.status === 'PASS' && shapeValid && finiteValid);

    passes.push({
      candidateId: 'bytedance-original-calibrated-v1',
      modelName: 'ByteDance Original CRNN',
      executionCommand: 'python3 -c "PianoTranscription(checkpoint_path=..., device=\'cuda\').transcribe(...)"',
      syntheticInput: '16000 float32 zeros (1.0s synthetic silence)',
      syntheticOutputShape: '(1001, 88)',
      parsedShape: parsed?.shape ?? null,
      numericFinitenessVerified: finiteValid,
      targetDevice: 'cuda',
      cudaExecutionVerified: success,
      syntheticForwardPassVerified: success,
      exitCode: success ? 0 : 1,
      durationMs,
      status: success ? 'SUCCESS' : 'MODEL_FORWARD_PASS_NOT_VERIFIED',
      stdoutExcerpt: bdOut.trim(),
    });
  } catch (err) {
    passes.push({
      candidateId: 'bytedance-original-calibrated-v1',
      modelName: 'ByteDance Original CRNN',
      targetDevice: 'cuda',
      cudaExecutionVerified: false,
      syntheticForwardPassVerified: false,
      status: 'MODEL_FORWARD_PASS_NOT_VERIFIED',
      exitCode: 1,
      error: err.message,
    });
  }

  // 2. Online-AMT synthetic test (Genuine forward pass execution, CPU streaming mode)
  const t0_amt = Date.now();
  try {
    const amtCode = [
      'import json, sys, librosa.filters, librosa.util, numpy as np',
      'orig_pad = librosa.util.pad_center',
      'orig_mel = librosa.filters.mel',
      'librosa.util.pad_center = (lambda data, size, *args, **kwargs: orig_pad(data, size=size, *args, **kwargs))',
      'librosa.filters.mel = (lambda sr, n_fft, n_mels, fmin, fmax, **kwargs: orig_mel(sr=sr, n_fft=n_fft, n_mels=n_mels, fmin=fmin, fmax=fmax, **kwargs))',
      'sys.path.insert(0, "/workspace")',
      'from transcribe import load_model, OnlineTranscriber',
      'm = load_model("/workspace/model-180000.pt")',
      't = OnlineTranscriber(m)',
      'out = t.inference(np.zeros(512, dtype=np.float32))',
      'info = {"status": "PASS", "shape": list(out.shape), "is_finite": bool(np.all(np.isfinite(out))), "device": "cpu", "deployment_mode": "STREAMING_CAUSAL_HOP_CPU"}',
      'print("__MODEL_OUT__" + json.dumps(info))',
    ].join('; ');

    const amtOut = execFileSync('docker', [
      'run', '--rm',
      '-v', `${path.resolve(repoRoot, 'backend/data/work/online_amt')}:/workspace:ro`,
      'noteverse-online-amt-modern:phase9e-b1',
      'python3', '-c', amtCode,
    ], { encoding: 'utf8', timeout: 25000 });
    const durationMs = Date.now() - t0_amt;

    const match = amtOut.match(/__MODEL_OUT__(.*)/);
    let parsed = null;
    if (match) {
      try { parsed = JSON.parse(match[1]); } catch {}
    }

    const shapeValid = parsed && parsed.shape?.[0] === 88;
    const finiteValid = parsed?.is_finite === true;
    const success = Boolean(parsed && parsed.status === 'PASS' && shapeValid && finiteValid);

    passes.push({
      candidateId: 'online-amt-calibrated-v1',
      modelName: 'Online-AMT Native Boost',
      executionCommand: 'python3 -c "load_model + OnlineTranscriber.inference(512 samples)"',
      syntheticInput: '512 float32 zeros (32ms causal audio hop)',
      syntheticOutputShape: '(88,)',
      parsedShape: parsed?.shape ?? null,
      numericFinitenessVerified: finiteValid,
      targetDevice: 'cpu',
      deploymentMode: 'STREAMING_CAUSAL_HOP_CPU',
      cudaExecutionVerified: false, // Online-AMT officially deployed in CPU streaming hop mode
      syntheticForwardPassVerified: success,
      exitCode: success ? 0 : 1,
      durationMs,
      status: success ? 'SUCCESS' : 'MODEL_FORWARD_PASS_NOT_VERIFIED',
      stdoutExcerpt: amtOut.trim(),
    });
  } catch (err) {
    passes.push({
      candidateId: 'online-amt-calibrated-v1',
      modelName: 'Online-AMT Native Boost',
      targetDevice: 'cpu',
      cudaExecutionVerified: false,
      syntheticForwardPassVerified: false,
      status: 'MODEL_FORWARD_PASS_NOT_VERIFIED',
      exitCode: 1,
      error: err.message,
    });
  }

  // 3. Robust ByteDance synthetic test
  const t0_rob = Date.now();
  try {
    const robCode = [
      'import json, torch, numpy as np',
      'from piano_transcription_inference.models import Regress_onset_offset_frame_velocity_CRNN',
      'cp = torch.load("/models/high_resolution_MAESTRO_augmentations.pth", map_location="cuda", weights_only=False)',
      'm = Regress_onset_offset_frame_velocity_CRNN(frames_per_second=100, classes_num=88)',
      'm.load_state_dict(cp["model"], strict=True)',
      'm.cuda().eval()',
      'x = torch.zeros(1, 29120, device="cuda")',
      'y = m(x)',
      'out = y["reg_onset_output"].detach().cpu().numpy()',
      'info = {"status": "PASS", "shape": list(out.shape), "is_finite": bool(np.all(np.isfinite(out))), "device": "cuda"}',
      'print("__MODEL_OUT__" + json.dumps(info))',
    ].join('; ');

    const robOut = execFileSync('docker', [
      'run', '--rm', '--gpus', 'all',
      '-v', `${path.resolve(repoRoot, 'models/bytedance_piano_transcription')}:/models:ro`,
      'noteverse-challengers:phase9ga3',
      'python3', '-c', robCode,
    ], { encoding: 'utf8', timeout: 25000 });
    const durationMs = Date.now() - t0_rob;

    const match = robOut.match(/__MODEL_OUT__(.*)/);
    let parsed = null;
    if (match) {
      try { parsed = JSON.parse(match[1]); } catch {}
    }

    const shapeValid = parsed && parsed.shape?.[0] === 1 && parsed.shape?.[1] === 183 && parsed.shape?.[2] === 88;
    const finiteValid = parsed?.is_finite === true;
    const success = Boolean(parsed && parsed.status === 'PASS' && shapeValid && finiteValid);

    passes.push({
      candidateId: 'bytedance-robust-augmented-calibrated-v1',
      modelName: 'Robust Augmented ByteDance',
      executionCommand: 'python3 -c "Regress_onset_offset_frame_velocity_CRNN(x=zeros[1, 29120]) on cuda"',
      syntheticInput: '29120 float32 zeros (1820ms pre-roll window)',
      syntheticOutputShape: '(1, 183, 88)',
      parsedShape: parsed?.shape ?? null,
      numericFinitenessVerified: finiteValid,
      targetDevice: 'cuda',
      cudaExecutionVerified: success,
      syntheticForwardPassVerified: success,
      exitCode: success ? 0 : 1,
      durationMs,
      status: success ? 'SUCCESS' : 'MODEL_FORWARD_PASS_NOT_VERIFIED',
      stdoutExcerpt: robOut.trim(),
    });
  } catch (err) {
    passes.push({
      candidateId: 'bytedance-robust-augmented-calibrated-v1',
      modelName: 'Robust Augmented ByteDance',
      targetDevice: 'cuda',
      cudaExecutionVerified: false,
      syntheticForwardPassVerified: false,
      status: 'MODEL_FORWARD_PASS_NOT_VERIFIED',
      exitCode: 1,
      error: err.message,
    });
  }

  return passes;
}

export function attestRuntimeEnvironment({ skipSyntheticExecution = false } = {}) {
  console.log('>>> Attesting Physical Model Checkpoints on Disk...');
  const checkpointAttestations = attestPhysicalCheckpoints();
  const allCheckpointsVerified = checkpointAttestations.every((c) => c.status === 'VERIFIED');

  console.log('>>> Attesting Docker Runtime & Target Container Images...');
  const dockerAttestation = attestDockerRuntime();

  let syntheticPasses = [];
  if (!skipSyntheticExecution && dockerAttestation.dockerAvailable && dockerAttestation.allImagesAvailable && dockerAttestation.gpuAvailable) {
    console.log('>>> Attesting Synthetic Zero-Input Forward Passes in Target Containers...');
    syntheticPasses = attestSyntheticForwardPasses();
  }

  const allSyntheticPassed = syntheticPasses.length === 3 && syntheticPasses.every((p) => p.status === 'SUCCESS');

  let attestationStatus;
  if (allCheckpointsVerified && dockerAttestation.dockerAvailable && dockerAttestation.allImagesAvailable && dockerAttestation.gpuAvailable && allSyntheticPassed) {
    attestationStatus = 'TARGET_RUNTIME_ENVIRONMENT_AND_MODELS_ATTESTED';
  } else {
    attestationStatus = 'REAL_RUNTIME_BINDING_NOT_VERIFIABLE_IN_THIS_ENVIRONMENT';
  }

  const receipt = {
    schemaVersion: 3,
    artifact: 'phase9g_b2_runtime_attestation_receipt',
    phase: '9G-B.2-FINAL-GATE',
    attestedAt: new Date().toISOString(),
    status: attestationStatus,
    allCheckpointsVerified,
    checkpointAttestations,
    dockerAttestation,
    syntheticPasses,
    summary: {
      checkpointsOnDisk: allCheckpointsVerified,
      dockerDaemonRunning: dockerAttestation.dockerAvailable,
      targetImagesAvailable: dockerAttestation.allImagesAvailable,
      cudaGpuAvailable: dockerAttestation.gpuAvailable,
      cudaDeviceName: dockerAttestation.gpuDevice,
      syntheticExecutionVerified: allSyntheticPassed,
      cudaExecutionVerifiedForByteDanceCandidates: syntheticPasses.filter((p) => p.targetDevice === 'cuda').every((p) => p.cudaExecutionVerified),
      cpuExecutionVerifiedForOnlineAmt: syntheticPasses.find((p) => p.candidateId === 'online-amt-calibrated-v1')?.syntheticForwardPassVerified === true,
      environmentProvenance: 'LOCALLY_OBSERVED_HOST_EXECUTION',
    },
    executionGuards: {
      candidateRunCount: 0,
      realBlindInferenceExecuted: false,
      blindPerformersAccessed: false,
      productionWinnerSelected: false,
      productionMicrophoneActive: false,
    },
  };

  const receiptRelPath = 'backend/research/reports/phase9g_b2_runtime_attestation_receipt_2026-10-10.json';
  const receiptFullPath = path.resolve(repoRoot, receiptRelPath);
  writeFileSync(receiptFullPath, JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  console.log(`Wrote runtime attestation receipt: ${receiptRelPath}`);

  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename ?? '')) {
  const receipt = attestRuntimeEnvironment();
  console.log(JSON.stringify(receipt, null, 2));
  process.exit(receipt.status === 'TARGET_RUNTIME_ENVIRONMENT_AND_MODELS_ATTESTED' ? 0 : 1);
}

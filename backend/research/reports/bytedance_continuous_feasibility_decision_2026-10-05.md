# ByteDance Continuous Feasibility Decision

- Verdict: `FAIL`
- Git HEAD: `c89f0ffd2cf3646fd8ebd0df26d30c21971174d7`
- Production state: `CONTINUOUS_ANALYSIS_UNAVAILABLE`
- Model disposition: ByteDance remains STEP-only for now; current note_model is rejected for Continuous microphone under this gate.

## Gates
- fixedVsDynamicB1Parity: `PASS`
- dynamicBatchExportParity: `PASS`
- dynamicBatchInvariance: `PASS`
- chromeWebgpuRawParity: `PASS`
- trustedRegion: `FAIL`
- onlineSchedule: `NOT_RUN_NO_TRUSTED_REGION`
- productionLikeEndToEnd: `NOT_RUN_NO_TRUSTED_REGION`
- p95EffectiveRealtime: `BLOCKED`

## Trusted Region
- Status: `FAIL`
- Reason: No grid position passed every required category.
- Position grid ms: `[120, 240, 360, 480, 600, 760, 920, 1080, 1240, 1400, 1560, 1700]`
- Category counts: `{'single_note': 32, 'chord': 32, 'same_note_retrigger': 32, 'dense_repeated_pitch': 32, 'fast_scale_adjacent_pitches': 32, 'partial_overlapping_notes': 32, 'soft_attack': 32, 'loud_attack': 32}`

## Evidence
- `bytedance_continuous_batch_export_parity_2026-10-05.json`: `bbc82865f935aa211b45515e1ad59102ffe44ebd1f702dc363e94ac746e39139`
- `bytedance_continuous_batch_invariance_2026-10-05.json`: `68d2aa9d19b1e16db7aeaddf1d09458bc14459d942d1a20c1f41e398eebb80a5`
- `bytedance_continuous_browser_batch_benchmark_2026-10-05.json`: `2c9fddb3b13540d5c29a468250742f38fbdfa0c7f3dd601d20b03663251aad83`
- `bytedance_continuous_trusted_region_dataset_2026-10-05.json`: `66523dace2604dccca7985dbd8f3b15d07f01efdc9f6b275da47c65fa9cb5fad`
- `bytedance_continuous_trusted_region_2026-10-05.json`: `52888bde797591c2ccd97f6456f9aee168f639940ae51581521d9aefbacc87f6`
- `bytedance_continuous_online_schedule_2026-10-05.json`: `382aff3d2a7ee762f6312e412ebce4063a765485ca48d79c20a9b29138c72a9c`
- `bytedance_continuous_end_to_end_browser_2026-10-05.json`: `704b2a7da29329f3205a96722c80607c4e7c1cb99669813e3281646853c6b7f0`

## Blockers
- Trusted-region gate failed; no one-owner geometry can be selected.

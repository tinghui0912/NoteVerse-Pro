# XC2 Robust Product Verdict And Latency Baseline

Disposition: ROBUST_PRODUCT_BASELINE_MULTIPLE_PARETO_CANDIDATES

Research only. Commercial qualification: NOT_PERFORMED. Production microphone: false. No D4 or production winner.

## Interpretation

F5 measured ACOUSTIC_ONSET_TRANSCRIPTION, not product verdict correctness. A physically played wrong/extra note is an acoustic true onset. Historical 9G-B remains product-level history, not current browser production qualification.

Reported verdict times are deterministic logical closure driven by real causal browser publications. Projector compute time, UI rendering and human-perception latency are NOT measured. PRODUCT_LATENCY_SLO_NOT_YET_FROZEN; product latency readiness remains NOT_YET_QUALIFIED.

## Frozen Study

Starting HEAD: ad901f9f36c588191b5f1f7ff626c0b02512846a
Implementation: 3db448faa30eef5ee491145747cee18fd2bdfb65
Evaluation shortlist commit: c3855b27121b24c827230ddfe5ea5b8305d6c009
Protocol SHA256: 532ff445ff9b46b19af2f1f579b16cdd93d7f2c3abef545d4cc4b1b539e6daeb

Exactly 10 center28s SMD real-audio clips:5 DEVELOPMENT,5 EVALUATION. Source preprocessing and physical MIDI extraction ran in Docker; only Robust ran in headed system Chrome, default hardware WebGPU. No Online-AMT, Basic Pitch or Edge execution.

DEVELOPMENT: 6 decoder/resampler comparisons, 60 geometric configuration scores. EVALUATION: 22 frozen configurations sharing 16 input-stream types x 5 clips = 80 executions. Across the study: 201 streams, 24,378 raw tensor files and 12,792 actual ORT calls including warmup. One ORT Web 1.30 control only.

## Clips
- DEVELOPMENT: xc2_00_chopin_op026no1_003_20100611-smd; source crop 217..245s.
- EVALUATION: xc2_01_mozart_kv398_002_20110315-smd; source crop 207..235s.
- DEVELOPMENT: xc2_02_beethoven_op031no2-01_002_20090916-smd; source crop 251..279s.
- EVALUATION: xc2_03_bach_bwv875-02_002_20090916-smd; source crop 45..73s.
- DEVELOPMENT: xc2_04_chopin_op028-01_003_20100611-smd; source crop 2..30s.
- EVALUATION: xc2_05_ravel_valsesnoblesetsentimentales_003_20090916-smd; source crop 445..473s.
- DEVELOPMENT: xc2_06_rachmaninoff_op036-01_007_20110315-smd; source crop 267..295s.
- EVALUATION: xc2_07_bartok_sz080-03_002_20110315-smd; source crop 93..121s.
- DEVELOPMENT: xc2_08_brahms_op005-01_002_20110315-smd; source crop 230..258s.
- EVALUATION: xc2_09_chopin_op066_006_20100611-smd; source crop 141..169s.

Full WAV/MIDI/PCM identities and construction rules are in the JSON report and clip-source manifest. MIDI never entered model inputs or acoustic decoders.

## Coverage

All families meet 20 examples across ten clips: {"CORRECT_SINGLE":80,"CORRECT_CHORD":75,"MISSING_SINGLE":80,"WRONG_SEMITONE":80,"INCOMPLETE_CHORD":75,"EXTRA_NOTE":80,"SAME_PITCH_RETRIGGER":54,"SUSTAINED_NO_RETRIGGER":67}.

## Pareto Result

No single preferred configuration is manufactured. These seven configurations remain observational Pareto tradeoffs:

- BAND_LIMITED_B_500_120
- BAND_LIMITED_A_500_170
- BAND_LIMITED_A_500_220
- BAND_LIMITED_B_500_220
- BAND_LIMITED_A_600_120
- BAND_LIMITED_B_600_120
- BAND_LIMITED_A_600_170

All three critical false-acceptance counts are 0 in this finite EVALUATION sample. This is not proof of zero population risk or non-inferiority. Runtime classifications are sample-specific; historical R4 is unchanged.

## Five-Verdict Tables

Each percentile cell lists P50 / P95 / P99 / max. Latency samples are correctly classified target verdicts only; misses/incorrect classes are counted separately, never imputed as zero latency. Beats = latencyMs x BPM /60000. The JSON retains full precision and all background/incorrect-class latency distributions.

### LINEAR_A_600_220

Target agreement: 97.08%; expected-strike recall: 97.25%; no sustained backlog in all 5 clips: false.

| Verdict | Correctness / safety counts | Latency N | ms P50/P95/P99/max | Beats60 | Beats90 | Beats120 | Beats160 |
|---|---|---:|---|---|---|---|---|
| CORRECT | precision 177/177; recall 177/182 | 177 | 1536.3 / 4747.7 / 14254.6 / 14736.9 | 1.536 / 4.748 / 14.255 / 14.737 | 2.304 / 7.122 / 21.382 / 22.105 | 3.073 / 9.495 / 28.509 / 29.474 | 4.097 / 12.661 / 38.012 / 39.299 |
| MISSING | detected 40/40; false match 0 | 40 | 21857.7 / 27333.2 / 27505.5 / 27603.0 | 21.858 / 27.333 / 27.506 / 27.603 | 32.787 / 41.000 / 41.258 / 41.405 | 43.715 / 54.666 / 55.011 / 55.206 | 58.287 / 72.889 / 73.348 / 73.608 |
| WRONG | detected 39/40; false CORRECT 0 | 39 | 21811.3 / 27095.0 / 27500.1 / 27603.0 | 21.811 / 27.095 / 27.500 / 27.603 | 32.717 / 40.643 / 41.250 / 41.405 | 43.623 / 54.190 / 55.000 / 55.206 | 58.164 / 72.253 / 73.334 / 73.608 |
| INCOMPLETE_CHORD | detected 40/40; false complete 0 | 40 | 14864.7 / 26747.7 / 26893.1 / 26953.3 | 14.865 / 26.748 / 26.893 / 26.953 | 22.297 / 40.121 / 40.340 / 40.430 | 29.729 / 53.495 / 53.786 / 53.907 | 39.639 / 71.327 / 71.715 / 71.875 |
| EXTRA | precision 36/220; recall 36/40 | 36 | 1405.9 / 1756.7 / 1923.8 / 2002.9 | 1.406 / 1.757 / 1.924 / 2.003 | 2.109 / 2.635 / 2.886 / 3.004 | 2.812 / 3.513 / 3.848 / 4.006 | 3.749 / 4.685 / 5.130 / 5.341 |

### LINEAR_A_320_120

Target agreement: 97.08%; expected-strike recall: 97.00%; no sustained backlog in all 5 clips: false.

| Verdict | Correctness / safety counts | Latency N | ms P50/P95/P99/max | Beats60 | Beats90 | Beats120 | Beats160 |
|---|---|---:|---|---|---|---|---|
| CORRECT | precision 177/177; recall 177/182 | 177 | 1138.1 / 13301.5 / 14753.0 / 17844.7 | 1.138 / 13.302 / 14.753 / 17.845 | 1.707 / 19.952 / 22.130 / 26.767 | 2.276 / 26.603 / 29.506 / 35.689 | 3.035 / 35.471 / 39.341 / 47.586 |
| MISSING | detected 40/40; false match 0 | 40 | 21590.7 / 49331.8 / 49504.1 / 49601.6 | 21.591 / 49.332 / 49.504 / 49.602 | 32.386 / 73.998 / 74.256 / 74.402 | 43.181 / 98.664 / 99.008 / 99.203 | 57.575 / 131.551 / 132.011 / 132.271 |
| WRONG | detected 39/40; false CORRECT 0 | 39 | 21544.4 / 49093.6 / 49498.7 / 49601.6 | 21.544 / 49.094 / 49.499 / 49.602 | 32.317 / 73.640 / 74.248 / 74.402 | 43.089 / 98.187 / 98.997 / 99.203 | 57.452 / 130.916 / 131.996 / 132.271 |
| INCOMPLETE_CHORD | detected 40/40; false complete 0 | 40 | 14352.2 / 47772.2 / 48596.7 / 48797.4 | 14.352 / 47.772 / 48.597 / 48.797 | 21.528 / 71.658 / 72.895 / 73.196 | 28.704 / 95.544 / 97.193 / 97.595 | 38.273 / 127.393 / 129.591 / 130.126 |
| EXTRA | precision 36/156; recall 36/40 | 36 | 1122.5 / 2400.3 / 2627.8 / 2716.7 | 1.123 / 2.400 / 2.628 / 2.717 | 1.684 / 3.600 / 3.942 / 4.075 | 2.245 / 4.801 / 5.256 / 5.433 | 2.993 / 6.401 / 7.007 / 7.245 |

### LINEAR_A_320_170

Target agreement: 96.78%; expected-strike recall: 97.08%; no sustained backlog in all 5 clips: false.

| Verdict | Correctness / safety counts | Latency N | ms P50/P95/P99/max | Beats60 | Beats90 | Beats120 | Beats160 |
|---|---|---:|---|---|---|---|---|
| CORRECT | precision 176/176; recall 176/182 | 176 | 1628.5 / 13267.1 / 27451.8 / 28531.4 | 1.628 / 13.267 / 27.452 / 28.531 | 2.443 / 19.901 / 41.178 / 42.797 | 3.257 / 26.534 / 54.904 / 57.063 | 4.343 / 35.379 / 73.205 / 76.084 |
| MISSING | detected 40/40; false match 0 | 40 | 21621.8 / 48707.2 / 48879.5 / 48977.0 | 21.622 / 48.707 / 48.880 / 48.977 | 32.433 / 73.061 / 73.319 / 73.466 | 43.244 / 97.414 / 97.759 / 97.954 | 57.658 / 129.886 / 130.345 / 130.605 |
| WRONG | detected 39/40; false CORRECT 0 | 39 | 21575.5 / 48469.0 / 48874.1 / 48977.0 | 21.575 / 48.469 / 48.874 / 48.977 | 32.363 / 72.703 / 73.311 / 73.466 | 43.151 / 96.938 / 97.748 / 97.954 | 57.535 / 129.251 / 130.331 / 130.605 |
| INCOMPLETE_CHORD | detected 40/40; false complete 0 | 40 | 14468.0 / 47147.6 / 47972.2 / 48172.8 | 14.468 / 47.148 / 47.972 / 48.173 | 21.702 / 70.721 / 71.958 / 72.259 | 28.936 / 94.295 / 95.944 / 96.346 | 38.581 / 125.727 / 127.926 / 128.461 |
| EXTRA | precision 36/284; recall 36/40 | 36 | 1258.5 / 2896.4 / 3201.1 / 3280.2 | 1.258 / 2.896 / 3.201 / 3.280 | 1.888 / 4.345 / 4.802 / 4.920 | 2.517 / 5.793 / 6.402 / 6.560 | 3.356 / 7.724 / 8.536 / 8.747 |

### LINEAR_A_320_220

Target agreement: 96.78%; expected-strike recall: 97.08%; no sustained backlog in all 5 clips: false.

| Verdict | Correctness / safety counts | Latency N | ms P50/P95/P99/max | Beats60 | Beats90 | Beats120 | Beats160 |
|---|---|---:|---|---|---|---|---|
| CORRECT | precision 176/176; recall 176/182 | 176 | 1453.2 / 15841.7 / 27228.7 / 27462.3 | 1.453 / 15.842 / 27.229 / 27.462 | 2.180 / 23.763 / 40.843 / 41.193 | 2.906 / 31.683 / 54.457 / 54.925 | 3.875 / 42.245 / 72.610 / 73.233 |
| MISSING | detected 40/40; false match 0 | 40 | 21693.7 / 48210.3 / 48382.6 / 48480.1 | 21.694 / 48.210 / 48.383 / 48.480 | 32.541 / 72.315 / 72.574 / 72.720 | 43.387 / 96.421 / 96.765 / 96.960 | 57.850 / 128.561 / 129.020 / 129.280 |
| WRONG | detected 39/40; false CORRECT 0 | 39 | 21647.3 / 47972.1 / 48377.2 / 48480.1 | 21.647 / 47.972 / 48.377 / 48.480 | 32.471 / 71.958 / 72.566 / 72.720 | 43.295 / 95.944 / 96.754 / 96.960 | 57.726 / 127.926 / 129.006 / 129.280 |
| INCOMPLETE_CHORD | detected 40/40; false complete 0 | 40 | 14445.6 / 46650.7 / 47475.3 / 47675.9 | 14.446 / 46.651 / 47.475 / 47.676 | 21.668 / 69.976 / 71.213 / 71.514 | 28.891 / 93.301 / 94.951 / 95.352 | 38.522 / 124.402 / 126.601 / 127.136 |
| EXTRA | precision 36/220; recall 36/40 | 36 | 1257.6 / 2489.9 / 2804.2 / 2893.2 | 1.258 / 2.490 / 2.804 / 2.893 | 1.886 / 3.735 / 4.206 / 4.340 | 2.515 / 4.980 / 5.608 / 5.786 | 3.354 / 6.640 / 7.478 / 7.715 |

### LINEAR_A_400_120

Target agreement: 97.08%; expected-strike recall: 97.16%; no sustained backlog in all 5 clips: false.

| Verdict | Correctness / safety counts | Latency N | ms P50/P95/P99/max | Beats60 | Beats90 | Beats120 | Beats160 |
|---|---|---:|---|---|---|---|---|
| CORRECT | precision 177/177; recall 177/182 | 177 | 1429.9 / 12681.2 / 21615.9 / 22098.1 | 1.430 / 12.681 / 21.616 / 22.098 | 2.145 / 19.022 / 32.424 / 33.147 | 2.860 / 25.362 / 43.232 / 44.196 | 3.813 / 33.816 / 57.642 / 58.928 |
| MISSING | detected 40/40; false match 0 | 40 | 25896.5 / 36202.9 / 36481.4 / 36562.6 | 25.897 / 36.203 / 36.481 / 36.563 | 38.845 / 54.304 / 54.722 / 54.844 | 51.793 / 72.406 / 72.963 / 73.125 | 69.057 / 96.541 / 97.284 / 97.500 |
| WRONG | detected 39/40; false CORRECT 0 | 39 | 25501.2 / 35908.7 / 36136.7 / 36194.9 | 25.501 / 35.909 / 36.137 / 36.195 | 38.252 / 53.863 / 54.205 / 54.292 | 51.002 / 71.817 / 72.273 / 72.390 | 68.003 / 95.756 / 96.365 / 96.520 |
| INCOMPLETE_CHORD | detected 40/40; false complete 0 | 40 | 22589.3 / 36202.9 / 36481.4 / 36562.6 | 22.589 / 36.203 / 36.481 / 36.563 | 33.884 / 54.304 / 54.722 / 54.844 | 45.179 / 72.406 / 72.963 / 73.125 | 60.238 / 96.541 / 97.284 / 97.500 |
| EXTRA | precision 36/275; recall 36/40 | 36 | 1121.0 / 1755.5 / 1863.6 / 1892.9 | 1.121 / 1.756 / 1.864 / 1.893 | 1.682 / 2.633 / 2.795 / 2.839 | 2.242 / 3.511 / 3.727 / 3.786 | 2.989 / 4.681 / 4.969 / 5.048 |

### LINEAR_A_400_170

Target agreement: 97.08%; expected-strike recall: 97.25%; no sustained backlog in all 5 clips: false.

| Verdict | Correctness / safety counts | Latency N | ms P50/P95/P99/max | Beats60 | Beats90 | Beats120 | Beats160 |
|---|---|---:|---|---|---|---|---|
| CORRECT | precision 177/177; recall 177/182 | 177 | 1087.0 / 8728.6 / 13927.0 / 14409.3 | 1.087 / 8.729 / 13.927 / 14.409 | 1.631 / 13.093 / 20.890 / 21.614 | 2.174 / 17.457 / 27.854 / 28.819 | 2.899 / 23.276 / 37.139 / 38.425 |
| MISSING | detected 40/40; false match 0 | 40 | 24637.6 / 26334.9 / 26507.2 / 26604.7 | 24.638 / 26.335 / 26.507 / 26.605 | 36.956 / 39.502 / 39.761 / 39.907 | 49.275 / 52.670 / 53.014 / 53.209 | 65.700 / 70.226 / 70.686 / 70.946 |
| WRONG | detected 39/40; false CORRECT 0 | 39 | 23962.3 / 26096.6 / 26501.7 / 26604.7 | 23.962 / 26.097 / 26.502 / 26.605 | 35.943 / 39.145 / 39.753 / 39.907 | 47.925 / 52.193 / 53.003 / 53.209 | 63.900 / 69.591 / 70.671 / 70.946 |
| INCOMPLETE_CHORD | detected 40/40; false complete 0 | 40 | 21706.6 / 25296.3 / 25681.0 / 25800.5 | 21.707 / 25.296 / 25.681 / 25.800 | 32.560 / 37.944 / 38.522 / 38.701 | 43.413 / 50.593 / 51.362 / 51.601 | 57.884 / 67.457 / 68.483 / 68.801 |
| EXTRA | precision 36/160; recall 36/40 | 36 | 1138.0 / 1933.3 / 2113.7 / 2167.7 | 1.138 / 1.933 / 2.114 / 2.168 | 1.707 / 2.900 / 3.171 / 3.252 | 2.276 / 3.867 / 4.227 / 4.335 | 3.035 / 5.155 / 5.637 / 5.780 |

### LINEAR_A_600_120

Target agreement: 97.08%; expected-strike recall: 97.17%; no sustained backlog in all 5 clips: false.

| Verdict | Correctness / safety counts | Latency N | ms P50/P95/P99/max | Beats60 | Beats90 | Beats120 | Beats160 |
|---|---|---:|---|---|---|---|---|
| CORRECT | precision 177/177; recall 177/182 | 177 | 1465.6 / 4917.4 / 13933.8 / 14416.1 | 1.466 / 4.917 / 13.934 / 14.416 | 2.198 / 7.376 / 20.901 / 21.624 | 2.931 / 9.835 / 27.868 / 28.832 | 3.908 / 13.113 / 37.157 / 38.443 |
| MISSING | detected 40/40; false match 0 | 40 | 21736.9 / 26912.0 / 27084.3 / 27181.8 | 21.737 / 26.912 / 27.084 / 27.182 | 32.605 / 40.368 / 40.626 / 40.773 | 43.474 / 53.824 / 54.169 / 54.364 | 57.965 / 71.765 / 72.225 / 72.485 |
| WRONG | detected 39/40; false CORRECT 0 | 39 | 21690.6 / 26673.8 / 27078.9 / 27181.8 | 21.691 / 26.674 / 27.079 / 27.182 | 32.536 / 40.011 / 40.618 / 40.773 | 43.381 / 53.348 / 54.158 / 54.364 | 57.842 / 71.130 / 72.210 / 72.485 |
| INCOMPLETE_CHORD | detected 40/40; false complete 0 | 40 | 14766.3 / 25655.0 / 26176.9 / 26377.6 | 14.766 / 25.655 / 26.177 / 26.378 | 22.149 / 38.482 / 39.265 / 39.566 | 29.533 / 51.310 / 52.354 / 52.755 | 39.377 / 68.413 / 69.805 / 70.340 |
| EXTRA | precision 36/211; recall 36/40 | 36 | 1460.9 / 1772.9 / 1921.2 / 1995.3 | 1.461 / 1.773 / 1.921 / 1.995 | 2.191 / 2.659 / 2.882 / 2.993 | 2.922 / 3.546 / 3.842 / 3.991 | 3.896 / 4.728 / 5.123 / 5.321 |

### LINEAR_A_600_170

Target agreement: 96.49%; expected-strike recall: 97.17%; no sustained backlog in all 5 clips: true.

| Verdict | Correctness / safety counts | Latency N | ms P50/P95/P99/max | Beats60 | Beats90 | Beats120 | Beats160 |
|---|---|---:|---|---|---|---|---|
| CORRECT | precision 175/175; recall 175/182 | 175 | 1422.6 / 4544.2 / 13903.5 / 14385.8 | 1.423 / 4.544 / 13.904 / 14.386 | 2.134 / 6.816 / 20.855 / 21.579 | 2.845 / 9.088 / 27.807 / 28.772 | 3.794 / 12.118 / 37.076 / 38.362 |
| MISSING | detected 40/40; false match 0 | 40 | 21736.0 / 26624.5 / 26796.8 / 26894.3 | 21.736 / 26.625 / 26.797 / 26.894 | 32.604 / 39.937 / 40.195 / 40.341 | 43.472 / 53.249 / 53.594 / 53.789 | 57.963 / 70.999 / 71.458 / 71.718 |
| WRONG | detected 39/40; false CORRECT 0 | 39 | 21689.6 / 26386.3 / 26791.4 / 26894.3 | 21.690 / 26.386 / 26.791 / 26.894 | 32.534 / 39.579 / 40.187 / 40.341 | 43.379 / 52.773 / 53.583 / 53.789 | 57.839 / 70.363 / 71.444 / 71.718 |
| INCOMPLETE_CHORD | detected 40/40; false complete 0 | 40 | 14810.3 / 25624.4 / 25985.7 / 26090.2 | 14.810 / 25.624 / 25.986 / 26.090 | 22.215 / 38.437 / 38.979 / 39.135 | 29.621 / 51.249 / 51.971 / 52.180 | 39.494 / 68.332 / 69.295 / 69.574 |
| EXTRA | precision 36/160; recall 36/40 | 36 | 1416.2 / 1729.0 / 1843.9 / 1904.1 | 1.416 / 1.729 / 1.844 / 1.904 | 2.124 / 2.593 / 2.766 / 2.856 | 2.832 / 3.458 / 3.688 / 3.808 | 3.776 / 4.611 / 4.917 / 5.077 |

### BAND_LIMITED_A_320_120

Target agreement: 97.08%; expected-strike recall: 97.08%; no sustained backlog in all 5 clips: false.

| Verdict | Correctness / safety counts | Latency N | ms P50/P95/P99/max | Beats60 | Beats90 | Beats120 | Beats160 |
|---|---|---:|---|---|---|---|---|
| CORRECT | precision 177/177; recall 177/182 | 177 | 993.7 / 16711.5 / 24632.3 / 26196.2 | 0.994 / 16.711 / 24.632 / 26.196 | 1.491 / 25.067 / 36.948 / 39.294 | 1.987 / 33.423 / 49.265 / 52.392 | 2.650 / 44.564 / 65.686 / 69.857 |
| MISSING | detected 40/40; false match 0 | 40 | 24596.3 / 47683.1 / 47800.5 / 47861.0 | 24.596 / 47.683 / 47.801 / 47.861 | 36.894 / 71.525 / 71.701 / 71.792 | 49.193 / 95.366 / 95.601 / 95.722 | 65.590 / 127.155 / 127.468 / 127.629 |
| WRONG | detected 39/40; false CORRECT 0 | 39 | 24207.7 / 47684.3 / 47802.1 / 47861.0 | 24.208 / 47.684 / 47.802 / 47.861 | 36.312 / 71.526 / 71.703 / 71.792 | 48.415 / 95.369 / 95.604 / 95.722 | 64.554 / 127.158 / 127.472 / 127.629 |
| INCOMPLETE_CHORD | detected 40/40; false complete 0 | 40 | 23905.7 / 39718.1 / 41178.2 / 41710.0 | 23.906 / 39.718 / 41.178 / 41.710 | 35.859 / 59.577 / 61.767 / 62.565 | 47.811 / 79.436 / 82.356 / 83.420 | 63.749 / 105.915 / 109.809 / 111.227 |
| EXTRA | precision 36/156; recall 36/40 | 36 | 1080.6 / 1587.8 / 1750.3 / 1813.0 | 1.081 / 1.588 / 1.750 / 1.813 | 1.621 / 2.382 / 2.626 / 2.720 | 2.161 / 3.176 / 3.501 / 3.626 | 2.882 / 4.234 / 4.668 / 4.835 |

### BAND_LIMITED_B_320_120

Target agreement: 97.08%; expected-strike recall: 97.41%; no sustained backlog in all 5 clips: false.

| Verdict | Correctness / safety counts | Latency N | ms P50/P95/P99/max | Beats60 | Beats90 | Beats120 | Beats160 |
|---|---|---:|---|---|---|---|---|
| CORRECT | precision 177/177; recall 177/182 | 177 | 993.9 / 16711.9 / 24632.6 / 26197.0 | 0.994 / 16.712 / 24.633 / 26.197 | 1.491 / 25.068 / 36.949 / 39.295 | 1.988 / 33.424 / 49.265 / 52.394 | 2.650 / 44.565 / 65.687 / 69.859 |
| MISSING | detected 40/40; false match 0 | 40 | 24596.4 / 47683.4 / 47800.8 / 47861.3 | 24.596 / 47.683 / 47.801 / 47.861 | 36.895 / 71.525 / 71.701 / 71.792 | 49.193 / 95.367 / 95.602 / 95.723 | 65.590 / 127.156 / 127.469 / 127.630 |
| WRONG | detected 39/40; false CORRECT 0 | 39 | 24207.8 / 47684.6 / 47802.3 / 47861.3 | 24.208 / 47.685 / 47.802 / 47.861 | 36.312 / 71.527 / 71.704 / 71.792 | 48.416 / 95.369 / 95.605 / 95.723 | 64.554 / 127.159 / 127.473 / 127.630 |
| INCOMPLETE_CHORD | detected 40/40; false complete 0 | 40 | 23905.8 / 39718.4 / 41178.5 / 41710.3 | 23.906 / 39.718 / 41.179 / 41.710 | 35.859 / 59.578 / 61.768 / 62.565 | 47.812 / 79.437 / 82.357 / 83.421 | 63.749 / 105.916 / 109.809 / 111.227 |
| EXTRA | precision 36/220; recall 36/40 | 36 | 1080.8 / 1588.1 / 1750.7 / 1813.4 | 1.081 / 1.588 / 1.751 / 1.813 | 1.621 / 2.382 / 2.626 / 2.720 | 2.162 / 3.176 / 3.501 / 3.627 | 2.882 / 4.235 / 4.668 / 4.836 |

### BAND_LIMITED_A_400_220

Target agreement: 96.49%; expected-strike recall: 97.25%; no sustained backlog in all 5 clips: false.

| Verdict | Correctness / safety counts | Latency N | ms P50/P95/P99/max | Beats60 | Beats90 | Beats120 | Beats160 |
|---|---|---:|---|---|---|---|---|
| CORRECT | precision 175/175; recall 175/182 | 175 | 3388.8 / 13847.0 / 17444.2 / 17926.5 | 3.389 / 13.847 / 17.444 / 17.926 | 5.083 / 20.771 / 26.166 / 26.890 | 6.778 / 27.694 / 34.888 / 35.853 | 9.037 / 36.925 / 46.518 / 47.804 |
| MISSING | detected 40/40; false match 0 | 40 | 29362.3 / 44467.2 / 44639.5 / 44737.0 | 29.362 / 44.467 / 44.639 / 44.737 | 44.043 / 66.701 / 66.959 / 67.105 | 58.725 / 88.934 / 89.279 / 89.474 | 78.299 / 118.579 / 119.039 / 119.299 |
| WRONG | detected 39/40; false CORRECT 0 | 39 | 28981.1 / 44229.0 / 44634.1 / 44737.0 | 28.981 / 44.229 / 44.634 / 44.737 | 43.472 / 66.343 / 66.951 / 67.105 | 57.962 / 88.458 / 89.268 / 89.474 | 77.283 / 117.944 / 119.024 / 119.299 |
| INCOMPLETE_CHORD | detected 40/40; false complete 0 | 40 | 26242.0 / 42907.6 / 43732.1 / 43932.8 | 26.242 / 42.908 / 43.732 / 43.933 | 39.363 / 64.361 / 65.598 / 65.899 | 52.484 / 85.815 / 87.464 / 87.866 | 69.979 / 114.420 / 116.619 / 117.154 |
| EXTRA | precision 36/220; recall 36/40 | 36 | 1699.7 / 2617.2 / 2728.3 / 2782.3 | 1.700 / 2.617 / 2.728 / 2.782 | 2.550 / 3.926 / 4.092 / 4.173 | 3.399 / 5.234 / 5.457 / 5.565 | 4.533 / 6.979 / 7.275 / 7.419 |

### BAND_LIMITED_B_400_220

Target agreement: 95.61%; expected-strike recall: 97.67%; no sustained backlog in all 5 clips: false.

| Verdict | Correctness / safety counts | Latency N | ms P50/P95/P99/max | Beats60 | Beats90 | Beats120 | Beats160 |
|---|---|---:|---|---|---|---|---|
| CORRECT | precision 177/177; recall 177/182 | 177 | 3404.7 / 13745.2 / 17444.5 / 17926.8 | 3.405 / 13.745 / 17.444 / 17.927 | 5.107 / 20.618 / 26.167 / 26.890 | 6.809 / 27.490 / 34.889 / 35.854 | 9.079 / 36.654 / 46.519 / 47.805 |
| MISSING | detected 36/40; false match 0 | 36 | 29743.3 / 44471.7 / 44649.8 / 44737.3 | 29.743 / 44.472 / 44.650 / 44.737 | 44.615 / 66.708 / 66.975 / 67.106 | 59.487 / 88.943 / 89.300 / 89.475 | 79.315 / 118.591 / 119.066 / 119.300 |
| WRONG | detected 39/40; false CORRECT 0 | 39 | 28981.8 / 44229.3 / 44634.4 / 44737.3 | 28.982 / 44.229 / 44.634 / 44.737 | 43.473 / 66.344 / 66.952 / 67.106 | 57.964 / 88.459 / 89.269 / 89.475 | 77.285 / 117.945 / 119.025 / 119.300 |
| INCOMPLETE_CHORD | detected 39/40; false complete 0 | 39 | 26558.9 / 42934.8 / 43737.6 / 43933.2 | 26.559 / 42.935 / 43.738 / 43.933 | 39.838 / 64.402 / 65.606 / 65.900 | 53.118 / 85.870 / 87.475 / 87.866 | 70.824 / 114.493 / 116.634 / 117.155 |
| EXTRA | precision 36/450; recall 36/40 | 36 | 1700.5 / 2483.6 / 2729.1 / 2783.1 | 1.700 / 2.484 / 2.729 / 2.783 | 2.551 / 3.725 / 4.094 / 4.175 | 3.401 / 4.967 / 5.458 / 5.566 | 4.535 / 6.623 / 7.278 / 7.422 |

### BAND_LIMITED_B_500_120

Target agreement: 97.08%; expected-strike recall: 97.58%; no sustained backlog in all 5 clips: true.

| Verdict | Correctness / safety counts | Latency N | ms P50/P95/P99/max | Beats60 | Beats90 | Beats120 | Beats160 |
|---|---|---:|---|---|---|---|---|
| CORRECT | precision 177/177; recall 177/182 | 177 | 1260.3 / 4414.6 / 14163.9 / 14646.2 | 1.260 / 4.415 / 14.164 / 14.646 | 1.890 / 6.622 / 21.246 / 21.969 | 2.521 / 8.829 / 28.328 / 29.292 | 3.361 / 11.772 / 37.770 / 39.057 |
| MISSING | detected 40/40; false match 0 | 40 | 22032.5 / 26581.8 / 26754.1 / 26851.6 | 22.032 / 26.582 / 26.754 / 26.852 | 33.049 / 39.873 / 40.131 / 40.277 | 44.065 / 53.164 / 53.508 / 53.703 | 58.753 / 70.885 / 71.344 / 71.604 |
| WRONG | detected 39/40; false CORRECT 0 | 39 | 21986.1 / 26343.6 / 26748.7 / 26851.6 | 21.986 / 26.344 / 26.749 / 26.852 | 32.979 / 39.515 / 40.123 / 40.277 | 43.972 / 52.687 / 53.497 / 53.703 | 58.630 / 70.249 / 71.330 / 71.604 |
| INCOMPLETE_CHORD | detected 40/40; false complete 0 | 40 | 14682.6 / 25405.5 / 25846.7 / 26047.4 | 14.683 / 25.405 / 25.847 / 26.047 | 22.024 / 38.108 / 38.770 / 39.071 | 29.365 / 50.811 / 51.693 / 52.095 | 39.154 / 67.748 / 68.925 / 69.460 |
| EXTRA | precision 36/464; recall 36/40 | 36 | 1331.5 / 1783.0 / 1844.8 / 1852.1 | 1.331 / 1.783 / 1.845 / 1.852 | 1.997 / 2.675 / 2.767 / 2.778 | 2.663 / 3.566 / 3.690 / 3.704 | 3.551 / 4.755 / 4.919 / 4.939 |

### BAND_LIMITED_A_500_170

Target agreement: 97.08%; expected-strike recall: 97.25%; no sustained backlog in all 5 clips: true.

| Verdict | Correctness / safety counts | Latency N | ms P50/P95/P99/max | Beats60 | Beats90 | Beats120 | Beats160 |
|---|---|---:|---|---|---|---|---|
| CORRECT | precision 177/177; recall 177/182 | 177 | 1322.1 / 4480.7 / 14207.8 / 14690.1 | 1.322 / 4.481 / 14.208 / 14.690 | 1.983 / 6.721 / 21.312 / 22.035 | 2.644 / 8.961 / 28.416 / 29.380 | 3.525 / 11.948 / 37.888 / 39.174 |
| MISSING | detected 40/40; false match 0 | 40 | 22055.0 / 26609.2 / 26781.5 / 26879.0 | 22.055 / 26.609 / 26.781 / 26.879 | 33.082 / 39.914 / 40.172 / 40.318 | 44.110 / 53.218 / 53.563 / 53.758 | 58.813 / 70.958 / 71.417 / 71.677 |
| WRONG | detected 39/40; false CORRECT 0 | 39 | 22008.6 / 26371.0 / 26776.1 / 26879.0 | 22.009 / 26.371 / 26.776 / 26.879 | 33.013 / 39.556 / 40.164 / 40.318 | 44.017 / 52.742 / 53.552 / 53.758 | 58.690 / 70.323 / 71.403 / 71.677 |
| INCOMPLETE_CHORD | detected 40/40; false complete 0 | 40 | 14715.8 / 25448.4 / 25874.1 / 26074.8 | 14.716 / 25.448 / 25.874 / 26.075 | 22.074 / 38.173 / 38.811 / 39.112 | 29.432 / 50.897 / 51.748 / 52.150 | 39.242 / 67.862 / 68.998 / 69.533 |
| EXTRA | precision 36/96; recall 36/40 | 36 | 1394.8 / 1845.2 / 1882.3 / 1889.6 | 1.395 / 1.845 / 1.882 / 1.890 | 2.092 / 2.768 / 2.823 / 2.834 | 2.790 / 3.690 / 3.765 / 3.779 | 3.719 / 4.920 / 5.020 / 5.039 |

### BAND_LIMITED_B_500_170

Target agreement: 97.08%; expected-strike recall: 97.58%; no sustained backlog in all 5 clips: true.

| Verdict | Correctness / safety counts | Latency N | ms P50/P95/P99/max | Beats60 | Beats90 | Beats120 | Beats160 |
|---|---|---:|---|---|---|---|---|
| CORRECT | precision 177/177; recall 177/182 | 177 | 1322.3 / 4481.1 / 14208.0 / 14690.2 | 1.322 / 4.481 / 14.208 / 14.690 | 1.983 / 6.722 / 21.312 / 22.035 | 2.645 / 8.962 / 28.416 / 29.380 | 3.526 / 11.950 / 37.888 / 39.174 |
| MISSING | detected 40/40; false match 0 | 40 | 22055.1 / 26609.4 / 26781.7 / 26879.2 | 22.055 / 26.609 / 26.782 / 26.879 | 33.083 / 39.914 / 40.173 / 40.319 | 44.110 / 53.219 / 53.563 / 53.758 | 58.814 / 70.958 / 71.418 / 71.678 |
| WRONG | detected 39/40; false CORRECT 0 | 39 | 22008.8 / 26371.2 / 26776.3 / 26879.2 | 22.009 / 26.371 / 26.776 / 26.879 | 33.013 / 39.557 / 40.164 / 40.319 | 44.018 / 52.742 / 53.553 / 53.758 | 58.690 / 70.323 / 71.403 / 71.678 |
| INCOMPLETE_CHORD | detected 40/40; false complete 0 | 40 | 14716.0 / 25448.6 / 25874.4 / 26075.1 | 14.716 / 25.449 / 25.874 / 26.075 | 22.074 / 38.173 / 38.812 / 39.113 | 29.432 / 50.897 / 51.749 / 52.150 | 39.243 / 67.863 / 68.998 / 69.533 |
| EXTRA | precision 36/455; recall 36/40 | 36 | 1394.9 / 1845.5 / 1882.7 / 1890.0 | 1.395 / 1.845 / 1.883 / 1.890 | 2.092 / 2.768 / 2.824 / 2.835 | 2.790 / 3.691 / 3.765 / 3.780 | 3.720 / 4.921 / 5.021 / 5.040 |

### BAND_LIMITED_A_500_220

Target agreement: 96.78%; expected-strike recall: 97.17%; no sustained backlog in all 5 clips: true.

| Verdict | Correctness / safety counts | Latency N | ms P50/P95/P99/max | Beats60 | Beats90 | Beats120 | Beats160 |
|---|---|---:|---|---|---|---|---|
| CORRECT | precision 176/176; recall 176/182 | 176 | 1370.6 / 4372.1 / 14025.5 / 14259.1 | 1.371 / 4.372 / 14.026 / 14.259 | 2.056 / 6.558 / 21.038 / 21.389 | 2.741 / 8.744 / 28.051 / 28.518 | 3.655 / 11.659 / 37.401 / 38.024 |
| MISSING | detected 40/40; false match 0 | 40 | 22098.3 / 26689.5 / 26861.8 / 26959.3 | 22.098 / 26.689 / 26.862 / 26.959 | 33.147 / 40.034 / 40.293 / 40.439 | 44.197 / 53.379 / 53.724 / 53.919 | 58.929 / 71.172 / 71.631 / 71.891 |
| WRONG | detected 39/40; false CORRECT 0 | 39 | 22051.9 / 26451.3 / 26856.4 / 26959.3 | 22.052 / 26.451 / 26.856 / 26.959 | 33.078 / 39.677 / 40.285 / 40.439 | 44.104 / 52.903 / 53.713 / 53.919 | 58.805 / 70.537 / 71.617 / 71.891 |
| INCOMPLETE_CHORD | detected 40/40; false complete 0 | 40 | 14753.9 / 25510.1 / 25954.4 / 26155.1 | 14.754 / 25.510 / 25.954 / 26.155 | 22.131 / 38.265 / 38.932 / 39.233 | 29.508 / 51.020 / 51.909 / 52.310 | 39.344 / 68.027 / 69.212 / 69.747 |
| EXTRA | precision 36/36; recall 36/40 | 36 | 1474.0 / 1930.2 / 1958.9 / 1966.2 | 1.474 / 1.930 / 1.959 / 1.966 | 2.211 / 2.895 / 2.938 / 2.949 | 2.948 / 3.860 / 3.918 / 3.932 | 3.931 / 5.147 / 5.224 / 5.243 |

### BAND_LIMITED_B_500_220

Target agreement: 97.37%; expected-strike recall: 97.58%; no sustained backlog in all 5 clips: true.

| Verdict | Correctness / safety counts | Latency N | ms P50/P95/P99/max | Beats60 | Beats90 | Beats120 | Beats160 |
|---|---|---:|---|---|---|---|---|
| CORRECT | precision 176/176; recall 176/182 | 176 | 1371.3 / 4372.8 / 14025.9 / 14259.5 | 1.371 / 4.373 / 14.026 / 14.259 | 2.057 / 6.559 / 21.039 / 21.389 | 2.743 / 8.746 / 28.052 / 28.519 | 3.657 / 11.661 / 37.402 / 38.025 |
| MISSING | detected 39/40; false match 0 | 39 | 22052.2 / 26690.7 / 26864.5 / 26959.5 | 22.052 / 26.691 / 26.864 / 26.959 | 33.078 / 40.036 / 40.297 / 40.439 | 44.104 / 53.381 / 53.729 / 53.919 | 58.806 / 71.175 / 71.639 / 71.892 |
| WRONG | detected 40/40; false CORRECT 0 | 40 | 22098.5 / 26438.3 / 26853.8 / 26959.5 | 22.099 / 26.438 / 26.854 / 26.959 | 33.148 / 39.657 / 40.281 / 40.439 | 44.197 / 52.877 / 53.708 / 53.919 | 58.929 / 70.502 / 71.610 / 71.892 |
| INCOMPLETE_CHORD | detected 39/40; false complete 0 | 39 | 14637.3 / 25517.5 / 25959.7 / 26155.3 | 14.637 / 25.518 / 25.960 / 26.155 | 21.956 / 38.276 / 38.940 / 39.233 | 29.275 / 51.035 / 51.919 / 52.311 | 39.033 / 68.047 / 69.226 / 69.747 |
| EXTRA | precision 39/412; recall 39/40 | 39 | 1489.1 / 24703.8 / 24926.8 / 24983.0 | 1.489 / 24.704 / 24.927 / 24.983 | 2.234 / 37.056 / 37.390 / 37.474 | 2.978 / 49.408 / 49.854 / 49.966 | 3.971 / 65.877 / 66.471 / 66.621 |

### BAND_LIMITED_A_600_120

Target agreement: 97.66%; expected-strike recall: 97.42%; no sustained backlog in all 5 clips: true.

| Verdict | Correctness / safety counts | Latency N | ms P50/P95/P99/max | Beats60 | Beats90 | Beats120 | Beats160 |
|---|---|---:|---|---|---|---|---|
| CORRECT | precision 179/179; recall 179/182 | 179 | 1329.7 / 4327.6 / 13847.6 / 14329.9 | 1.330 / 4.328 / 13.848 / 14.330 | 1.995 / 6.491 / 20.771 / 21.495 | 2.659 / 8.655 / 27.695 / 28.660 | 3.546 / 11.540 / 36.927 / 38.213 |
| MISSING | detected 40/40; false match 0 | 40 | 21580.1 / 26474.7 / 26647.0 / 26744.5 | 21.580 / 26.475 / 26.647 / 26.744 | 32.370 / 39.712 / 39.970 / 40.117 | 43.160 / 52.949 / 53.294 / 53.489 | 57.547 / 70.599 / 71.059 / 71.319 |
| WRONG | detected 39/40; false CORRECT 0 | 39 | 21533.8 / 26236.4 / 26641.5 / 26744.5 | 21.534 / 26.236 / 26.642 / 26.744 | 32.301 / 39.355 / 39.962 / 40.117 | 43.068 / 52.473 / 53.283 / 53.489 | 57.423 / 69.964 / 71.044 / 71.319 |
| INCOMPLETE_CHORD | detected 40/40; false complete 0 | 40 | 14645.8 / 25433.7 / 25801.9 / 25940.3 | 14.646 / 25.434 / 25.802 / 25.940 | 21.969 / 38.151 / 38.703 / 38.910 | 29.292 / 50.867 / 51.604 / 51.881 | 39.055 / 67.823 / 68.805 / 69.174 |
| EXTRA | precision 36/271; recall 36/40 | 36 | 1337.8 / 1738.0 / 1914.9 / 1962.9 | 1.338 / 1.738 / 1.915 / 1.963 | 2.007 / 2.607 / 2.872 / 2.944 | 2.676 / 3.476 / 3.830 / 3.926 | 3.567 / 4.635 / 5.106 / 5.234 |

### BAND_LIMITED_B_600_120

Target agreement: 97.66%; expected-strike recall: 97.75%; no sustained backlog in all 5 clips: true.

| Verdict | Correctness / safety counts | Latency N | ms P50/P95/P99/max | Beats60 | Beats90 | Beats120 | Beats160 |
|---|---|---:|---|---|---|---|---|
| CORRECT | precision 179/179; recall 179/182 | 179 | 1330.3 / 4327.9 / 13847.9 / 14330.1 | 1.330 / 4.328 / 13.848 / 14.330 | 1.995 / 6.492 / 20.772 / 21.495 | 2.661 / 8.656 / 27.696 / 28.660 | 3.548 / 11.541 / 36.928 / 38.214 |
| MISSING | detected 40/40; false match 0 | 40 | 21580.3 / 26475.0 / 26647.3 / 26744.8 | 21.580 / 26.475 / 26.647 / 26.745 | 32.370 / 39.713 / 39.971 / 40.117 | 43.161 / 52.950 / 53.295 / 53.490 | 57.547 / 70.600 / 71.060 / 71.320 |
| WRONG | detected 39/40; false CORRECT 0 | 39 | 21534.0 / 26236.8 / 26641.9 / 26744.8 | 21.534 / 26.237 / 26.642 / 26.745 | 32.301 / 39.355 / 39.963 / 40.117 | 43.068 / 52.474 / 53.284 / 53.490 | 57.424 / 69.965 / 71.045 / 71.320 |
| INCOMPLETE_CHORD | detected 40/40; false complete 0 | 40 | 14646.2 / 25434.1 / 25802.2 / 25940.7 | 14.646 / 25.434 / 25.802 / 25.941 | 21.969 / 38.151 / 38.703 / 38.911 | 29.292 / 50.868 / 51.604 / 51.881 | 39.057 / 67.824 / 68.806 / 69.175 |
| EXTRA | precision 36/455; recall 36/40 | 36 | 1335.0 / 1680.3 / 1785.1 / 1826.1 | 1.335 / 1.680 / 1.785 / 1.826 | 2.002 / 2.520 / 2.678 / 2.739 | 2.670 / 3.361 / 3.570 / 3.652 | 3.560 / 4.481 / 4.760 / 4.869 |

### BAND_LIMITED_A_600_170

Target agreement: 96.49%; expected-strike recall: 97.25%; no sustained backlog in all 5 clips: true.

| Verdict | Correctness / safety counts | Latency N | ms P50/P95/P99/max | Beats60 | Beats90 | Beats120 | Beats160 |
|---|---|---:|---|---|---|---|---|
| CORRECT | precision 175/175; recall 175/182 | 175 | 1357.5 / 4437.8 / 13934.1 / 14416.4 | 1.357 / 4.438 / 13.934 / 14.416 | 2.036 / 6.657 / 20.901 / 21.625 | 2.715 / 8.876 / 27.868 / 28.833 | 3.620 / 11.834 / 37.158 / 38.444 |
| MISSING | detected 40/40; false match 0 | 40 | 21628.4 / 26509.7 / 26682.0 / 26779.5 | 21.628 / 26.510 / 26.682 / 26.779 | 32.443 / 39.765 / 40.023 / 40.169 | 43.257 / 53.019 / 53.364 / 53.559 | 57.676 / 70.692 / 71.152 / 71.412 |
| WRONG | detected 39/40; false CORRECT 0 | 39 | 21582.1 / 26271.5 / 26676.6 / 26779.5 | 21.582 / 26.271 / 26.677 / 26.779 | 32.373 / 39.407 / 40.015 / 40.169 | 43.164 / 52.543 / 53.353 / 53.559 | 57.552 / 70.057 / 71.137 / 71.412 |
| INCOMPLETE_CHORD | detected 40/40; false complete 0 | 40 | 14708.1 / 25470.6 / 25851.3 / 25975.3 | 14.708 / 25.471 / 25.851 / 25.975 | 22.062 / 38.206 / 38.777 / 38.963 | 29.416 / 50.941 / 51.703 / 51.951 | 39.222 / 67.921 / 68.937 / 69.267 |
| EXTRA | precision 36/160; recall 36/40 | 36 | 1371.8 / 1701.6 / 1844.0 / 1884.5 | 1.372 / 1.702 / 1.844 / 1.884 | 2.058 / 2.552 / 2.766 / 2.827 | 2.744 / 3.403 / 3.688 / 3.769 | 3.658 / 4.538 / 4.917 / 5.025 |

### BAND_LIMITED_A_600_220

Target agreement: 97.08%; expected-strike recall: 97.33%; no sustained backlog in all 5 clips: true.

| Verdict | Correctness / safety counts | Latency N | ms P50/P95/P99/max | Beats60 | Beats90 | Beats120 | Beats160 |
|---|---|---:|---|---|---|---|---|
| CORRECT | precision 177/177; recall 177/182 | 177 | 1418.8 / 5087.0 / 13958.7 / 14441.0 | 1.419 / 5.087 / 13.959 / 14.441 | 2.128 / 7.631 / 20.938 / 21.661 | 2.838 / 10.174 / 27.917 / 28.882 | 3.783 / 13.565 / 37.223 / 38.509 |
| MISSING | detected 40/40; false match 0 | 40 | 21687.5 / 26536.4 / 26708.7 / 26806.2 | 21.687 / 26.536 / 26.709 / 26.806 | 32.531 / 39.805 / 40.063 / 40.209 | 43.375 / 53.073 / 53.417 / 53.612 | 57.833 / 70.764 / 71.223 / 71.483 |
| WRONG | detected 39/40; false CORRECT 0 | 39 | 21641.1 / 26298.1 / 26703.2 / 26806.2 | 21.641 / 26.298 / 26.703 / 26.806 | 32.462 / 39.447 / 40.055 / 40.209 | 43.282 / 52.596 / 53.406 / 53.612 | 57.710 / 70.128 / 71.209 / 71.483 |
| INCOMPLETE_CHORD | detected 40/40; false complete 0 | 40 | 14754.0 / 25502.3 / 25884.3 / 26002.0 | 14.754 / 25.502 / 25.884 / 26.002 | 22.131 / 38.253 / 38.826 / 39.003 | 29.508 / 51.005 / 51.769 / 52.004 | 39.344 / 68.006 / 69.025 / 69.339 |
| EXTRA | precision 36/280; recall 36/40 | 36 | 1445.3 / 1757.9 / 1896.1 / 1948.8 | 1.445 / 1.758 / 1.896 / 1.949 | 2.168 / 2.637 / 2.844 / 2.923 | 2.891 / 3.516 / 3.792 / 3.898 | 3.854 / 4.688 / 5.056 / 5.197 |

### BAND_LIMITED_B_600_220

Target agreement: 97.66%; expected-strike recall: 97.75%; no sustained backlog in all 5 clips: true.

| Verdict | Correctness / safety counts | Latency N | ms P50/P95/P99/max | Beats60 | Beats90 | Beats120 | Beats160 |
|---|---|---:|---|---|---|---|---|
| CORRECT | precision 179/179; recall 179/182 | 179 | 1421.9 / 4929.5 / 13958.9 / 14441.1 | 1.422 / 4.930 / 13.959 / 14.441 | 2.133 / 7.394 / 20.938 / 21.662 | 2.844 / 9.859 / 27.918 / 28.882 | 3.792 / 13.145 / 37.224 / 38.510 |
| MISSING | detected 40/40; false match 0 | 40 | 21687.6 / 26536.6 / 26708.8 / 26806.3 | 21.688 / 26.537 / 26.709 / 26.806 | 32.531 / 39.805 / 40.063 / 40.210 | 43.375 / 53.073 / 53.418 / 53.613 | 57.834 / 70.764 / 71.224 / 71.484 |
| WRONG | detected 39/40; false CORRECT 0 | 39 | 21641.3 / 26298.3 / 26703.4 / 26806.3 | 21.641 / 26.298 / 26.703 / 26.806 | 32.462 / 39.447 / 40.055 / 40.210 | 43.283 / 52.597 / 53.407 / 53.613 | 57.710 / 70.129 / 71.209 / 71.484 |
| INCOMPLETE_CHORD | detected 40/40; false complete 0 | 40 | 14754.2 / 25502.9 / 25884.6 / 26002.2 | 14.754 / 25.503 / 25.885 / 26.002 | 22.131 / 38.254 / 38.827 / 39.003 | 29.508 / 51.006 / 51.769 / 52.004 | 39.345 / 68.008 / 69.026 / 69.339 |
| EXTRA | precision 36/520; recall 36/40 | 36 | 1444.2 / 1728.7 / 1877.9 / 1949.0 | 1.444 / 1.729 / 1.878 / 1.949 | 2.166 / 2.593 / 2.817 / 2.924 | 2.888 / 3.457 / 3.756 / 3.898 | 3.851 / 4.610 / 5.008 / 5.197 |

## Causal Runtime

Pooled descriptive values below do not replace the frozen per-clip backlog gate. Pure ORT surrounds actual session.run calls. Shared raw persistence/IPC and decoder work remain in total processing. Cold model load and actual cold first run are separately retained in execution receipts.

| Configuration | Processing P95 ms | Pure ORT P95 ms | Queue P95 ms | Max outstanding | All 5 no sustained backlog |
|---|---:|---:|---:|---:|---|
| LINEAR_A_600_220 | 716.7 | 689.6 | 739.2 | 3 | false |
| LINEAR_A_320_120 | 632.4 | 612.3 | 16934.8 | 39 | false |
| LINEAR_A_320_170 | 687.1 | 665.5 | 20690.7 | 39 | false |
| LINEAR_A_320_220 | 643.7 | 620.0 | 18522.2 | 39 | false |
| LINEAR_A_400_120 | 667.5 | 648.4 | 11277.2 | 25 | false |
| LINEAR_A_400_170 | 624.1 | 602.0 | 8915.7 | 22 | false |
| LINEAR_A_600_120 | 701.6 | 681.8 | 391.6 | 3 | false |
| LINEAR_A_600_170 | 659.1 | 631.2 | 178.0 | 2 | true |
| BAND_LIMITED_A_320_120 | 665.8 | 643.0 | 23487.8 | 46 | false |
| BAND_LIMITED_B_320_120 | 665.8 | 643.0 | 23487.8 | 46 | false |
| BAND_LIMITED_A_400_220 | 795.2 | 765.2 | 16236.4 | 29 | false |
| BAND_LIMITED_B_400_220 | 795.2 | 765.2 | 16236.4 | 29 | false |
| BAND_LIMITED_B_500_120 | 515.0 | 494.5 | 30.6 | 2 | true |
| BAND_LIMITED_A_500_170 | 515.9 | 498.2 | 30.1 | 2 | true |
| BAND_LIMITED_B_500_170 | 515.9 | 498.2 | 30.1 | 2 | true |
| BAND_LIMITED_A_500_220 | 516.7 | 494.4 | 25.7 | 2 | true |
| BAND_LIMITED_B_500_220 | 516.7 | 494.4 | 25.7 | 2 | true |
| BAND_LIMITED_A_600_120 | 518.4 | 495.3 | 0.2 | 2 | true |
| BAND_LIMITED_B_600_120 | 518.4 | 495.3 | 0.2 | 2 | true |
| BAND_LIMITED_A_600_170 | 514.8 | 496.9 | 0.2 | 2 | true |
| BAND_LIMITED_A_600_220 | 524.2 | 496.6 | 186.5 | 3 | true |
| BAND_LIMITED_B_600_220 | 524.2 | 496.6 | 186.5 | 3 | true |

ORT Web 1.30 control: ORT_WEB_1_30_RUNTIME_INELIGIBLE_FOR_THIS_ROBUST_EXPORT_ON_THIS_MACHINE; processing P95 1224.6ms. Main study used ORT Web 1.20.1. Historical 480 ms headroom is diagnostic only here, not a UX SLO.

## Statistics And Audit

231 paired comparisons, 5,000 draw attempts each,seed 13371,unit=clip. Full draw digests,valid draw counts,confidence intervals and paired scenario differences are in the JSON. No individual attacks treated as independent recordings.

All 22 configurations passed complete consumption audit: no MATCHED/WRONG/EXTRA double ownership,all observations accounted for within each scenario,and every finalization time tied to a real publication. Full audit files remain under the ignored work root; versioned receipts bind their hashes. Nominal deadlineMs is not always the full component-release deadline; EXTRA retains an attack-coordinate field. Finality reasons and publication-frontier witnesses govern interpretation.

## Limitations And Protections

- Five EVALUATION clips,not a natural pianist-error corpus or native fixed-BPM Practice capture. Artificial error prevalence affects precision.
- Primary replay times exclude projector CPU,UI and perception; no end-to-end product latency qualification.
- 336/12189 starts slightly precede nominal ready,minimum offset -0.835205ms. Raw timer/clock uncertainty retained,no fitted acceptance threshold.
- Sequential variant order and uninstrumented system/thermal conditions prevent hardware-cause attribution.
- Zero observed critical errors is not a population safety guarantee.
- F5: NO_CLEAR_SCIENTIFIC_ACOUSTIC_WINNER. R4: ROBUST_CADENCE_SUSTAINABLE / ROBUST_20_PERCENT_HEADROOM_FAIL / NOT_YET_QUALIFIED.
- Phase9G-B: STATISTICAL_TIE,winner=null. Vienna p15-p22 inference increase 0.
- Microphone=false,no D4,no Practice WebSocket,no backend/server Practice inference,no score following,no retraining,no threshold tuning.

## Validation And Review

17 Node tests and 3 Docker Python tests passed. Pre-freeze customer-web validation is preserved in its receipt. GitHub combined status for the pre-evidence HEAD: pending; statuses=[]; workflow runs=[]. This is NOT CI PASS. A post-push query will be returned after the evidence commit.

Smallest next action: independently review the verdict-finalization component waits and define product latency SLOs before any product qualification. No further optimization implemented.

Full machine-readable report: phase9g_xc2_product_verdict_latency_final_2026-10-16.json. Supplement: phase9g_xc2_evidence_interpretation_2026-10-16.json.

# PARpiano Reproducibility Audit

Date: 2026-09-13

Scope: small reproducibility audit only. No model benchmark, threshold tuning,
production integration, frozen evaluation set, or reimplementation was attempted.

## Candidate

```text
TaegyunKwon/PARpiano
Towards Efficient and Real-Time Piano Transcription Using Neural Autoregressive Models
```

## Question

Does PARpiano have public, runnable artifacts sufficient for NoteVerse to run a
fair causal frontend evaluation?

Minimum requirement:

```text
public source code
+
pretrained checkpoint
```

## Checked Sources

- Official GitHub repository: `https://github.com/TaegyunKwon/PARpiano`
- Official project page: `https://taegyunkwon.github.io/PARpiano/`
- arXiv paper page: `https://arxiv.org/abs/2404.06818`
- GitHub releases / tags / repository contents via GitHub API

## Findings

| Item | Result |
| --- | --- |
| Source code available | No runnable source found |
| Pretrained weights available | No checkpoint found |
| Release artifacts | No releases/tags with assets found |
| License | No repository license found |
| Sample rate | Not auditable from runnable artifact |
| Streaming/incremental entrypoint | Not available |
| Raw onset / note-state outputs | Not available from code artifact |
| Model variants | Paper/project describe model ideas, but no runnable variants exposed |

The GitHub repository is public but currently contains only the project-page
files:

```text
README.md
_config.yml
index.md
```

The README only says:

```text
PARpiano
Piano Transcription Model with Pitchwise AutoRegressive (PAR) network
```

The project page has an abstract and a demo note, but it does not provide a
runnable implementation or pretrained checkpoint.

## Conclusion

```text
PARpiano = NOT REPRODUCIBLE FOR THIS STUDY
```

Reason:

```text
No public runnable source + checkpoint pair was found.
```

Do not spend time reimplementing the paper for this line of work. That would not
be a fair reproducibility benchmark and would blur model evaluation with a new
implementation project.

## Next Candidate

Audit next:

```text
Onsets and Velocities
Affordable Real-Time Piano Transcription
```

Rationale: the current NoteVerse gap has narrowed to:

```text
new physical strike detection
```

not full MIDI transcription.

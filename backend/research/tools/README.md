# Research Tools

These tools belong to experiments, dataset preparation, candidate evaluation and
qualification. They do not run in backend runtime or core quality images.

Use the Python, ML libraries, model checkpoints, datasets and Docker research image
declared by each tool or its calling protocol. Pass explicit repository/input/output
paths when offered by the CLI. Run backend-relative tools from `backend/`.
Existing browser runners and frozen protocols own their own environment and inputs;
moving a source file does not qualify a new experiment or update recorded evidence.

`retired/*.py.txt` are non-executable reference sources. Their benchmark dependency
`evaluate_public_paired_midi_dataset` has no current implementation. The related
tests are reference-only under `../tests/retired/`; they are not part of the active
research test suite. No compatibility module or replacement evaluator is provided.

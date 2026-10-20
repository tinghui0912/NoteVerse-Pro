# Research Tools

These tools belong to experiments, dataset preparation, candidate evaluation and
qualification. They do not run in backend runtime or core quality images.

Use the Python, ML libraries, model checkpoints, datasets and Docker research image
declared by each tool or its calling protocol. Pass explicit repository/input/output
paths when offered by the CLI. Run backend-relative tools from `backend/`.
Source imports and referenced code must exist in the current tree. Models, datasets,
GPU support and external libraries are explicit environment prerequisites, not
bundled dependencies. Current tools do not execute historical or reference sources.

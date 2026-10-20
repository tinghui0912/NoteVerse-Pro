# Backend Research

This tree contains current research tooling and reusable fixtures. It is separate
from backend production runtime and core quality; core code does not depend on it.

- `tools/`: parameterized analysis, dataset preparation and model validation.
- `tests/`: research behavior tests.
- `browser_runtime/`: reusable browser inference, DSP and analysis helpers.
- `fixtures/`: small research inputs.
- `reports/`: local generated outputs; see the [report policy](reports/README.md).

Run tools with their declared libraries, models, datasets and explicit inputs.
No single environment supports every tool. Source dependencies must exist in the
current tree; model checkpoints and datasets are environment prerequisites.

Closed experiments and historical evidence are available from Git history, with
their recorded commit and environment.

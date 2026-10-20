# Backend Research

Research is separate from the backend production runtime and core quality image.
Core application code, operational scripts and behavior tests do not depend on this tree.

- `tools/`: research, dataset, candidate evaluation and qualification tooling.
- `tests/`: research-only tests.
- `browser_runtime/`, `fixtures/`, `qualification/`: browser harnesses, inputs and protocols.
- `reports/`: recorded evidence; `history/`: archived material. Their recorded identities and paths are immutable evidence.

Run a tool in its declared environment with its explicit inputs; one Docker image
does not support every experiment. Python tools run from the backend working directory
unless their CLI specifies `--repo-root` or another working directory.

`tools/retired/` and `tests/retired/` contain reference-only `.py.txt` sources with
an unavailable paired-MIDI evaluator dependency. They are not runnable tools or
collected tests. The missing evaluator is not supplied by this tree. The fresh-strike
baseline reads selected detector AST nodes from its reference source without importing
the unavailable evaluator. See [tools](tools/README.md) for execution boundaries.

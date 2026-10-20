# Backend Research

Research is separate from the backend production runtime and core quality image.
Core application code, operational scripts and behavior tests do not depend on this tree.

- `tools/`: current runnable research tools with source dependencies present.
- `tests/`: current collectable research tests.
- `browser_runtime/`, `fixtures/`, `qualification/`: current harnesses, inputs and protocols.
- `reports/`: recorded evidence with immutable identities and paths; see the
  [evidence storage contract](reports/README.md).
- `history/`: closed, frozen and reference-only source and evidence.

Run a tool in its declared environment with its explicit inputs; one Docker image
does not support every experiment. Python tools run from the backend working directory
unless their CLI specifies `--repo-root` or another working directory.

Current tools and tests do not execute sources in `history/`. Reproduce historical
experiments from their recorded commit and environment, rather than adapting them
to the current HEAD. Reference sources are inert; see [history](history/).

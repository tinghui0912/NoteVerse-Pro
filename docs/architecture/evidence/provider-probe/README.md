# Provider experiment source archive

This directory contains inert scientific source and a doubles harness. These files
are not imported by the application or collected by the default test suite.
The adjacent JSON evidence records actual provider observations; these text files
do not establish additional provider qualifications.

Source artifacts:

- [Probe source](qualify_asset_provider.py.txt)
- [Browser probe source](qualify_asset_provider_browser.mjs.txt)
- [Doubles harness](test_asset_provider_probe.py.txt)
- [Experiment report](qualification-report.md.txt)

For independent reproduction, extract copies into an isolated experiment directory
with `tests/support/qualify_asset_provider.py`,
`tests/support/qualify_asset_provider_browser.mjs`, and
`tests/test_asset_provider_probe.py`; add empty package initializers and install the
repository-pinned provider/test dependencies. Run the doubles harness explicitly.
Read the probe's CLI and cleanup logic before an authorized real-provider run.
Use a dedicated development namespace, never a production bucket, and do not commit
credentials, signed URLs, temporary browser state or unverified qualification output.

# Evidence storage

Evidence has three roles:

- `REPORT`: conclusions, receipts, manifests and summaries for people or tools.
- `SUPPORTING_EVIDENCE`: artifacts needed to interpret or verify a report.
- `BULK_PAYLOAD`: raw tensors, PCM/audio, exhaustive execution traces or other
  generated detail. File size alone does not determine this role.

`reports/` retains durable compact evidence. Existing recorded bytes, paths,
timestamps and identities are immutable. Bulk payload remains tracked here; it
requires an explicit durable storage strategy before any externalization.

Run the read-only inventory from the repository root:

```sh
python backend/research/tools/inventory_evidence_storage.py
```

From `backend/`, use `python research/tools/inventory_evidence_storage.py`.
The tool reads committed Git blobs at `HEAD`; `--revision` selects another
committed snapshot. JSON goes to stdout. `--output` accepts a new diagnostic file
outside reports/history and refuses overwrites. No output is committed by default.

Inventory distinguishes literal current-source references from references in
reports/history; other tracked documentation references are reported separately.
It does not resolve dynamic paths or establish reproducibility. No detected
reference does **not** authorize deletion. Structural JSON weights and suggested
payload roles require review for mixed final reports and detailed traces.

`KEEP_IN_GIT`, `EXTERNALIZATION_CANDIDATE` and `NEEDS_MANUAL_CLASSIFICATION` are
planning categories. Candidates need recorded byte length and SHA-256 in compact
surviving evidence, a reviewed consumer closure and an approved durable destination.
Duplicate bytes may be intentional sealed copies and are not deduplicated here.
Duplicate-byte totals describe logical paths, not recoverable Git object storage;
Git already stores identical blobs by content identity.

A storage change must preserve exact bytes, logical identity and provenance,
provide integrity verification and tested recovery, and keep consumers usable.
Remote LFS/object-storage availability, quota, retention and access controls need
explicit verification. Local Git LFS installation and recoverability from old Git
commits are not a durable-storage policy. No LFS or payload migration is enabled.

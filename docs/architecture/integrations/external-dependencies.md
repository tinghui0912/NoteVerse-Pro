# External Source Dependencies

This project keeps source-level third-party tools under `external/` when they are
not available as normal Python packages or when the application depends on
repository scripts in addition to importable modules.

The `external/` directory is a local dependency checkout area for inspection,
debugging, and upstream validation. Do not edit or vendor third-party code into
`backend/`. Keep the runtime dependency pinned by upstream URL and commit.
Production worker images fetch the pinned source during image build, so
Kubernetes does not need a source-code PVC and CI does not depend on an
untracked local checkout.

## LEGATO

Optional local checkout:

```text
external/legato
```

Upstream:

```text
https://github.com/guang-yng/legato.git
```

Pinned commit:

```text
179c228d3d5f67113cf739b44891b3abe046f1dc
```

Configured through:

```dotenv
LEGATO_REPO_URL=https://github.com/guang-yng/legato.git
LEGATO_REPO_PATH=/opt/noteverse/legato
LEGATO_REPO_COMMIT=179c228d3d5f67113cf739b44891b3abe046f1dc
```

### Why It Is Not Installed Like `pymatchmaker`

LEGATO currently does not provide standard packaging metadata such as:

- `pyproject.toml`
- `setup.py`
- `setup.cfg`

Its upstream documented usage is source-based and runs repository scripts with
`PYTHONPATH` pointed at the checked-out source tree. NoteVerse does not run this
workflow on the host; backend development and testing run inside Docker.

The backend also depends on repository utilities that are not normal installed
package entry points:

- `legato.models.LegatoModel`
- `legato.models.processing_legato.LegatoProcessor`
- `utils/convert.py`
- `utils/abc2xml.py`

Because of this, `external/legato` is treated as a pinned external tool
repository rather than a backend source module.

### Why It Stays Under `external/`

`external/legato` is not NoteVerse backend code. Keeping it outside `backend/`
preserves a clear boundary:

```text
backend/          application code
frontend/         web application
external/legato   third-party source tool
```

The backend worker image clones the pinned source into:

```text
/opt/noteverse/legato
```

Production Kubernetes should not mount a Legato source-code PVC. The application
verifies the configured `LEGATO_REPO_COMMIT` at runtime. API and beat images do
not contain LEGATO because they do not run OCR/OMR inference.

### Updating LEGATO

Update only intentionally. If you keep a local checkout, use it to inspect and
verify the target commit:

```bash
cd external/legato
git fetch origin
git checkout <new-commit>
git status --short
git rev-parse HEAD
```

Then update:

- `LEGATO_REPO_URL` if the upstream repository changes
- `LEGATO_REPO_COMMIT` in `backend/.env.docker.example`
- default `LEGATO_REPO_COMMIT` in `backend/app/core/config.py`
- this document
- worker image build arguments in deployment or CI when they override defaults

Run:

```powershell
docker compose -f docker-compose.backend-dev.yml build worker
docker compose -f docker-compose.backend-dev.yml run --rm worker check --role worker
docker compose -f docker-compose.backend-dev.yml run --rm worker python scripts/legato_visual_probe.py --legato-repo /opt/noteverse/legato --image-dir data/storage --limit 1
```

Then validate the full upload/review/editor/practice flow.

### Hygiene Rules

- Do not place temporary installers or downloaded packages in `external/legato`.
- Do not edit LEGATO source casually inside this repository.
- If a local patch becomes necessary, document it and consider maintaining a
  fork or patch file.
- Keep `external/legato` clean: `git status --short` should be empty.

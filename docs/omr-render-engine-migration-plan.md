# OMR and Score Rendering Engine Migration Plan

## Context

The current processing pipeline is tightly coupled to Audiveris for optical music recognition and MuseScore for server-side image rendering.

Current backend flow:

```text
Upload
  -> Celery task
  -> CopyImageStep / CopyImagesStep
  -> AudiverisImageStep / AudiverisPdfStep
  -> ExtractXmlStep
  -> TextOcrStep
  -> XmlNormalizeStep
  -> PreviewGenerationStep
  -> FinalizeStep
```

Current rendering flow:

```text
MusicXML
  -> MuseScoreEngine
  -> PNG preview_image / final_image
```

The LEGATO visual probe has shown that LEGATO can produce better MusicXML than Audiveris on the tested samples, but the reliable path is:

```text
image -> LEGATO -> ABC -> MusicXML -> Verovio SVG
```

The direct path is not reliable enough:

```text
image -> LEGATO -> ABC -> Verovio SVG
```

Verovio supports ABC, but LEGATO emits complex ABC with multi-voice and multi-staff constructs. Verovio's direct ABC import does not consistently preserve the intended piano grand staff. The MusicXML path is structurally better because `abc2xml.py` expands voice, staff, clef, and system-break information into explicit MusicXML.

## Verovio vs MuseScore Behavior

MuseScore performs tolerant layout normalization when opening MusicXML. For example, `abc2xml.py` may emit the first bass clef after the treble staff notes and a `<backup>` element. MuseScore moves that initial clef visually to the system start. Verovio renders more strictly according to the encoded position, so the bass clef can appear late unless the MusicXML is normalized first.

We should not depend on Verovio being "as smart as MuseScore." Instead, the production pipeline should provide clean, canonical MusicXML before rendering.

Required normalization before Verovio:

- Preserve encoded system breaks with `<print new-system="yes" />`.
- Render with Verovio option `breaks="encoded"`.
- Move initial staff clefs into the first measure's opening `<attributes>`.
- Keep `<staves>2</staves>` and numbered clefs in the opening attributes when possible.
- Add future MusicXML canonicalization steps as concrete issues are found.

## Target Architecture

```text
OMREngine
  AudiverisOmrEngine
  LegatoOmrEngine

ScoreRenderEngine
  MuseScoreRenderEngine
  VerovioRenderEngine
```

Configuration:

```env
OMR_ENGINE=legato
SCORE_RENDER_ENGINE=verovio
```

No fallback logic is planned during development. If the selected engine fails, the task should fail with a precise error code. This keeps behavior explicit and avoids hiding engine defects.

## Phase 1: Introduce OMREngine Abstraction

Goal: remove Audiveris-specific assumptions from the pipeline while preserving current behavior.

Files to change:

- `backend/app/processing/engines/omr/base.py`
- `backend/app/processing/engines/omr/audiveris.py`
- `backend/app/processing/engines/omr/factory.py`
- `backend/app/pipeline/context.py`
- `backend/app/pipeline/steps/audiveris.py`
- `backend/app/pipeline/steps/xml.py`
- `backend/app/pipeline/builder.py`

New result types:

```python
class OmrOutputFiles(TypedDict, total=False):
    xml: str
    mxl: str
    abc: str
    raw_prediction: str
    log: str

class OmrSuccessResult(TypedDict):
    success: bool
    engine: str
    files: OmrOutputFiles
    stdout: str
    stderr: str

class OmrFailureResult(TypedDict):
    success: bool
    engine: str
    error: str
    code: str
```

Refactors:

- Rename `ctx.aud_result` to `ctx.omr_result`.
- Rename `ctx.aud_dir` to `ctx.omr_dir`.
- Rename `AudiverisImageStep` / `AudiverisPdfStep` to `OmrImageStep` / `OmrPdfStep`.
- Update `ExtractXmlStep` to read from `ctx.omr_result["files"]`.
- Keep Audiveris behavior intact through `AudiverisOmrEngine`.

Acceptance criteria:

- `OMR_ENGINE=audiveris` preserves current output.
- Existing pipeline tests pass.
- Pipeline code no longer depends on `aud_result` naming.

## Phase 2: Add OMR Engine Configuration

Goal: select the OMR engine from configuration.

Files to change:

- `backend/app/core/config.py`
- `backend/.env.example`
- `backend/app/core/startup_checks.py`

New settings:

```env
OMR_ENGINE=audiveris
LEGATO_REPO_PATH=../external/legato
LEGATO_PYTHON=python3
LEGATO_MODEL_PATH=guangyangmusic/legato
LEGATO_PROCESSOR_PATH=guangyangmusic/legato
LEGATO_DEVICE=cuda
LEGATO_FP16=true
LEGATO_BEAM_SIZE=10
LEGATO_TIMEOUT_SECONDS=600
```

Validation:

- `OMR_ENGINE` must be one of `audiveris`, `legato`.
- LEGATO paths are required only when `OMR_ENGINE=legato`.
- Startup logs should show selected engine and whether required runtime paths exist.

## Phase 3: Implement LegatoOmrEngine

Goal: produce MusicXML from an input image using the verified path.

Engine flow:

```text
image
  -> LEGATO inference
  -> prediction_abc.json
  -> prediction.abc
  -> LEGATO cleanup_abc
  -> abc2xml.py
  -> prediction.musicxml
  -> MusicXML normalization
```

Files to add:

- `backend/app/processing/engines/omr/legato.py`
- `backend/app/processing/engines/omr/legato_runner.py` or a generated runner script
- `backend/app/processing/musicxml/normalization.py`

Important implementation details:

- Do not use LEGATO's direct `AutoProcessor` path if it remains unstable.
- Explicitly load `LegatoProcessor`.
- Keep LEGATO in the Celery worker environment only.
- Use `abc2xml.py` for ABC to MusicXML conversion.
- Do not invoke LEGATO's hard-coded `software/mscore` formatting step.
- Normalize initial clefs before renderer handoff.
- Store ABC, cleaned ABC, raw JSON, and MusicXML in `ctx.omr_dir` / `ctx.xml_dir`.

Single-image support:

- Required for first production integration.

Multi-image support:

- Not part of the first implementation.
- If `OMR_ENGINE=legato` and multiple images are submitted, fail with a clear `legato_multi_page_not_supported` error until a deliberate multi-page merge strategy is implemented.

Acceptance criteria:

- LEGATO single image task creates `current_xml`.
- Generated MusicXML opens in MuseScore.
- Generated MusicXML renders through Verovio.
- Error codes distinguish missing LEGATO repo, inference failure, conversion failure, and timeout.

## Phase 4: Introduce ScoreRenderEngine Abstraction

Goal: remove direct MuseScore dependencies from rendering steps and services.

Files to change:

- `backend/app/processing/engines/render/base.py`
- `backend/app/processing/engines/render/musescore.py`
- `backend/app/processing/engines/render/factory.py`
- `backend/app/pipeline/steps/preview.py`
- `backend/app/modules/files/render_service.py`
- `backend/app/modules/xml/render_service.py`
- `backend/app/shared/file_kinds.py`
- `backend/app/pipeline/files_recorder.py`

New result type:

```python
class ScoreRenderOutput(TypedDict):
    path: str
    page: int
    format: str
    mime_type: str

class ScoreRenderSuccessResult(TypedDict):
    success: bool
    engine: str
    files: list[ScoreRenderOutput]

class ScoreRenderFailureResult(TypedDict):
    success: bool
    engine: str
    error: str
    code: str
```

Refactors:

- Replace `render_and_save_images` with a renderer-agnostic function, for example `render_and_save_score_pages`.
- Stop assuming PNG in render services.
- Allow SVG records under existing `preview_image` / `final_image` kinds with `image/svg+xml`.
- Keep `FileKind.PREVIEW_IMAGE` and `FileKind.FINAL_IMAGE` unless a later product decision renames them to preview_page/final_page.

Acceptance criteria:

- MuseScore rendering still works through `MuseScoreRenderEngine`.
- Existing review/results/share pages can load rendered files by MIME type.
- File records store correct extension and MIME type.

## Phase 5: Add Render Engine Configuration

Goal: select score renderer from configuration.

Settings:

```env
SCORE_RENDER_ENGINE=musescore
VEROVIO_PAGE_WIDTH=2100
VEROVIO_PAGE_HEIGHT=2970
VEROVIO_SCALE=40
VEROVIO_BREAKS=encoded
VEROVIO_ADJUST_PAGE_HEIGHT=false
```

Validation:

- `SCORE_RENDER_ENGINE` must be one of `musescore`, `verovio`.
- `MUSESCORE_PATH` is required only when `SCORE_RENDER_ENGINE=musescore`.
- Verovio import availability should be logged when `SCORE_RENDER_ENGINE=verovio`.

## Phase 6: Implement VerovioRenderEngine

Goal: render MusicXML to SVG without MuseScore.

Engine behavior:

```text
MusicXML
  -> Verovio toolkit
  -> page-01.svg, page-02.svg, ...
```

Options:

```python
{
    "inputFrom": "xml",
    "pageWidth": settings.VEROVIO_PAGE_WIDTH,
    "pageHeight": settings.VEROVIO_PAGE_HEIGHT,
    "scale": settings.VEROVIO_SCALE,
    "adjustPageHeight": False,
    "breaks": settings.VEROVIO_BREAKS,
}
```

Important implementation details:

- Default to `breaks="encoded"` because LEGATO/abc2xml provides system breaks.
- Render SVG, not PNG.
- Preserve one file per rendered page.
- Return MIME type `image/svg+xml`.
- Do not add SVG-to-PNG conversion in the first implementation.

Acceptance criteria:

- Preview pages are written as SVG.
- Final pages are written as SVG.
- Review, editor, results, and share pages display SVG correctly.
- Downloads work for SVG final images.

## Phase 7: Pipeline Integration

Target configured production-style flow:

```text
CopyImageStep
  -> OmrImageStep(LEGATO)
  -> ExtractXmlStep
  -> TextOcrStep
  -> XmlNormalizeStep
  -> PreviewGenerationStep(VEROVIO)
  -> FinalizeStep
```

Confirm flow:

```text
current_xml
  -> final_xml
  -> VerovioRenderEngine
  -> final_image SVG pages
```

Editor save flow:

```text
save current_xml/final_xml
  -> VerovioRenderEngine
  -> refresh preview_image/final_image SVG pages
```

## Phase 8: Frontend Compatibility

Current frontend already fetches authenticated image blobs. It should support SVG if the backend returns the correct MIME type.

Areas to verify:

- `frontend/src/lib/utils/image.ts`
- `frontend/src/app/[locale]/review/[id]/page.tsx`
- `frontend/src/app/[locale]/results/[id]/page.tsx`
- `frontend/src/app/[locale]/share/[shareId]/page.tsx`
- `frontend/src/app/[locale]/editor/[id]/page.tsx`

Acceptance criteria:

- SVG preview/final pages render in `<img>`.
- Object URLs are revoked as before.
- Download naming handles `.svg`.
- No UI assumes `.png` page files.

## Phase 9: Testing Plan

Backend unit tests:

- OMR factory selects configured engine.
- Audiveris adapter maps old result to `OmrResult`.
- LEGATO engine handles successful inference JSON.
- LEGATO conversion emits MusicXML.
- MusicXML normalization moves initial bass clef to opening attributes.
- ExtractXmlStep reads generic `ctx.omr_result`.
- Render factory selects configured engine.
- Verovio renderer writes SVG files with correct MIME type.
- Render services no longer assume PNG.

Backend integration tests:

- Single-image LEGATO pipeline using mocked inference.
- Confirm recognition renders final SVG pages.
- Save XML rerenders preview/final SVG pages.

Frontend checks:

- Typecheck.
- Lint.
- Manual SVG rendering check in review/results/share/editor.

Visual regression samples:

- Keep `backend/scripts/legato_visual_probe.py`.
- Use the three existing upload samples as smoke fixtures.
- Add new real-world samples when new renderer normalization issues appear.

## Phase 10: Cleanup After Migration

After LEGATO and Verovio become the configured default in development:

- Remove direct imports of `AudiverisEngine` from pipeline code.
- Remove direct imports of `MuseScoreEngine` from render services.
- Keep Audiveris and MuseScore engine implementations only while they are selectable.
- Remove obsolete `aud_*` naming from temporary directory helpers.
- Update `.env.example` to show LEGATO + Verovio as the preferred development configuration.

Do not remove Audiveris or MuseScore implementations in the same change as the first integration. First land the abstractions and new engines, then remove dead code after the project runs cleanly with:

```env
OMR_ENGINE=legato
SCORE_RENDER_ENGINE=verovio
```

## Current Implementation Status

Completed:

- Phase 1: generic `OMREngine` abstraction and Audiveris adapter.
- Phase 2: `OMR_ENGINE` configuration and startup logging.
- Phase 3: `LegatoOmrEngine` for `image -> ABC -> MusicXML`, including initial-clef MusicXML normalization.
- Phase 4: generic `ScoreRenderEngine` abstraction and MuseScore adapter.
- Phase 5: `SCORE_RENDER_ENGINE` configuration.
- Phase 6: `VerovioRenderEngine` for `MusicXML -> SVG`.
- Phase 7: pipeline/editor/confirm render paths now use the render factory.
- Phase 8: single-image download naming handles SVG MIME types.

The selected engine is now the boundary. Development fallback paths that hide engine failures have been removed from XML confirm/render flows.

Remaining:

- Run a real uploaded score through `OMR_ENGINE=legato` and `SCORE_RENDER_ENGINE=verovio`.
- Verify review/results/share/editor pages with real SVG preview/final pages.
- Verify external clients use archive include type `image` instead of the old PNG-specific concept.
- Design multi-page LEGATO support deliberately; it currently fails with `legato_multi_page_not_supported`.

## Open Technical Decisions

1. Whether `preview_image` and `final_image` should keep their names for SVG pages.
   - Recommendation: keep names for now; MIME type tells clients the actual format.

2. Whether to expose `omr_engine` / `render_engine` in task options.
   - Recommendation: do not expose in UI during development. Use environment config only.

3. Whether to store ABC artifacts in the database.
   - Recommendation: keep ABC artifacts in task working directories first. Add file kinds only if users or debugging workflows need downloads.

4. How to support multi-page LEGATO.
   - Recommendation: fail explicitly first; design a merge strategy later.

## Immediate Next Step

Run the product upload pipeline with:

```env
OMR_ENGINE=legato
SCORE_RENDER_ENGINE=verovio
```

Use one known good uploaded score image first. Confirm that the task produces:

- `current_xml` from LEGATO.
- SVG `preview_image` pages from Verovio.
- `final_xml` and SVG `final_image` pages after confirmation.
- Correct display and download behavior in review/results/share/editor.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Verovio listen surfaces', () => {
  it('share actions use the renderer-agnostic ListenModal API', () => {
    const path = 'src/components/share/share-actions.tsx';
    const source = readSource(path);
    expect(source).toContain('<ListenModal');
    expect(source).not.toContain('backend=');
  });

  it('editor modals no longer own score playback preview', () => {
    const source = readSource('src/components/editor/editor-page-modals.tsx');
    expect(source).not.toContain('<ListenModal');
    expect(source).not.toContain('ScorePreview');
  });

  it('renders results with a shared viewport and persistent playback dock', () => {
    const page = readSource('src/app/[locale]/results/[id]/page.tsx');
    const actions = readSource('src/components/results/results-actions.tsx');
    const player = readSource('src/components/results/results-score-player.tsx');
    expect(page).toContain('<ResultsScorePlayer');
    expect(page).toContain('<ResultsBreadcrumbs');
    expect(page).not.toContain('<ResultsScorePreview');
    expect(actions).not.toContain('<ListenModal');
    expect(player).toContain('<ScorePreviewViewport');
    expect(player).toContain('<ResultsPlaybackDock');
    expect(player).toContain("followViewport: 'window'");
    expect(player).not.toContain('<ScorePreviewPanel');
    expect(player).not.toContain('<CardTitle');
  });

  it('dynamically loads only the Verovio preview controller', () => {
    const source = readSource('src/hooks/score/use-score-preview-playback.ts');
    expect(source).toContain("'@/lib/score/verovio-score-preview-controller'");
  });

  it('wires editor preview score clicks to the event inspector mapping layer', () => {
    const source = readSource('src/components/editor/editor-preview-panel.tsx');
    expect(source).toContain('getVerovioElementIdFromTarget');
    expect(source).toContain('findScoreEntityById');
    expect(source).toContain('handleEditEntity(hit.entity, hit.location)');
    expect(source).toContain('onScoreClick={handleScoreClick}');
  });

  it('dispatches Verovio score clicks through editor tools', () => {
    const source = readSource('src/components/editor/editor-preview-panel.tsx');
    expect(source).toContain("editorMode === 'add'");
    expect(source).toContain("editorMode === 'delete'");
    expect(source).toContain("editorMode === 'addTie'");
    expect(source).toContain("editorMode === 'addSlur'");
    expect(source).toContain("editorMode === 'deleteTie'");
    expect(source).toContain("editorMode === 'deleteSlur'");
    expect(source).toContain('handleAddEntity');
    expect(source).toContain('handleDeleteEntity');
    expect(source).toContain('handleAddTieSelection');
    expect(source).toContain('handleAddSlurSelection');
    expect(source).toContain('setOnToolChange');
    expect(source).toContain('clearTieSelection');
    expect(source).toContain('clearSlurSelection');
  });

  it('renders a single Verovio insertion caret in add mode', () => {
    const source = readSource('src/components/editor/editor-preview-panel.tsx');
    expect(source).toContain('insertPreview');
    expect(source).toContain('onScoreMouseMove={handleScoreMouseMove}');
    expect(source).toContain('getCaretColorStyle(activeTrack?.color)');
    expect(source).toContain('backgroundColor: resolvedColor');
    expect(source).toContain('getEntityDurationTicks');
    expect(source).toContain('snapMeasureXToGridTick');
    expect(source).toContain('getEntityElementBounds');
    expect(source).toContain('(current.right + next.left) / 2');
    expect(source).toContain('getTargetStaffHasEvents');
    expect(source).toContain('hasTimingAnchors');
    expect(source).toContain('getVerovioMeasureIndexFromTarget');
    expect(source).toContain('getVerovioMeasureElementFromTarget');
    expect(source).toContain('tick: 0');
  });

  it('uses tap-to-position before inserting on mobile add mode', () => {
    const source = readSource('src/components/editor/editor-preview-panel.tsx');
    expect(source).toContain('useIsMobile');
    expect(source).toContain('isSameAddLocation');
    expect(source).toContain('insertPreview?.location');
    expect(source).toContain('isMobile &&');
    expect(source).toContain('confirmMobileInsert');
    expect(source).toContain("t('insertHere')");
  });

  it('allows Escape to cancel active Verovio tool modes', () => {
    const source = readSource('src/components/editor/editor-preview-panel.tsx');
    expect(source).toContain("event.key !== 'Escape'");
    expect(source).toContain('isEditableTarget');
    expect(source).toContain("selectTool('select')");
    expect(source).toContain("window.addEventListener('keydown'");
  });

  it('highlights the currently selected Verovio entity', () => {
    const viewport = readSource('src/components/score/score-preview-viewport.tsx');
    const panel = readSource('src/components/editor/editor-preview-panel.tsx');

    expect(viewport).toContain('score-editor-selected');
    expect(panel).toContain("querySelectorAll('.score-editor-selected')");
    expect(panel).toContain("element.classList.add('score-editor-selected')");
    expect(panel).toContain('editingEntity.meta.sourceIds');
  });

  it('projects hidden voice tracks onto the Verovio SVG surface', () => {
    const viewport = readSource('src/components/score/score-preview-viewport.tsx');
    const panel = readSource('src/components/editor/editor-preview-panel.tsx');

    expect(viewport).toContain('score-editor-hidden');
    expect(panel).toContain('visibleTrackIdSet');
    expect(panel).toContain('hiddenSourceIds');
    expect(panel).toContain('hiddenStaffKeys');
    expect(panel).toContain('data-related');
    expect(panel).toContain('getRelatedIds');
    expect(panel).toContain('getHiddenVerovioEventElement');
    expect(panel).toContain('hiddenBoundsByMeasure');
    expect(panel).toContain('getSvgBoundsFromGraphics');
    expect(panel).toContain('isConnectionNearHiddenEvent');
    expect(panel).toContain('VEROVIO_EVENT_CONTAINER_SELECTOR');
    expect(panel).toContain('[data-class="slur"]');
    expect(panel).toContain('[data-class="tie"]');
    expect(panel).toContain('[data-class="beam"]');
    expect(panel).toContain("element.classList.add('score-editor-hidden')");
  });

  it('marks temporarily invalid measures without blocking score editing', () => {
    const viewport = readSource('src/components/score/score-preview-viewport.tsx');
    const panel = readSource('src/components/editor/editor-preview-panel.tsx');
    const measureStatus = readSource('src/lib/editor/measure-status.ts');

    expect(viewport).toContain('score-measure-warning-outline');
    expect(panel).toContain('buildDirtyMeasureStatuses');
    expect(panel).toContain('[data-score-measure-warning]');
    expect(panel).toContain('[data-score-measure-warning-outline]');
    expect(panel).not.toContain("element.textContent = '⚠'");
    expect(measureStatus).toContain('DirtyMeasureStatus');
    expect(measureStatus).toContain('getMeasureDurationTicks');
    expect(measureStatus).toContain("kind: deltaTicks > 0 ? 'overflow' : 'underfill'");
  });

  it('keeps connection deletion in the Inspector instead of the left toolbar', () => {
    const sidebar = readSource('src/components/editor/editor-sidebar.tsx');
    const inspector = readSource('src/components/editor/event-inspector.tsx');

    expect(sidebar).toContain("label: 'addTie'");
    expect(sidebar).toContain("label: 'addSlur'");
    expect(sidebar).not.toContain("label: 'deleteTie'");
    expect(sidebar).not.toContain("label: 'deleteSlur'");
    expect(inspector).toContain('handleDeleteTie');
    expect(inspector).toContain('handleDeleteSlur');
  });

  it('uses the Verovio score as the primary editor center surface', () => {
    const center = readSource('src/components/editor/editor-workbench-center.tsx');
    const page = readSource('src/app/[locale]/editor/[id]/page.tsx');
    const toolbar = readSource('src/components/editor/editor-toolbar.tsx');

    expect(center).toContain('<EditorPreviewPanel');
    expect(center).toContain('active');
    expect(center).not.toContain('Tabs');
    expect(center).not.toContain('TimelineEditorArea');
    expect(center).not.toContain('ScoreInfoCard');
    expect(page).not.toContain('centerTab');
    expect(page).not.toContain('setCenterTab');
    expect(toolbar).not.toContain('livePreview');
    expect(toolbar).not.toContain('Eye');
  });

  it('keeps score-level metadata editing in the right inspector', () => {
    const inspector = readSource('src/components/editor/event-inspector.tsx');

    expect(inspector).toContain('function ScoreInspectorPanel');
    expect(inspector).toContain('useMetadataEditor');
    expect(inspector).toContain('updateScoreMainTitle');
    expect(inspector).toContain('updateScoreSubtitle');
    expect(inspector).toContain('updateScoreComposer');
    expect(inspector).toContain('updateScoreLyricist');
    expect(inspector).toContain('updateScoreCopyright');
    expect(inspector).toContain('updateKeySignature');
    expect(inspector).toContain('updateTimeSignature');
    expect(inspector).toContain('updateTempo');
    expect(inspector).toContain('mainTitleLabel');
    expect(inspector).toContain('timeSignatureLabel');
  });
});

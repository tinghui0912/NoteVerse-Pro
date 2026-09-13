'use client';

import { ArrowDown, ArrowLeft, ArrowLeftToLine, ArrowRight, ArrowRightToLine, ArrowUp, ChevronRight, Minus, Plus, Scissors, Trash2, Unlink, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useEditingDomainInspectorViewModel,
  useEditorDomainEdit,
  useEditorState,
  useEntityEditor,
  useScoreData,
} from '@/contexts/editor-provider';
import type { EditingSelectionState } from '@/contexts/editor-state-context';
import { useToast } from '@/hooks/use-toast';
import type { AccidentalValue, Duration } from '@/types/score-types';
import {
  findNoteAtomByMusicXmlElementId,
  getVoiceEventMusicXmlElementIds,
  type BeamRelationshipAction,
  type DomainAnchor,
  type EventId,
  type InspectorDraft,
  type InspectorViewModel,
  type NoteAtomId,
  type VoiceEvent,
} from '@/lib/editor-domain';
import {
  addPitch,
  getEditableEventDisplayKind,
  getEditableEventSummaryIcon,
  getEditableEventSummaryPitch,
  isExplicitRestEditableEvent,
  isPitchedEditableEvent,
  removePitch,
  type EditableEvent,
} from './event-inspector-editable-event';
import { parseXml } from '@/lib/musicxml/core';
import { getManualBeamDirectionAtEntity, getManualBeamRunSourceIdsAtEntity, type BeamDirection } from '@/lib/musicxml/automatic-beams';
import { cn } from '@/lib/utils';
import {
  buildDomainSlurDetails,
  buildDomainTieDetails,
  getEntitySourcePitch,
  type ConnectionDirection,
  type ConnectionDetail,
} from './event-inspector-connections';
import {
  accidentalPitchSuffix,
  getAccidentalOnlyPitchedEdit,
  getFingeringOnlyPitchedEdit,
  getPitchOnlyPitchedEdit,
  isRhythmOrStemOnlyPitchedEdit,
  splitPitch,
  type AccidentalOnlyPitchedEdit,
  type PitchOnlyPitchedEdit,
  toDomainPitchFromInspectorPitch,
  updatePitchPart,
} from './event-inspector-event-model';
import { toDomainRhythm } from './event-inspector-domain-adapter';
import {
  getDomainSelectionSummary,
  toEditableEventFromDomainInspectorViewModel,
} from './event-inspector-domain-view-model';
import { ACCIDENTALS, DURATIONS, PITCH_NAMES } from './event-inspector-options';
import { ScoreInspectorPanel } from './event-score-inspector';

interface EventInspectorProps {
  scoreInspectorOpen: boolean;
  onCloseScoreInspector: () => void;
}

export function EventInspector({ scoreInspectorOpen, onCloseScoreInspector }: EventInspectorProps) {
  const { editingSelection, inspectorOpen } = useEditorState();
  const domainInspector = useEditingDomainInspectorViewModel();
  const editableEvent = domainInspector.viewModel
    ? toEditableEventFromDomainInspectorViewModel(domainInspector.viewModel)
    : null;

  if (!editableEvent || !inspectorOpen || !editingSelection) {
    return scoreInspectorOpen ? <ScoreInspectorPanel onClose={onCloseScoreInspector} /> : null;
  }

  return (
    <EventInspectorPanel
      key={getEditingSelectionKey(editingSelection)}
      editingSelection={editingSelection}
      editableEvent={editableEvent}
    />
  );
}

function EventInspectorPanel({
  editingSelection,
  editableEvent,
}: {
  editingSelection: EditingSelectionState;
  editableEvent: EditableEvent;
}) {
  const t = useTranslations('editor');
  const common = useTranslations('common');
  const { scoreData, currentXml } = useScoreData();
  const { toast } = useToast();
  const { handleCloseModal } = useEntityEditor();
  const { openEditingSelection } = useEditorState();
  const {
    applyDomainBeamRelationshipEditBySourceId,
    applyDomainInspectorEdit,
    applyDomainStemDirectionToSourceIds,
    deleteDomainSlurRelationshipBySourceIds,
    deleteDomainTieRelationshipBySourceIds,
    setDomainSlurPlacementBySourceIds,
    setDomainTiePlacementBySourceIds,
  } = useEditorDomainEdit();
  const domainInspector = useEditingDomainInspectorViewModel();
  const domainSelectionSummary = useMemo(() => (
    domainInspector.viewModel ? getDomainSelectionSummary(domainInspector.viewModel) : null
  ), [domainInspector.viewModel]);

  const event = editableEvent;
  const summaryEvent = event;
  const domainInspectorStatus: 'ready' | 'unavailable' | 'error' = domainInspector.error
    ? 'error'
    : domainInspector.viewModel ? 'ready' : 'unavailable';
  const controlEvent = event;
  const controlEventSource = domainInspectorStatus === 'ready' ? 'domainViewModel' : 'unavailable';
  const currentXmlDoc = useMemo(() => currentXml ? parseXml(currentXml) : null, [currentXml]);
  const [notePropertiesOpen, setNotePropertiesOpen] = useState(true);
  const [beamPropertiesOpen, setBeamPropertiesOpen] = useState(false);
  const selectedMusicXmlSourceId = getPrimarySelectedMusicXmlSourceId(domainInspector.event);
  const beamDirection = useMemo(() => {
    return currentXmlDoc && selectedMusicXmlSourceId
      ? getManualBeamDirectionAtEntity(currentXmlDoc, selectedMusicXmlSourceId)
      : null;
  }, [currentXmlDoc, selectedMusicXmlSourceId]);
  const tieDetails = useMemo(() => buildDomainTieDetails({
    document: domainInspector.document,
    event: domainInspector.event?.kind === 'pitched' ? domainInspector.event : null,
    scoreData,
  }), [domainInspector.document, domainInspector.event, scoreData]);
  const slurDetails = useMemo(() => buildDomainSlurDetails({
    document: domainInspector.document,
    event: domainInspector.event?.kind === 'pitched' ? domainInspector.event : null,
    scoreData,
  }), [domainInspector.document, domainInspector.event, scoreData]);

  const eventTypeLabel = useMemo(() => {
    const displayKind = getEditableEventDisplayKind(summaryEvent);
    if (displayKind === 'explicitRest') return t('eventTypeRest');
    if (displayKind === 'singleNote') return t('eventTypeNote');
    return t('eventTypeChord');
  }, [summaryEvent, t]);
  const summaryPitch = getEditableEventSummaryPitch(summaryEvent, t('eventTypeRest'));
  const summaryIcon = getEditableEventSummaryIcon(summaryEvent);
  const summaryMeasure = domainSelectionSummary?.measure ?? 1;
  const summaryVoice = domainSelectionSummary?.voice ?? 1;

  const handleDomainInspectorEditResult = (
    result: ReturnType<typeof applyDomainInspectorEdit>,
    nextDomainAnchor: DomainAnchor | null = editingSelection?.domainAnchor ?? null,
  ) => {
    if (!result.success) {
      toast({
        title: common('operationFailed'),
        description: result.error,
        variant: 'destructive',
      });
      return;
    }

    if (result.refreshedSelection) {
      openEditingSelection({
        domainAnchor: nextDomainAnchor,
        domainCompanion: null,
      });
    } else {
      handleCloseModal();
    }
  };

  const commitEvent = (nextEvent: EditableEvent) => {
    const domainWriteEventId = getPitchedDomainWriteEventId(domainInspector.viewModel);
    const domainExplicitRestEventId = getExplicitRestDomainWriteEventId(domainInspector.viewModel);
    const reselectSourceIds = getInspectorReselectSourceIds(domainInspector.event);
    const fingeringOnlyEdit = getFingeringOnlyPitchedEdit(event, nextEvent);
    const fingeringSourceId = fingeringOnlyEdit ? reselectSourceIds[fingeringOnlyEdit.index] : undefined;
    const pitchOnlyEdit = getPitchOnlyPitchedEdit(event, nextEvent);
    const pitchSourceId = pitchOnlyEdit ? reselectSourceIds[pitchOnlyEdit.index] : undefined;
    const accidentalOnlyEdit = getAccidentalOnlyPitchedEdit(event, nextEvent);
    const accidentalSourceId = accidentalOnlyEdit ? reselectSourceIds[accidentalOnlyEdit.index] : undefined;

    if (
      domainInspectorStatus === 'ready'
      && fingeringOnlyEdit
      && fingeringSourceId
      && reselectSourceIds.length > 0
    ) {
      const result = applyDomainInspectorEdit({
        draft: toRetargetableFingeringOnlyNoteAtomDraft(fingeringSourceId, fingeringOnlyEdit.value),
        retargetNoteAtomSourceId: fingeringSourceId,
        reselectSourceIds,
      });
      handleDomainInspectorEditResult(result);
      return;
    }

    if (
      domainInspectorStatus === 'ready'
      && pitchOnlyEdit
      && pitchSourceId
      && reselectSourceIds.length > 0
    ) {
      const result = applyDomainInspectorEdit({
        draft: toRetargetablePitchOnlyNoteAtomDraft(pitchSourceId, pitchOnlyEdit),
        retargetNoteAtomSourceId: pitchSourceId,
        reselectSourceIds,
      });
      handleDomainInspectorEditResult(result);
      return;
    }

    if (
      domainInspectorStatus === 'ready'
      && accidentalOnlyEdit
      && accidentalSourceId
      && reselectSourceIds.length > 0
    ) {
      const result = applyDomainInspectorEdit({
        draft: toRetargetableAccidentalOnlyNoteAtomDraft(accidentalSourceId, accidentalOnlyEdit),
        retargetNoteAtomSourceId: accidentalSourceId,
        reselectSourceIds,
      });
      handleDomainInspectorEditResult(result);
      return;
    }

    if (
      domainInspectorStatus === 'ready'
      && domainExplicitRestEventId
      && reselectSourceIds.length > 0
      && isExplicitRestEditableEvent(event)
      && isExplicitRestEditableEvent(nextEvent)
    ) {
      const result = applyDomainInspectorEdit({
        draft: toDomainRhythmOnlyExplicitRestInspectorDraft(nextEvent, domainExplicitRestEventId),
        reselectSourceIds,
      });
      handleDomainInspectorEditResult(result);
      return;
    }

    if (
      domainInspectorStatus === 'ready'
      && domainWriteEventId
      && reselectSourceIds.length > 0
      && isRhythmOrStemOnlyPitchedEdit(event, nextEvent)
    ) {
      const result = applyDomainInspectorEdit({
        draft: toDomainRhythmOnlyPitchedInspectorDraft(nextEvent, domainWriteEventId),
        notationOverrides: toDomainNotationOverrides(nextEvent),
        reselectSourceIds,
      });
      handleDomainInspectorEditResult(result);
      return;
    }

    toast({
      title: common('operationFailed'),
      description: 'This Inspector edit is not represented by a domain command.',
      variant: 'destructive',
    });
  };

  const setPitch = (index: number, nextPitch: string) => {
    commitEvent({
      ...event,
      pitches: event.pitches.map((pitch, i) => (i === index ? nextPitch : pitch)),
    });
  };

  const appendPitch = () => {
    const domainWriteEventId = getPitchedDomainWriteEventId(domainInspector.viewModel);
    const reselectSourceIds = getInspectorReselectSourceIds(domainInspector.event);

    if (
      domainInspectorStatus === 'ready'
      && isPitchedEditableEvent(event)
      && domainWriteEventId
      && reselectSourceIds.length > 0
    ) {
      const result = applyDomainInspectorEdit({
        draft: {
          kind: 'appendNoteAtom',
          eventId: domainWriteEventId,
          pitch: toDomainPitchFromInspectorPitch('C4'),
        },
        reselectSourceIds,
      });
      handleDomainInspectorEditResult(result, {
        kind: 'event',
        eventId: domainWriteEventId,
      });
      return;
    }

    commitEvent(addPitch(event, 'C4'));
  };

  const removePitchAt = (index: number) => {
    const domainWriteEventId = getPitchedDomainWriteEventId(domainInspector.viewModel);
    const domainNoteAtomId = getPitchedDomainNoteAtomId(domainInspector.viewModel, index);
    const reselectSourceIds = getInspectorReselectSourceIds(domainInspector.event);

    if (
      domainInspectorStatus === 'ready'
      && isPitchedEditableEvent(event)
      && event.pitches.length > 1
      && domainWriteEventId
      && domainNoteAtomId
      && reselectSourceIds.length > 0
    ) {
      const result = applyDomainInspectorEdit({
        draft: {
          kind: 'removeNoteAtom',
          eventId: domainWriteEventId,
          noteAtomId: domainNoteAtomId,
        },
        reselectSourceIds,
      });
      handleDomainInspectorEditResult(result, {
        kind: 'event',
        eventId: domainWriteEventId,
      });
      return;
    }

    commitEvent(removePitch(event, index));
  };

  const setFingering = (index: number, value: string) => {
    commitEvent({
      ...event,
      fingerings: event.fingerings.map((fingering, i) => (i === index ? value : fingering)),
    });
  };

  const setAccidental = (index: number, accidental: AccidentalValue) => {
    const parsed = splitPitch(event.pitches[index] ?? 'C4');
    const shouldRemove = event.accidentals[index] === accidental;
    commitEvent({
      ...event,
      pitches: event.pitches.map((pitch, pitchIndex) => (
        pitchIndex === index
          ? `${parsed.name}${shouldRemove ? '' : accidentalPitchSuffix(accidental)}${parsed.octave}`
          : pitch
      )),
      accidentals: event.accidentals.map((value, accidentalIndex) => (
        accidentalIndex === index ? (shouldRemove ? null : accidental) : value
      )),
    });
  };

  const deleteTieConnection = (detail: ConnectionDetail) => {
    if (!detail.sourceId || !detail.partnerSourceId) {
      toast({
        title: common('operationFailed'),
        description: t('noConnectionData'),
        variant: 'destructive',
      });
      return;
    }

    const result = deleteDomainTieRelationshipBySourceIds({
      sourceId: detail.sourceId,
      partnerSourceId: detail.partnerSourceId,
      reselectSourceIds: getInspectorReselectSourceIds(domainInspector.event),
      actionName: t('deleteTie'),
    });
    toast({
      title: result.success ? common('operationSuccess') : common('operationFailed'),
      description: result.success ? t('tieDeleted', { count: 2 }) : result.error,
      variant: result.success ? undefined : 'destructive',
    });
  };

  const deleteSlurConnection = (detail: ConnectionDetail) => {
    if (!detail.sourceId || !detail.partnerSourceId) {
      toast({
        title: common('operationFailed'),
        description: t('noConnectionData'),
        variant: 'destructive',
      });
      return;
    }

    const result = deleteDomainSlurRelationshipBySourceIds({
      sourceId: detail.sourceId,
      partnerSourceId: detail.partnerSourceId,
      reselectSourceIds: getInspectorReselectSourceIds(domainInspector.event),
      actionName: t('deleteSlur'),
    });
    toast({
      title: result.success ? common('operationSuccess') : common('operationFailed'),
      description: result.success ? t('slurDeleted', { count: 2 }) : result.error,
      variant: result.success ? undefined : 'destructive',
    });
  };

  const updateTieConnectionDirection = (detail: ConnectionDetail, direction: ConnectionDirection) => {
    if (!detail.sourceId || !detail.partnerSourceId) {
      toast({
        title: common('operationFailed'),
        description: t('noConnectionData'),
        variant: 'destructive',
      });
      return;
    }
    const result = setDomainTiePlacementBySourceIds({
      sourceId: detail.sourceId,
      partnerSourceId: detail.partnerSourceId,
      placement: direction === 'auto' ? undefined : direction,
      reselectSourceIds: getInspectorReselectSourceIds(domainInspector.event),
      actionName: t('actions.updateConnectionDirection'),
    });
    if (!result.success) {
      toast({
        title: common('operationFailed'),
        description: result.error,
        variant: 'destructive',
      });
    }
  };

  const updateSlurConnectionDirection = (detail: ConnectionDetail, direction: ConnectionDirection) => {
    if (!detail.sourceId || !detail.partnerSourceId) {
      toast({
        title: common('operationFailed'),
        description: t('noConnectionData'),
        variant: 'destructive',
      });
      return;
    }
    const result = setDomainSlurPlacementBySourceIds({
      sourceId: detail.sourceId,
      partnerSourceId: detail.partnerSourceId,
      placement: direction === 'auto' ? undefined : direction,
      reselectSourceIds: getInspectorReselectSourceIds(domainInspector.event),
      actionName: t('actions.updateConnectionDirection'),
    });
    if (!result.success) {
      toast({
        title: common('operationFailed'),
        description: result.error,
        variant: 'destructive',
      });
    }
  };

  const openConnectionEndpoint = (detail: ConnectionDetail, endpoint: 'current' | 'partner') => {
    const sourceId = endpoint === 'current' ? detail.sourceId : detail.partnerSourceId;
    const domainNoteAtom = sourceId && domainInspector.document
      ? findNoteAtomByMusicXmlElementId(domainInspector.document, sourceId)
      : null;
    if (domainNoteAtom) {
      openEditingSelection({
        domainAnchor: domainNoteAtom
          ? {
              kind: 'noteAtom',
              eventId: domainNoteAtom.event.id,
              noteAtomId: domainNoteAtom.note.id,
            }
          : null,
        domainCompanion: null,
      });
      return;
    }
  };

  const updateBeam = (action: BeamRelationshipAction) => {
    const sourceId = getPrimarySelectedMusicXmlSourceId(domainInspector.event);
    if (!sourceId) return;

    const result = applyDomainBeamRelationshipEditBySourceId({
      sourceId,
      action,
      reselectSourceIds: getInspectorReselectSourceIds(domainInspector.event),
      actionName: t('actions.updateBeam'),
    });

    if (!result.success) {
      toast({
        title: common('operationFailed'),
        description: result.error || t('beamActionUnavailable'),
        variant: 'destructive',
      });
    }
  };

  const updateBeamDirection = (direction: BeamDirection) => {
    const entityId = getPrimarySelectedMusicXmlSourceId(domainInspector.event);
    if (!currentXmlDoc || !entityId) return;
    const sourceIds = getManualBeamRunSourceIdsAtEntity(currentXmlDoc, entityId);
    if (sourceIds.length === 0) {
      toast({
        title: common('operationFailed'),
        description: t('beamActionUnavailable'),
        variant: 'destructive',
      });
      return;
    }

    const result = applyDomainStemDirectionToSourceIds({
      sourceIds,
      stemDirection: direction === 'auto' ? undefined : direction,
      actionName: t('actions.updateBeamDirection'),
    });
    if (!result.success) {
      toast({
        title: common('operationFailed'),
        description: result.error,
        variant: 'destructive',
      });
    }
  };

  return (
    <aside
      className="sticky top-24 h-[calc(100vh-8.5rem)] w-full shrink-0 xl:w-80"
      data-domain-inspector-kind={domainInspector.viewModel?.kind}
      data-domain-inspector-source={domainInspector.viewModelSource}
      data-domain-inspector-status={domainInspectorStatus}
      data-domain-inspector-controls-source={controlEventSource}
      data-domain-inspector-staff-index={domainSelectionSummary?.staffIndex}
    >
      <div className="flex h-full flex-col overflow-hidden rounded-2xl border bg-white/90 shadow-lg backdrop-blur-sm">
        <div className="border-b p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs font-medium text-muted-foreground">{t('currentSelection')}</p>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={handleCloseModal}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex gap-3">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border bg-background font-[LelandText] text-4xl leading-none text-foreground">
              {summaryIcon}
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-semibold text-foreground">{eventTypeLabel}</p>
              <p className="truncate text-lg font-semibold text-foreground">{summaryPitch}</p>
              <p className="text-xs text-muted-foreground">{t('selectionMeasure', { measure: summaryMeasure })}</p>
              <p className="text-xs text-muted-foreground">{t('selectionVoice', { voice: summaryVoice })}</p>
              <p className="text-xs text-muted-foreground">
                {t(summaryEvent.dotted ? 'summaryDottedDuration' : 'summaryDuration', { duration: t(summaryEvent.duration as never) })}
              </p>
            </div>
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div>
            <div className="overflow-hidden border-b">
              <Collapsible
                open={notePropertiesOpen}
                onOpenChange={setNotePropertiesOpen}
                className="border-b last:border-b-0"
              >
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition-colors hover:bg-secondary/50"
                  >
                    <span className="text-sm font-semibold">{t('noteProperties')}</span>
                    <ChevronRight className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', notePropertiesOpen && 'rotate-90')} />
                  </button>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <div className="space-y-5 border-t bg-secondary/20 p-4">
                    <section className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label>{t('pitchesLabel')}</Label>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 bg-background"
                          aria-label="Add pitch"
                          onClick={appendPitch}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>

                    {isExplicitRestEditableEvent(controlEvent) ? (
                      <div className="rounded-lg border border-dashed bg-background p-3 text-sm text-muted-foreground">
                        {t('noPitchesRestHint')}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {controlEvent.pitches.map((pitch, index) => {
                          const parsed = splitPitch(pitch);
                          const canRemovePitch = controlEvent.pitches.length > 1;

                          return (
                            <div key={`${pitch}-${index}`} className="relative overflow-hidden rounded-lg bg-background p-3 pr-10 shadow-sm">
                              <div className="grid grid-cols-[minmax(0,1fr)_4.75rem] items-end gap-2">
                                <div className="min-w-0 space-y-1">
                                  <Label className="text-xs">{t('pitchLabel')}</Label>
                                  <Select
                                    value={parsed.name}
                                    onValueChange={(value) => setPitch(index, updatePitchPart(pitch, 'name', value))}
                                  >
                                    <SelectTrigger className="h-9 w-full">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {PITCH_NAMES.map((name) => (
                                        <SelectItem key={name} value={name}>{name}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>

                                <div className="space-y-1">
                                  <Label className="text-xs">{t('octaveLabel')}</Label>
                                  <Input
                                    type="number"
                                    min={0}
                                    max={9}
                                    className="h-9"
                                    value={parsed.octave}
                                    onChange={(change) => setPitch(index, updatePitchPart(pitch, 'octave', change.target.value))}
                                  />
                                </div>

                                <div className="col-span-2 min-w-0 space-y-1">
                                  <Label className="text-xs">{t('accidentalLabel')}</Label>
                                  <div className="grid grid-cols-4 gap-2">
                                    {ACCIDENTALS.map((accidental) => (
                                      <Button
                                        key={accidental.value}
                                        type="button"
                                        variant={controlEvent.accidentals[index] === accidental.value ? 'default' : 'outline'}
                                        size="icon"
                                        className="h-9 w-full font-[LelandText] text-xl"
                                        aria-label={t(`accidental.${accidental.value}` as never)}
                                        title={t(`accidental.${accidental.value}` as never)}
                                        onClick={() => setAccidental(index, accidental.value)}
                                      >
                                        {accidental.symbol}
                                      </Button>
                                    ))}
                                  </div>
                                </div>

                                <div className="col-span-2 min-w-0 space-y-1">
                                  <Label className="text-xs">{t('fingeringLabel')}</Label>
                                  <Select
                                    value={controlEvent.fingerings[index] ?? 'none'}
                                    onValueChange={(value) => setFingering(index, value)}
                                  >
                                    <SelectTrigger className="h-9 w-full">
                                      <SelectValue placeholder={t('fingeringNone')} />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="none">{t('fingeringNone')}</SelectItem>
                                      <SelectItem value="1">1</SelectItem>
                                      <SelectItem value="2">2</SelectItem>
                                      <SelectItem value="3">3</SelectItem>
                                      <SelectItem value="4">4</SelectItem>
                                      <SelectItem value="5">5</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>

                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="absolute right-2 top-8 h-8 w-8 text-muted-foreground hover:text-destructive"
                                  disabled={!canRemovePitch}
                                  aria-label="Remove pitch"
                                  onClick={() => removePitchAt(index)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>

                  <section className="space-y-4">
                    <div className="space-y-2">
                      <Label>{t('durationLabel')}</Label>
                      <Select value={controlEvent.duration} onValueChange={(value) => commitEvent({ ...event, duration: value as Duration })}>
                        <SelectTrigger className="bg-background">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DURATIONS.map((duration) => (
                            <SelectItem key={duration} value={duration}>{t(duration as never)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>{t('isDottedTitle')}</Label>
                      <div className="flex h-10 items-center gap-2 rounded-md border bg-background px-3">
                        <Checkbox
                          id="event-dotted"
                          checked={controlEvent.dotted}
                          onCheckedChange={(checked) => commitEvent({ ...event, dotted: checked === true })}
                        />
                        <Label htmlFor="event-dotted" className="font-normal">{common('dotted')}</Label>
                      </div>
                    </div>
                  </section>

                  {isPitchedEditableEvent(controlEvent) && (
                    <section className="space-y-2">
                      <Label>{t('stemDirectionLabel')}</Label>
                      <DirectionRadioGroup
                        value={controlEvent.stemDirection}
                        options={[
                          { value: 'none', ariaLabel: t('directionAuto'), label: t('directionAuto') },
                          { value: 'up', ariaLabel: 'up', icon: ArrowUp },
                          { value: 'down', ariaLabel: 'down', icon: ArrowDown },
                        ]}
                        onValueChange={(value) => commitEvent({ ...event, stemDirection: value as EditableEvent['stemDirection'] })}
                      />
                    </section>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>

              {isPitchedEditableEvent(event) && (
                <Collapsible
                  open={beamPropertiesOpen}
                  onOpenChange={setBeamPropertiesOpen}
                  className="border-b last:border-b-0"
                >
                  <CollapsibleTrigger asChild>
                    <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition-colors hover:bg-secondary/50">
                      <span className="text-sm font-semibold">{t('beamProperties')}</span>
                      <ChevronRight className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', beamPropertiesOpen && 'rotate-90')} />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="grid grid-cols-4 gap-2 border-t bg-secondary/20 p-4">
                      <Button type="button" variant="outline" size="icon" onClick={() => updateBeam('previous')} aria-label={t('beamJoinPrevious')} title={t('beamJoinPrevious')}>
                        <ArrowLeftToLine className="h-4 w-4" />
                      </Button>
                      <Button type="button" variant="outline" size="icon" onClick={() => updateBeam('next')} aria-label={t('beamJoinNext')} title={t('beamJoinNext')}>
                        <ArrowRightToLine className="h-4 w-4" />
                      </Button>
                      <Button type="button" variant="outline" size="icon" onClick={() => updateBeam('break-left')} aria-label={t('beamBreakLeft')} title={t('beamBreakLeft')}>
                        <span className="flex items-center"><ArrowLeft className="h-3 w-3" /><Scissors className="h-4 w-4" /></span>
                      </Button>
                      <Button type="button" variant="outline" size="icon" onClick={() => updateBeam('break-right')} aria-label={t('beamBreakRight')} title={t('beamBreakRight')}>
                        <span className="flex items-center"><Scissors className="h-4 w-4" /><ArrowRight className="h-3 w-3" /></span>
                      </Button>
                      {beamDirection && (
                        <div className="col-span-4 space-y-2 pt-2">
                          <Label>{t('beamDirectionLabel')}</Label>
                          <DirectionRadioGroup
                            value={beamDirection}
                            options={[
                              { value: 'auto', ariaLabel: t('directionAuto'), label: t('directionAuto') },
                              { value: 'up', ariaLabel: t('directionUp'), icon: ArrowUp },
                              { value: 'down', ariaLabel: t('directionDown'), icon: ArrowDown },
                            ]}
                            onValueChange={(value) => updateBeamDirection(value as BeamDirection)}
                          />
                        </div>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}

              {isPitchedEditableEvent(event) && (
                <>
                  <ConnectionDetailGroup
                    title={common('tie')}
                    details={tieDetails}
                    emptyText={t('noTieConnections')}
                    fallbackText={t('unknownConnectionEndpoint')}
                    onDeleteConnection={deleteTieConnection}
                    onUpdateDirection={updateTieConnectionDirection}
                    onOpenEndpoint={openConnectionEndpoint}
                    scoreData={scoreData}
                  />

                  <ConnectionDetailGroup
                    title={common('slur')}
                    details={slurDetails}
                    emptyText={t('noSlurConnections')}
                    fallbackText={t('unknownConnectionEndpoint')}
                    onDeleteConnection={deleteSlurConnection}
                    onUpdateDirection={updateSlurConnectionDirection}
                    onOpenEndpoint={openConnectionEndpoint}
                    scoreData={scoreData}
                  />
                </>
              )}
            </div>
          </div>
        </ScrollArea>

      </div>
    </aside>
  );
}

function ConnectionDetailGroup({
  title,
  details,
  emptyText,
  fallbackText,
  onDeleteConnection,
  onUpdateDirection,
  onOpenEndpoint,
  scoreData,
}: {
  title: string;
  details: ConnectionDetail[];
  emptyText: string;
  fallbackText: string;
  onDeleteConnection: (detail: ConnectionDetail) => void;
  onUpdateDirection: (detail: ConnectionDetail, direction: ConnectionDirection) => void;
  onOpenEndpoint: (detail: ConnectionDetail, endpoint: 'current' | 'partner') => void;
  scoreData: ReturnType<typeof useScoreData>['scoreData'];
}) {
  const t = useTranslations('editor');
  const [open, setOpen] = useState(details.length > 0);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b last:border-b-0">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition-colors hover:bg-secondary/50"
        >
          <span className="min-w-0 text-sm font-semibold">{title}</span>
          <ChevronRight className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="space-y-2 border-t bg-secondary/20 p-4">
          {details.length === 0 ? (
            <p className="rounded-md bg-background px-3 py-2 text-xs text-muted-foreground">{emptyText}</p>
          ) : (
            details.map((detail) => (
              <div key={detail.id} className="rounded-md bg-background p-3 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-3">
                    <p className="text-sm font-medium">
                      <button
                        type="button"
                        className="rounded-sm text-left hover:text-primary hover:underline"
                        onClick={() => onOpenEndpoint(detail, 'current')}
                      >
                        {getEntitySourcePitch(scoreData, detail.currentId, detail.sourceId, detail.current, fallbackText)}
                      </button>
                      <span className="mx-1.5 text-muted-foreground">-&gt;</span>
                      <button
                        type="button"
                        className="rounded-sm text-left hover:text-primary hover:underline"
                        onClick={() => onOpenEndpoint(detail, 'partner')}
                      >
                        {getEntitySourcePitch(scoreData, detail.partnerId, detail.partnerSourceId, detail.partner, fallbackText)}
                      </button>
                    </p>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('connectionDirectionLabel')}</Label>
                      <DirectionRadioGroup
                        value={detail.direction}
                        options={[
                          { value: 'auto', ariaLabel: t('directionAuto'), label: t('directionAuto') },
                          { value: 'above', ariaLabel: 'above', icon: ArrowUp },
                          { value: 'below', ariaLabel: 'below', icon: ArrowDown },
                        ]}
                        onValueChange={(value) => onUpdateDirection(detail, value as ConnectionDirection)}
                      />
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={t('deleteConnection')}
                    onClick={() => onDeleteConnection(detail)}
                  >
                    <Unlink className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function DirectionRadioGroup<TValue extends string>({
  value,
  options,
  onValueChange,
}: {
  value: TValue;
  options: Array<{
    value: TValue;
    ariaLabel: string;
    icon?: typeof Minus;
    label?: string;
  }>;
  onValueChange: (value: TValue) => void;
}) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(nextValue) => onValueChange(nextValue as TValue)}
      className="grid grid-cols-3 gap-2"
    >
      {options.map(({ value: optionValue, ariaLabel, icon: Icon, label }) => (
        <Label
          key={optionValue}
          aria-label={ariaLabel}
          className={cn(
            'flex h-10 cursor-pointer items-center justify-center rounded-md border bg-background px-2 text-sm font-medium transition-colors',
            'hover:border-primary/60 hover:text-primary',
            value === optionValue && 'border-primary bg-primary/10 text-primary shadow-sm'
          )}
        >
          <RadioGroupItem value={optionValue} className="sr-only" />
          {Icon ? <Icon className="h-4 w-4" /> : <span>{label}</span>}
        </Label>
      ))}
    </RadioGroup>
  );
}

function getEditingSelectionKey(selection: EditingSelectionState): string {
  const { domainAnchor } = selection;
  if (!domainAnchor) return 'domain-unavailable';
  if (domainAnchor.kind === 'event') {
    return `domain-event:${String(domainAnchor.eventId)}`;
  }
  if (domainAnchor.kind === 'noteAtom') {
    return `domain-note:${String(domainAnchor.eventId)}:${String(domainAnchor.noteAtomId)}`;
  }
  return `domain:${domainAnchor.kind}:${JSON.stringify(domainAnchor)}`;
}

function getInspectorReselectSourceIds(
  event: VoiceEvent | null,
): string[] {
  return event ? getVoiceEventMusicXmlElementIds(event) : [];
}

function getPrimarySelectedMusicXmlSourceId(
  event: VoiceEvent | null,
): string | null {
  return event ? getVoiceEventMusicXmlElementIds(event)[0] ?? null : null;
}

function getPitchedDomainWriteEventId(viewModel: InspectorViewModel | null): EventId | null {
  if (!viewModel) return null;
  if (viewModel.kind === 'pitchedEvent' || viewModel.kind === 'noteAtom') {
    return viewModel.eventId;
  }
  return null;
}

function getPitchedDomainNoteAtomId(
  viewModel: InspectorViewModel | null,
  index: number,
): NoteAtomId | null {
  if (viewModel?.kind === 'pitchedEvent') {
    return viewModel.notes[index]?.noteAtomId ?? null;
  }
  if (viewModel?.kind === 'noteAtom' && index === 0) {
    return viewModel.noteAtomId;
  }
  return null;
}

function getExplicitRestDomainWriteEventId(viewModel: InspectorViewModel | null): EventId | null {
  return viewModel?.kind === 'explicitRest' ? viewModel.eventId : null;
}

function toDomainRhythmOnlyPitchedInspectorDraft(
  event: EditableEvent,
  eventId: EventId,
): Extract<InspectorDraft, { kind: 'pitchedEvent' }> {
  return {
    kind: 'pitchedEvent',
    eventId,
    rhythm: toDomainRhythm(event.duration, event.dotted),
  };
}

function toDomainRhythmOnlyExplicitRestInspectorDraft(
  event: EditableEvent,
  eventId: EventId,
): Extract<InspectorDraft, { kind: 'explicitRest' }> {
  return {
    kind: 'explicitRest',
    eventId,
    rhythm: toDomainRhythm(event.duration, event.dotted),
  };
}

function toDomainNotationOverrides(event: EditableEvent) {
  return {
    stemDirection: event.stemDirection === 'up' || event.stemDirection === 'down'
      ? event.stemDirection
      : undefined,
  };
}

function toDomainFingeringPatchValue(value: string): string | null {
  return value === 'none' ? null : value;
}

function toRetargetableFingeringOnlyNoteAtomDraft(
  sourceId: string,
  fingering: string,
): Extract<InspectorDraft, { kind: 'noteAtom' }> {
  // These ids are placeholders for the retargeting bridge. The actual domain
  // eventId and noteAtomId are resolved from `retargetNoteAtomSourceId` after
  // importing the current MusicXML into the editor-domain document.
  return {
    kind: 'noteAtom',
    eventId: sourceId as EventId,
    noteAtomId: sourceId as NoteAtomId,
    fingering: toDomainFingeringPatchValue(fingering),
  };
}

function toRetargetablePitchOnlyNoteAtomDraft(
  sourceId: string,
  edit: PitchOnlyPitchedEdit,
): Extract<InspectorDraft, { kind: 'noteAtom' }> {
  // These ids are placeholders for the retargeting bridge. The actual domain
  // eventId and noteAtomId are resolved from `retargetNoteAtomSourceId` after
  // importing the current MusicXML into the editor-domain document.
  return {
    kind: 'noteAtom',
    eventId: sourceId as EventId,
    noteAtomId: sourceId as NoteAtomId,
    pitch: edit.pitch,
  };
}

function toRetargetableAccidentalOnlyNoteAtomDraft(
  sourceId: string,
  edit: AccidentalOnlyPitchedEdit,
): Extract<InspectorDraft, { kind: 'noteAtom' }> {
  // These ids are placeholders for the retargeting bridge. The actual domain
  // eventId and noteAtomId are resolved from `retargetNoteAtomSourceId` after
  // importing the current MusicXML into the editor-domain document.
  return {
    kind: 'noteAtom',
    eventId: sourceId as EventId,
    noteAtomId: sourceId as NoteAtomId,
    pitch: edit.pitch,
    accidental: edit.accidental,
  };
}

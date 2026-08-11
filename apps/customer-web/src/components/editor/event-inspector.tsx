'use client';

import { ArrowDown, ArrowLeft, ArrowLeftToLine, ArrowRight, ArrowRightToLine, ArrowUp, ChevronRight, Minus, Plus, Scissors, Trash2, Unlink, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
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
import { useEditorState, useEntityEditor, useScoreData, useXmlUpdater } from '@/contexts/editor-provider';
import { useConnectionOperations } from '@/hooks/editor/use-connection-operations';
import { useToast } from '@/hooks/use-toast';
import type { AccidentalValue, Duration, ScoreEntity } from '@/types/score-types';
import { findEntityById } from '@/lib/editor/score-lookup';
import {
  addPitch,
  removePitch,
  toEditableEvent,
  type EditableEvent,
} from '@/lib/editor/editable-event';
import {
  type ConnectionDirection,
} from '@/lib/musicxml/connections';
import { parseXml } from '@/lib/musicxml/core';
import { getManualBeamDirectionAtEntity, updateManualBeamAtEntity, updateManualBeamDirectionAtEntity, type BeamDirection } from '@/lib/musicxml/automatic-beams';
import { cn } from '@/lib/utils';
import {
  buildSlurDetails,
  buildTieDetails,
  getEntitySourcePitch,
  type ConnectionDetail,
} from './event-inspector-connections';
import {
  ACCIDENTALS,
  DURATIONS,
  PITCH_NAMES,
  accidentalPitchSuffix,
  getEntitySummaryIcon,
  getEntitySummaryPitch,
  splitPitch,
  toEntityForSave,
  updatePitchPart,
} from './event-inspector-event-model';
import { ScoreInspectorPanel } from './event-score-inspector';

interface EventInspectorProps {
  scoreInspectorOpen: boolean;
  onCloseScoreInspector: () => void;
}

export function EventInspector({ scoreInspectorOpen, onCloseScoreInspector }: EventInspectorProps) {
  const { editingEntity, inspectorOpen } = useEditorState();

  if (!editingEntity || !inspectorOpen) {
    return scoreInspectorOpen ? <ScoreInspectorPanel onClose={onCloseScoreInspector} /> : null;
  }

  return (
    <EventInspectorPanel
      key={editingEntity.meta?.id ?? `${editingEntity.type}-${editingEntity.meta?.entityIndex ?? 'unknown'}`}
      editingEntity={editingEntity}
    />
  );
}

function EventInspectorPanel({ editingEntity }: { editingEntity: ScoreEntity }) {
  const t = useTranslations('editor');
  const common = useTranslations('common');
  const { scoreData, currentXml } = useScoreData();
  const { updateMusicXML } = useXmlUpdater();
  const { toast } = useToast();
  const { handleCloseModal, handleEditEntity, updateEntity } = useEntityEditor();
  const [event, setEvent] = useState<EditableEvent>(() => toEditableEvent(editingEntity));
  useEffect(() => {
    setEvent(toEditableEvent(editingEntity));
  }, [editingEntity]);
  const {
    handleDeleteTieConnection,
    handleDeleteSlurConnection,
    handleUpdateTieConnectionDirection,
    handleUpdateSlurConnectionDirection,
  } = useConnectionOperations({ scoreData, currentXml, updateMusicXML });
  const entityConnections = editingEntity.meta?.id
    ? scoreData?.connections?.noteConnections.get(editingEntity.meta.id)
    : undefined;
  const currentXmlDoc = useMemo(() => currentXml ? parseXml(currentXml) : null, [currentXml]);
  const [notePropertiesOpen, setNotePropertiesOpen] = useState(true);
  const [beamPropertiesOpen, setBeamPropertiesOpen] = useState(false);
  const beamDirection = useMemo(() => {
    const entityId = editingEntity.meta?.id;
    return currentXmlDoc && entityId ? getManualBeamDirectionAtEntity(currentXmlDoc, entityId) : null;
  }, [currentXmlDoc, editingEntity.meta?.id]);
  const tieDetails = useMemo(() => buildTieDetails(
    editingEntity.meta?.id,
    entityConnections?.ties ?? [],
    scoreData?.connections?.entityInfoMap,
    scoreData,
    currentXmlDoc
  ), [editingEntity.meta?.id, entityConnections?.ties, scoreData, currentXmlDoc]);
  const slurDetails = useMemo(() => buildSlurDetails(
    editingEntity.meta?.id,
    entityConnections?.slurs ?? [],
    scoreData?.connections?.entityInfoMap,
    scoreData,
    currentXmlDoc
  ), [editingEntity.meta?.id, entityConnections?.slurs, scoreData, currentXmlDoc]);

  const eventTypeLabel = useMemo(() => {
    if (event.pitches.length === 0) return t('eventTypeRest');
    if (event.pitches.length === 1) return t('eventTypeNote');
    return t('eventTypeChord');
  }, [event, t]);
  const summaryPitch = getEntitySummaryPitch(editingEntity, t('eventTypeRest'), t('emptyVoice'));
  const summaryIcon = getEntitySummaryIcon(editingEntity);
  const summaryMeasure = (editingEntity.meta?.measureIndex ?? 0) + 1;
  const summaryVoice = editingEntity.meta?.xmlVoice ?? 1;

  const commitEvent = (nextEvent: EditableEvent) => {
    setEvent(nextEvent);
    updateEntity(toEntityForSave(editingEntity, nextEvent), { keepInspectorOpen: true });
  };

  const setPitch = (index: number, nextPitch: string) => {
    commitEvent({
      ...event,
      pitches: event.pitches.map((pitch, i) => (i === index ? nextPitch : pitch)),
    });
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
    const result = handleDeleteTieConnection(
      editingEntity,
      detail.partnerId,
      detail.sourceId,
      detail.partnerSourceId
    );
    toast({
      title: result.success ? common('operationSuccess') : common('operationFailed'),
      description: result.message,
      variant: result.success ? undefined : 'destructive',
    });
  };

  const deleteSlurConnection = (detail: ConnectionDetail) => {
    const result = handleDeleteSlurConnection(
      editingEntity,
      detail.partnerId,
      detail.sourceId,
      detail.partnerSourceId
    );
    toast({
      title: result.success ? common('operationSuccess') : common('operationFailed'),
      description: result.message,
      variant: result.success ? undefined : 'destructive',
    });
  };

  const updateTieConnectionDirection = (detail: ConnectionDetail, direction: ConnectionDirection) => {
    const result = handleUpdateTieConnectionDirection(
      editingEntity,
      detail.partnerId,
      direction,
      detail.sourceId,
      detail.partnerSourceId
    );
    if (!result.success) {
      toast({
        title: common('operationFailed'),
        description: result.message,
        variant: 'destructive',
      });
    }
  };

  const updateSlurConnectionDirection = (detail: ConnectionDetail, direction: ConnectionDirection) => {
    const result = handleUpdateSlurConnectionDirection(
      editingEntity,
      detail.partnerId,
      direction,
      detail.sourceId,
      detail.partnerSourceId
    );
    if (!result.success) {
      toast({
        title: common('operationFailed'),
        description: result.message,
        variant: 'destructive',
      });
    }
  };

  const openConnectionEndpoint = (entityId: string) => {
    const found = findEntityById(scoreData, entityId);
    if (!found) return;
    handleEditEntity(found.entity, {
      measureIndex: found.meta.measureIndex,
      staveIndex: found.meta.staveIndex,
      xmlVoice: found.meta.xmlVoice,
      entityIndex: found.meta.entityIndex,
    });
  };

  const updateBeam = (action: 'previous' | 'next' | 'break-left' | 'break-right') => {
    const entityId = editingEntity.meta?.id;
    if (!entityId) return;
    let changed = false;
    updateMusicXML((doc) => {
      changed = updateManualBeamAtEntity(doc, entityId, action);
    }, t('actions.updateBeam'));
    if (!changed) {
      toast({
        title: common('operationFailed'),
        description: t('beamActionUnavailable'),
        variant: 'destructive',
      });
    }
  };

  const updateBeamDirection = (direction: BeamDirection) => {
    const entityId = editingEntity.meta?.id;
    if (!entityId) return;
    updateMusicXML((doc) => {
      updateManualBeamDirectionAtEntity(doc, entityId, direction);
    }, t('actions.updateBeamDirection'));
  };

  return (
    <aside className="sticky top-24 h-[calc(100vh-8.5rem)] w-full shrink-0 xl:w-80">
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
                {t(event.dotted ? 'summaryDottedDuration' : 'summaryDuration', { duration: t(event.duration as never) })}
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
                          onClick={() => commitEvent(addPitch(event, 'C4'))}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>

                    {event.pitches.length === 0 ? (
                      <div className="rounded-lg border border-dashed bg-background p-3 text-sm text-muted-foreground">
                        {t('noPitchesRestHint')}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {event.pitches.map((pitch, index) => {
                          const parsed = splitPitch(pitch);

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
                                        variant={event.accidentals[index] === accidental.value ? 'default' : 'outline'}
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
                                    value={event.fingerings[index] ?? 'none'}
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
                                  onClick={() => commitEvent(removePitch(event, index))}
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
                      <Select value={event.duration} onValueChange={(value) => commitEvent({ ...event, duration: value as Duration })}>
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
                          checked={event.dotted}
                          onCheckedChange={(checked) => commitEvent({ ...event, dotted: checked === true })}
                        />
                        <Label htmlFor="event-dotted" className="font-normal">{common('dotted')}</Label>
                      </div>
                    </div>
                  </section>

                  {event.pitches.length > 0 && (
                    <section className="space-y-2">
                      <Label>{t('stemDirectionLabel')}</Label>
                      <DirectionRadioGroup
                        value={event.stemDirection}
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

              {event.pitches.length > 0 && (
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

              {event.pitches.length > 0 && (
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
  onOpenEndpoint: (entityId: string) => void;
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
                        onClick={() => onOpenEndpoint(detail.currentId)}
                      >
                        {getEntitySourcePitch(scoreData, detail.currentId, detail.sourceId, detail.current, fallbackText)}
                      </button>
                      <span className="mx-1.5 text-muted-foreground">→</span>
                      <button
                        type="button"
                        className="rounded-sm text-left hover:text-primary hover:underline"
                        onClick={() => onOpenEndpoint(detail.partnerId)}
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

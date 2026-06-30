'use client';

import { ArrowDown, ArrowUp, ChevronRight, Minus, Plus, Trash2, Unlink, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useEditorState, useEntityEditor, useMetadataEditor, useScoreData, useXmlUpdater } from '@/contexts/editor-provider';
import { useConnectionOperations } from '@/hooks/editor/use-connection-operations';
import { useToast } from '@/hooks/use-toast';
import type { Blank, Duration, EntityInfo, ScoreEntity, SlurConnection, TieConnection } from '@/types/score-types';
import { findEntityById, findEntityMetaById } from '@/lib/editor/score-lookup';
import {
  addPitch,
  removePitch,
  toEditableEvent,
  toScoreEntity,
  type EditableEvent,
} from '@/lib/editor/editable-event';
import {
  getSlurConnectionDirectionFromXML,
  getTieConnectionDirectionFromXML,
  type ConnectionDirection,
} from '@/lib/musicxml/connections';
import { parseXml } from '@/lib/musicxml/core';
import { cn } from '@/lib/utils';

const PITCH_NAMES = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B'];
const DURATIONS: Duration[] = [
  'durationWhole',
  'durationHalf',
  'durationQuarter',
  'durationEighth',
  'duration16th',
  'duration32nd',
];

function splitPitch(pitch: string) {
  const match = pitch.match(/^([A-Ga-g][#b]?)(\d)$/);
  return {
    name: match?.[1] ?? 'C',
    octave: match?.[2] ?? '4',
  };
}

function updatePitchPart(pitch: string, part: 'name' | 'octave', value: string) {
  const parsed = splitPitch(pitch);
  return part === 'name' ? `${value}${parsed.octave}` : `${parsed.name}${value}`;
}

function toEntityForSave(original: ScoreEntity, event: EditableEvent): ScoreEntity {
  if (original.type === 'blank' && event.pitches.length === 0) {
    return {
      ...(original as Blank),
      duration: event.duration,
      dotted: event.dotted,
    };
  }

  return toScoreEntity(event, original.meta);
}

type ConnectionDetail = {
  id: string;
  type: 'tie' | 'slur';
  currentId: string;
  current: EntityInfo | null;
  partner: EntityInfo | null;
  partnerId: string;
  sourceId?: string;
  partnerSourceId?: string;
  direction: ConnectionDirection;
};

function getEntitySourcePitch(
  scoreData: ReturnType<typeof useScoreData>['scoreData'],
  entityId: string,
  sourceId: string | undefined,
  info: EntityInfo | null,
  fallback: string
) {
  const found = findEntityById(scoreData, entityId);
  const entity = found?.entity;
  if (entity?.type === 'chord' && sourceId) {
    const index = entity.meta?.sourceIds?.indexOf(sourceId) ?? -1;
    if (index >= 0 && entity.pitches[index]) return entity.pitches[index];
  }
  if (entity?.type === 'note') return entity.pitch;
  if (entity?.type === 'rest') return fallback;
  if (entity?.type === 'chord') return entity.pitches.join('+');
  if (!info) return fallback;
  return info.pitch;
}

function buildTieDetails(
  entityId: string | undefined,
  ties: TieConnection[],
  entityInfoMap: Map<string, EntityInfo> | undefined,
  scoreData: ReturnType<typeof useScoreData>['scoreData'],
  xmlDoc: XMLDocument | null
): ConnectionDetail[] {
  if (!entityId) return [];
  return ties.map((tie, index) => ({
    id: `tie-${entityId}-${tie.partnerId}-${tie.type}-${index}`,
    type: 'tie',
    currentId: entityId,
    current: entityInfoMap?.get(entityId) ?? null,
    partner: entityInfoMap?.get(tie.partnerId) ?? null,
    partnerId: tie.partnerId,
    sourceId: tie.sourceId,
    partnerSourceId: tie.partnerSourceId,
    direction: (() => {
      const entityMeta = findEntityMetaById(scoreData, entityId);
      const partnerMeta = findEntityMetaById(scoreData, tie.partnerId);
      return xmlDoc && entityMeta && partnerMeta
        ? getTieConnectionDirectionFromXML(xmlDoc, entityMeta, partnerMeta, {
          startSourceId: tie.sourceId,
          endSourceId: tie.partnerSourceId,
        })
        : 'auto';
    })(),
  }));
}

function buildSlurDetails(
  entityId: string | undefined,
  slurs: SlurConnection[],
  entityInfoMap: Map<string, EntityInfo> | undefined,
  scoreData: ReturnType<typeof useScoreData>['scoreData'],
  xmlDoc: XMLDocument | null
): ConnectionDetail[] {
  if (!entityId) return [];
  return slurs.map((slur, index) => {
    const partnerId = slur.partnerIds.find((id) => id !== entityId) ?? slur.partnerIds[0] ?? '';
    const entityMeta = findEntityMetaById(scoreData, entityId);
    const partnerMeta = findEntityMetaById(scoreData, partnerId);
    return {
      id: `${slur.slurId}-${entityId}-${partnerId}-${index}`,
      type: 'slur' as const,
      currentId: entityId,
      current: entityInfoMap?.get(entityId) ?? null,
      partner: entityInfoMap?.get(partnerId) ?? null,
      partnerId,
      sourceId: slur.sourceId,
      partnerSourceId: slur.partnerSourceIds?.find((id) => id !== slur.sourceId) ?? slur.partnerSourceIds?.[0],
      direction: xmlDoc && entityMeta && partnerMeta
        ? getSlurConnectionDirectionFromXML(xmlDoc, entityMeta, partnerMeta, {
          startSourceId: slur.sourceId,
          endSourceId: slur.partnerSourceIds?.find((id) => id !== slur.sourceId) ?? slur.partnerSourceIds?.[0],
        })
        : 'auto',
    };
  }).filter((detail) => detail.partnerId);
}

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

function ScoreInspectorPanel({ onClose }: { onClose: () => void }) {
  const t = useTranslations('editor');
  const results = useTranslations('results');
  const { scoreData } = useScoreData();
  const {
    updateKeySignature,
    updateTimeSignature,
    updateTempo,
    updateScoreMainTitle,
    updateScoreSubtitle,
    updateScoreCopyright,
    updateScoreComposer,
    updateScoreLyricist,
  } = useMetadataEditor();

  return (
    <aside className="sticky top-24 hidden h-[calc(100vh-8.5rem)] w-80 shrink-0 xl:block">
      <div className="flex h-full flex-col overflow-hidden rounded-2xl border bg-white/90 shadow-lg backdrop-blur-sm">
        <div className="flex items-start justify-between gap-3 border-b p-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">{results('scoreInfo')}</h2>
            <p className="text-xs text-muted-foreground">{t('noEventSelected')}</p>
          </div>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-5 p-4">
            <section className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="score-main-title">{t('mainTitleLabel')}</Label>
                <Input
                  key={`score-main-title-${scoreData?.mainTitle || ''}`}
                  id="score-main-title"
                  defaultValue={scoreData?.mainTitle || ''}
                  onBlur={(event) => updateScoreMainTitle(event.currentTarget.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="score-subtitle">{t('subtitleLabel')}</Label>
                <Input
                  key={`score-subtitle-${scoreData?.subtitle || ''}`}
                  id="score-subtitle"
                  defaultValue={scoreData?.subtitle || ''}
                  onBlur={(event) => updateScoreSubtitle(event.currentTarget.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="score-composer">{t('composerLabel')}</Label>
                <Input
                  key={`score-composer-${scoreData?.composer || ''}`}
                  id="score-composer"
                  defaultValue={scoreData?.composer || ''}
                  onBlur={(event) => updateScoreComposer(event.currentTarget.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="score-lyricist">{t('lyricistLabel')}</Label>
                <Input
                  key={`score-lyricist-${scoreData?.lyricist || ''}`}
                  id="score-lyricist"
                  defaultValue={scoreData?.lyricist || ''}
                  onBlur={(event) => updateScoreLyricist(event.currentTarget.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="score-copyright">{t('copyrightLabel')}</Label>
                <Textarea
                  key={`score-copyright-${scoreData?.copyright || ''}`}
                  id="score-copyright"
                  defaultValue={scoreData?.copyright || ''}
                  rows={4}
                  onBlur={(event) => updateScoreCopyright(event.currentTarget.value)}
                />
              </div>
            </section>

            <Separator />

            <section className="space-y-3">
              <div className="space-y-2">
                <Label>{t('timeSignatureLabel')}</Label>
                <Select value={scoreData?.timeSignature || '4/4'} onValueChange={updateTimeSignature}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="4/4">4/4</SelectItem>
                    <SelectItem value="3/4">3/4</SelectItem>
                    <SelectItem value="2/4">2/4</SelectItem>
                    <SelectItem value="2/2">2/2</SelectItem>
                    <SelectItem value="6/8">6/8</SelectItem>
                    <SelectItem value="9/8">9/8</SelectItem>
                    <SelectItem value="12/8">12/8</SelectItem>
                    <SelectItem value="3/8">3/8</SelectItem>
                    <SelectItem value="5/4">5/4</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>{t('keySignatureLabel')}</Label>
                <Select value={scoreData?.keySignature || '0'} onValueChange={updateKeySignature}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="-7">Cb (7b)</SelectItem>
                    <SelectItem value="-6">Gb (6b)</SelectItem>
                    <SelectItem value="-5">Db (5b)</SelectItem>
                    <SelectItem value="-4">Ab (4b)</SelectItem>
                    <SelectItem value="-3">Eb (3b)</SelectItem>
                    <SelectItem value="-2">Bb (2b)</SelectItem>
                    <SelectItem value="-1">F (1b)</SelectItem>
                    <SelectItem value="0">C</SelectItem>
                    <SelectItem value="1">G (1#)</SelectItem>
                    <SelectItem value="2">D (2#)</SelectItem>
                    <SelectItem value="3">A (3#)</SelectItem>
                    <SelectItem value="4">E (4#)</SelectItem>
                    <SelectItem value="5">B (5#)</SelectItem>
                    <SelectItem value="6">F# (6#)</SelectItem>
                    <SelectItem value="7">C# (7#)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="score-tempo">{t('tempoLabel')}</Label>
                <Input
                  key={`score-tempo-${scoreData?.tempo || ''}`}
                  id="score-tempo"
                  type="number"
                  min={1}
                  defaultValue={scoreData?.tempo || ''}
                  onBlur={(event) => updateTempo(event.currentTarget.value)}
                />
              </div>
            </section>
          </div>
        </ScrollArea>
      </div>
    </aside>
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

  return (
    <aside className="sticky top-24 h-[calc(100vh-8.5rem)] w-full shrink-0 xl:w-80">
      <div className="flex h-full flex-col overflow-hidden rounded-2xl border bg-white/90 shadow-lg backdrop-blur-sm">
        <div className="flex items-center justify-between border-b p-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">{t('eventInspector')}</h2>
            <p className="text-xs text-muted-foreground">{eventTypeLabel}</p>
          </div>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={handleCloseModal}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="p-4">
            <div className="overflow-hidden rounded-lg border">
              <Collapsible
                open={notePropertiesOpen}
                onOpenChange={setNotePropertiesOpen}
                className="border-b last:border-b-0"
              >
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-secondary/50"
                  >
                    <span className="text-sm font-semibold">{t('noteProperties')}</span>
                    <ChevronRight className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', notePropertiesOpen && 'rotate-90')} />
                  </button>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <div className="space-y-5 border-t bg-secondary/20 p-3">
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
                            <div key={`${pitch}-${index}`} className="rounded-lg bg-background p-3 shadow-sm">
                              <div className="grid grid-cols-[1fr_4.5rem_4.5rem_2rem] items-end gap-2">
                                <div className="space-y-1">
                                  <Label className="text-xs">{t('pitchLabel')}</Label>
                                  <Select
                                    value={parsed.name}
                                    onValueChange={(value) => setPitch(index, updatePitchPart(pitch, 'name', value))}
                                  >
                                    <SelectTrigger className="h-9">
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

                                <div className="space-y-1">
                                  <Label className="text-xs">{t('fingeringLabel')}</Label>
                                  <Select
                                    value={event.fingerings[index] ?? 'none'}
                                    onValueChange={(value) => setFingering(index, value)}
                                  >
                                    <SelectTrigger className="h-9">
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
                                  className="h-9 w-9 text-muted-foreground hover:text-destructive"
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

                  <section className="grid grid-cols-2 gap-3">
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
                          { value: 'none', ariaLabel: 'none', icon: Minus },
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
          className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-secondary/50"
        >
          <span className="min-w-0 text-sm font-semibold">{title}</span>
          <ChevronRight className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="space-y-2 border-t bg-secondary/20 p-3">
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
                          { value: 'auto', ariaLabel: 'auto', icon: Minus },
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
    icon: typeof Minus;
  }>;
  onValueChange: (value: TValue) => void;
}) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(nextValue) => onValueChange(nextValue as TValue)}
      className="grid grid-cols-3 gap-2"
    >
      {options.map(({ value: optionValue, ariaLabel, icon: Icon }) => (
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
          <Icon className="h-4 w-4" />
        </Label>
      ))}
    </RadioGroup>
  );
}

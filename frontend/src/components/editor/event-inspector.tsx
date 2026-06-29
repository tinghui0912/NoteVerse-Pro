'use client';

import { Plus, Trash2, Unlink, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import type { Blank, Duration, ScoreEntity } from '@/types/score-types';
import {
  addPitch,
  removePitch,
  toEditableEvent,
  toScoreEntity,
  type EditableEvent,
} from '@/lib/editor/editable-event';
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
  const { handleCloseModal, updateEntity } = useEntityEditor();
  const [event, setEvent] = useState<EditableEvent>(() => toEditableEvent(editingEntity));
  const {
    handleDeleteTie,
    handleDeleteSlur,
  } = useConnectionOperations({ scoreData, currentXml, updateMusicXML });
  const entityConnections = editingEntity.meta?.id
    ? scoreData?.connections?.noteConnections.get(editingEntity.meta.id)
    : undefined;
  const tieCount = entityConnections?.ties.length ?? 0;
  const slurCount = entityConnections?.slurs.length ?? 0;

  const eventTypeLabel = useMemo(() => {
    if (event.pitches.length === 0) return t('cardTypeRest');
    if (event.pitches.length === 1) return t('cardTypeNote');
    return t('cardTypeChord');
  }, [event, t]);

  const setPitch = (index: number, nextPitch: string) => {
    setEvent((current) => current
      ? { ...current, pitches: current.pitches.map((pitch, i) => (i === index ? nextPitch : pitch)) }
      : current);
  };

  const setFingering = (index: number, value: string) => {
    setEvent((current) => current
      ? { ...current, fingerings: current.fingerings.map((fingering, i) => (i === index ? value : fingering)) }
      : current);
  };

  const handleSave = () => {
    updateEntity(toEntityForSave(editingEntity, event));
  };

  const deleteTie = () => {
    const result = handleDeleteTie(editingEntity);
    toast({
      title: result.success ? common('operationSuccess') : common('operationFailed'),
      description: result.message,
      variant: result.success ? undefined : 'destructive',
    });
  };

  const deleteSlur = () => {
    const result = handleDeleteSlur(editingEntity);
    toast({
      title: result.success ? common('operationSuccess') : common('operationFailed'),
      description: result.message,
      variant: result.success ? undefined : 'destructive',
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
          <div className="space-y-5 p-4">
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>{t('pitchesLabel')}</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => setEvent(addPitch(event, 'C4'))}
                >
                  <Plus className="mr-1.5 h-4 w-4" />
                  {t('addPitch')}
                </Button>
              </div>

              {event.pitches.length === 0 ? (
                <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                  {t('noPitchesRestHint')}
                </div>
              ) : (
                <div className="space-y-2">
                  {event.pitches.map((pitch, index) => {
                    const parsed = splitPitch(pitch);

                    return (
                      <div key={`${pitch}-${index}`} className="rounded-lg bg-secondary/50 p-3">
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
                            onClick={() => setEvent(removePitch(event, index))}
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
                <Select value={event.duration} onValueChange={(value) => setEvent({ ...event, duration: value as Duration })}>
                  <SelectTrigger>
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
                <div className="flex h-10 items-center gap-2 rounded-md border px-3">
                  <Checkbox
                    id="event-dotted"
                    checked={event.dotted}
                    onCheckedChange={(checked) => setEvent({ ...event, dotted: checked === true })}
                  />
                  <Label htmlFor="event-dotted" className="font-normal">{common('dotted')}</Label>
                </div>
              </div>
            </section>

            {event.pitches.length > 0 && (
              <section className="space-y-2">
                <Label>{t('stemDirectionLabel')}</Label>
                <Select
                  value={event.stemDirection}
                  onValueChange={(value) => setEvent({ ...event, stemDirection: value as EditableEvent['stemDirection'] })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('stemDirectionNone')}</SelectItem>
                    <SelectItem value="up">{t('stemDirectionUp')}</SelectItem>
                    <SelectItem value="down">{t('stemDirectionDown')}</SelectItem>
                  </SelectContent>
                </Select>
              </section>
            )}

            {event.pitches.length > 0 && (
              <section className="space-y-3">
                <Label>{t('connectionsLabel')}</Label>
                <div className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{common('tie')}</p>
                      <p className="text-xs text-muted-foreground">{t('connectionCount', { count: tieCount })}</p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={tieCount === 0}
                      onClick={deleteTie}
                    >
                      <Unlink className="mr-1.5 h-4 w-4" />
                      {common('delete')}
                    </Button>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{common('slur')}</p>
                      <p className="text-xs text-muted-foreground">{t('connectionCount', { count: slurCount })}</p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={slurCount === 0}
                      onClick={deleteSlur}
                    >
                      <Unlink className="mr-1.5 h-4 w-4" />
                      {common('delete')}
                    </Button>
                  </div>
                </div>
              </section>
            )}
          </div>
        </ScrollArea>

        <div className="flex justify-end gap-2 border-t p-4">
          <Button type="button" variant="outline" onClick={handleCloseModal}>
            {common('cancel')}
          </Button>
          <Button type="button" className={cn('bg-orange-500 hover:bg-orange-600')} onClick={handleSave}>
            {t('saveChanges')}
          </Button>
        </div>
      </div>
    </aside>
  );
}

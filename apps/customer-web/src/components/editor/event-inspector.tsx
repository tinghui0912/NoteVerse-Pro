'use client';

import { ArrowDown, ArrowLeft, ArrowLeftToLine, ArrowRight, ArrowRightToLine, ArrowUp, Check, ChevronRight, Minus, Plus, Scissors, Trash2, Unlink, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import type { AccidentalValue, Blank, Duration, ScoreEntity } from '@/types/score-types';
import { findEntityById } from '@/lib/editor/score-lookup';
import {
  addPitch,
  removePitch,
  toEditableEvent,
  toScoreEntity,
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

const PITCH_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const ACCIDENTALS: Array<{ value: AccidentalValue; symbol: string }> = [
  { value: 'flat-flat', symbol: '𝄫' },
  { value: 'flat', symbol: '♭' },
  { value: 'natural', symbol: '♮' },
  { value: 'sharp', symbol: '♯' },
];
const DURATIONS: Duration[] = [
  'durationWhole',
  'durationHalf',
  'durationQuarter',
  'durationEighth',
  'duration16th',
  'duration32nd',
];

const TIME_SIGNATURES = ['2/4', '3/4', '4/4', '5/4', '6/4', '3/8', '4/8', '5/8', '6/8', '7/8', '9/8', '12/8', '2/2', '3/2'];
const BEAT_TYPES = ['1', '2', '4', '8', '16', '32'];
const TEMPO_UNITS = [
  { value: '16th', symbol: '♬' },
  { value: 'eighth', symbol: '♪' },
  { value: 'quarter', symbol: '♩' },
  { value: 'half', symbol: '𝅗𝅥' },
  { value: 'whole', symbol: '𝅝' },
];
const KEY_SIGNATURES = [
  { fifths: '0', major: 'C', minor: 'A', accidentals: '' },
  { fifths: '1', major: 'G', minor: 'E', accidentals: '♯' },
  { fifths: '2', major: 'D', minor: 'B', accidentals: '♯♯' },
  { fifths: '3', major: 'A', minor: 'F♯', accidentals: '♯♯♯' },
  { fifths: '4', major: 'E', minor: 'C♯', accidentals: '♯♯♯♯' },
  { fifths: '5', major: 'B', minor: 'G♯', accidentals: '♯♯♯♯♯' },
  { fifths: '6', major: 'F♯', minor: 'D♯', accidentals: '♯♯♯♯♯♯' },
  { fifths: '7', major: 'C♯', minor: 'A♯', accidentals: '♯♯♯♯♯♯♯' },
  { fifths: '-1', major: 'F', minor: 'D', accidentals: '♭' },
  { fifths: '-2', major: 'B♭', minor: 'G', accidentals: '♭♭' },
  { fifths: '-3', major: 'E♭', minor: 'C', accidentals: '♭♭♭' },
  { fifths: '-4', major: 'A♭', minor: 'F', accidentals: '♭♭♭♭' },
  { fifths: '-5', major: 'D♭', minor: 'B♭', accidentals: '♭♭♭♭♭' },
  { fifths: '-6', major: 'G♭', minor: 'E♭', accidentals: '♭♭♭♭♭♭' },
  { fifths: '-7', major: 'C♭', minor: 'A♭', accidentals: '♭♭♭♭♭♭♭' },
];
const SMUFL = {
  gClef: '\uE050',
  sharp: '\uE262',
  flat: '\uE260',
};
const STAFF_LINE_Y = [14, 20, 26, 32, 38];
const SHARP_STAFF_Y = [14, 26, 11, 20, 32, 17, 29];
const FLAT_STAFF_Y = [29, 17, 32, 20, 35, 23, 38];

function splitPitch(pitch: string) {
  const match = pitch.match(/^([A-Ga-g])([#b]{0,2})(\d)$/);
  return {
    name: match?.[1] ?? 'C',
    accidental: match?.[2] ?? '',
    octave: match?.[3] ?? '4',
  };
}

function updatePitchPart(pitch: string, part: 'name' | 'octave', value: string) {
  const parsed = splitPitch(pitch);
  return part === 'name'
    ? `${value}${parsed.accidental}${parsed.octave}`
    : `${parsed.name}${parsed.accidental}${value}`;
}

function accidentalPitchSuffix(accidental: AccidentalValue) {
  if (accidental === 'flat-flat') return 'bb';
  if (accidental === 'flat') return 'b';
  if (accidental === 'sharp') return '#';
  return '';
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

function getEntitySummaryPitch(entity: ScoreEntity, restLabel: string, blankLabel: string): string {
  if (entity.type === 'note') return entity.pitch;
  if (entity.type === 'chord') return entity.pitches.join(' · ');
  if (entity.type === 'rest') return restLabel;
  return blankLabel;
}

function getEntitySummaryIcon(entity: ScoreEntity): string {
  if (entity.type === 'rest') return '𝄽';
  if (entity.type === 'chord') return '♬';
  return '♩';
}

function parseTimeSignatureParts(value: string | undefined) {
  const [beatsText, beatTypeText] = (value || '4/4').split('/');
  const beats = Number.parseInt(beatsText || '4', 10);
  const beatType = Number.parseInt(beatTypeText || '4', 10);
  return {
    beats: Number.isFinite(beats) && beats > 0 ? beats : 4,
    beatType: Number.isFinite(beatType) && beatType > 0 ? beatType : 4,
  };
}

function StaffPreview({ fifths }: { fifths: string }) {
  const fifthValue = Number.parseInt(fifths, 10);
  const accidentalCount = Math.abs(fifthValue);
  const accidentalSymbol = fifthValue > 0 ? SMUFL.sharp : SMUFL.flat;
  const yPositions = fifthValue > 0 ? SHARP_STAFF_Y : FLAT_STAFF_Y;

  return (
    <svg className="h-12 w-full overflow-visible" viewBox="0 0 124 52" aria-hidden="true">
      {STAFF_LINE_Y.map((y) => (
        <line key={y} x1="4" x2="120" y1={y} y2={y} stroke="currentColor" strokeOpacity="0.55" strokeWidth="0.75" />
      ))}
      <text
        x="8"
        y="31"
        fill="currentColor"
        fontFamily="Leland, serif"
        fontSize="26"
        dominantBaseline="middle"
      >
        {SMUFL.gClef}
      </text>
      {Array.from({ length: accidentalCount }).map((_, index) => (
        <text
          key={index}
          x={38 + index * 8}
          y={yPositions[index] ?? 26}
          fill="currentColor"
          fontFamily="Leland, serif"
          fontSize={fifthValue > 0 ? 15 : 17}
          dominantBaseline="middle"
        >
          {accidentalSymbol}
        </text>
      ))}
    </svg>
  );
}

function TimeSignaturePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { beats, beatType } = parseTimeSignatureParts(value);
  const commit = (nextBeats: number, nextBeatType: number) => {
    onChange(`${Math.max(1, nextBeats)}/${nextBeatType}`);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-between font-mono text-base">
          {value}
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <div className="grid grid-cols-3 gap-2">
          {TIME_SIGNATURES.map((signature) => (
            <button
              key={signature}
              type="button"
              className={cn(
                'rounded-md border p-3 text-center font-mono text-lg hover:bg-accent',
                value === signature && 'border-primary bg-primary/10 text-primary'
              )}
              onClick={() => onChange(signature)}
            >
              {signature}
            </button>
          ))}
        </div>
        <Separator className="my-3" />
        <div className="flex items-center justify-center gap-3">
          <Input
            className="h-10 w-20 text-center font-mono"
            min={1}
            type="number"
            value={beats}
            onChange={(event) => commit(Number.parseInt(event.currentTarget.value || '1', 10), beatType)}
          />
          <span className="text-lg text-muted-foreground">/</span>
          <Select value={String(beatType)} onValueChange={(next) => commit(beats, Number.parseInt(next, 10))}>
            <SelectTrigger className="h-10 w-24 font-mono">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BEAT_TYPES.map((type) => (
                <SelectItem key={type} value={type}>{type}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function KeySignaturePicker({
  value,
  onChange,
  majorLabel,
  minorLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  majorLabel: string;
  minorLabel: string;
}) {
  const selected = KEY_SIGNATURES.find((key) => key.fifths === value) ?? KEY_SIGNATURES[0];

  const renderGrid = (mode: 'major' | 'minor') => (
    <div className="grid grid-cols-4 gap-2">
      {KEY_SIGNATURES.map((key) => {
        const label = mode === 'major' ? key.major : key.minor;
        const isSelected = key.fifths === value;
        return (
          <button
            key={`${mode}-${key.fifths}`}
            type="button"
            className={cn(
              'rounded-md border p-1.5 text-left hover:bg-accent',
              isSelected && 'border-primary bg-primary/10 text-primary'
            )}
            onClick={() => onChange(key.fifths)}
          >
            <StaffPreview fifths={key.fifths} />
            <div className="mt-1 flex items-center justify-between text-xs">
              <span>{label}</span>
              {isSelected ? <Check className="h-3.5 w-3.5" /> : null}
            </div>
          </button>
        );
      })}
    </div>
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="h-auto w-full justify-between py-2">
          <span className="flex min-w-0 items-center gap-2">
            <span className="font-medium">{selected.major}</span>
            <span className="truncate text-xs text-muted-foreground">{selected.accidentals || 'C'}</span>
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[26rem] w-[38rem] max-w-[calc(100vw-2rem)] overflow-y-auto p-3">
        <Tabs defaultValue="major">
          <TabsList className="mx-auto mb-3 grid w-44 grid-cols-2">
            <TabsTrigger value="major">{majorLabel}</TabsTrigger>
            <TabsTrigger value="minor">{minorLabel}</TabsTrigger>
          </TabsList>
          <TabsContent value="major">{renderGrid('major')}</TabsContent>
          <TabsContent value="minor">{renderGrid('minor')}</TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}

function TempoPicker({
  value,
  onChange,
  showTempoMarkLabel,
  initialShowMark,
}: {
  value: string;
  onChange: (tempo: string, options?: { beatUnit?: string; showMark?: boolean }) => void;
  showTempoMarkLabel: string;
  initialShowMark: boolean;
}) {
  const [beatUnit, setBeatUnit] = useState('quarter');
  const [showMark, setShowMark] = useState(initialShowMark);
  const tempo = Number.parseInt(value || '120', 10);
  const safeTempo = Number.isFinite(tempo) && tempo > 0 ? tempo : 120;

  useEffect(() => {
    setShowMark(initialShowMark);
  }, [initialShowMark]);

  const commit = (nextTempo = safeTempo, nextBeatUnit = beatUnit, nextShowMark = showMark) => {
    onChange(String(Math.max(1, nextTempo)), { beatUnit: nextBeatUnit, showMark: nextShowMark });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-between">
          <span className="font-mono">♩ = {safeTempo}</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <div className="mb-3 flex items-center gap-2">
          <Switch
            checked={showMark}
            onCheckedChange={(checked) => {
              setShowMark(checked);
              commit(safeTempo, beatUnit, checked);
            }}
          />
          <span className="text-sm text-muted-foreground">{showTempoMarkLabel}</span>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {TEMPO_UNITS.map((unit) => (
            <button
              key={unit.value}
              type="button"
              className={cn(
                'rounded-md border p-3 text-2xl leading-none hover:bg-accent',
                beatUnit === unit.value && 'border-primary bg-primary/10 text-primary'
              )}
              onClick={() => {
                setBeatUnit(unit.value);
                commit(safeTempo, unit.value, showMark);
              }}
            >
              {unit.symbol}
            </button>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-center gap-3">
          <span className="text-lg">=</span>
          <Input
            className="h-10 w-28 text-center font-mono"
            min={1}
            type="number"
            value={safeTempo}
            onChange={(event) => commit(Number.parseInt(event.currentTarget.value || '1', 10), beatUnit, showMark)}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
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
  const scoreText = useTranslations('score');
  const { currentXml, scoreData } = useScoreData();
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
  const hasTempoMark = useMemo(() => {
    if (!currentXml) return false;
    return Boolean(parseXml(currentXml).querySelector('direction metronome'));
  }, [currentXml]);

  return (
    <aside className="sticky top-24 hidden h-[calc(100vh-8.5rem)] w-80 shrink-0 xl:block">
      <div className="flex h-full flex-col overflow-hidden rounded-2xl border bg-white/90 shadow-lg backdrop-blur-sm">
        <div className="flex items-start justify-between gap-3 border-b p-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">{scoreText('scoreInfo')}</h2>
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
                <Label>{t('keySignatureLabel')}</Label>
                <KeySignaturePicker
                  value={scoreData?.keySignature || '0'}
                  onChange={updateKeySignature}
                  majorLabel={t('majorKey')}
                  minorLabel={t('minorKey')}
                />
              </div>

              <div className="space-y-2">
                <Label>{t('timeSignatureLabel')}</Label>
                <TimeSignaturePicker value={scoreData?.timeSignature || '4/4'} onChange={updateTimeSignature} />
              </div>

              <div className="space-y-2">
                <Label>{t('tempoLabel')}</Label>
                <TempoPicker
                  value={scoreData?.tempo || '120'}
                  onChange={updateTempo}
                  showTempoMarkLabel={t('showTempoMark')}
                  initialShowMark={hasTempoMark}
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

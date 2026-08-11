'use client';

import { Check, ChevronRight, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
import { useMetadataEditor, useScoreData } from '@/contexts/editor-provider';
import { parseXml } from '@/lib/musicxml/core';
import { cn } from '@/lib/utils';

const TIME_SIGNATURES = ['2/4', '3/4', '4/4', '5/4', '6/4', '3/8', '4/8', '5/8', '6/8', '7/8', '9/8', '12/8', '2/2', '3/2'];
const BEAT_TYPES = ['1', '2', '4', '8', '16', '32'];
const TEMPO_UNITS = [
  { value: '16th', symbol: '??' },
  { value: 'eighth', symbol: '?' },
  { value: 'quarter', symbol: '?' },
  { value: 'half', symbol: '??' },
  { value: 'whole', symbol: '??' },
];
const KEY_SIGNATURES = [
  { fifths: '0', major: 'C', minor: 'A', accidentals: '' },
  { fifths: '1', major: 'G', minor: 'E', accidentals: '?' },
  { fifths: '2', major: 'D', minor: 'B', accidentals: '??' },
  { fifths: '3', major: 'A', minor: 'F#', accidentals: '???' },
  { fifths: '4', major: 'E', minor: 'C#', accidentals: '????' },
  { fifths: '5', major: 'B', minor: 'G#', accidentals: '?????' },
  { fifths: '6', major: 'F#', minor: 'D#', accidentals: '??????' },
  { fifths: '7', major: 'C#', minor: 'A#', accidentals: '???????' },
  { fifths: '-1', major: 'F', minor: 'D', accidentals: '?' },
  { fifths: '-2', major: 'Bb', minor: 'G', accidentals: '??' },
  { fifths: '-3', major: 'Eb', minor: 'C', accidentals: '???' },
  { fifths: '-4', major: 'Ab', minor: 'F', accidentals: '????' },
  { fifths: '-5', major: 'Db', minor: 'Bb', accidentals: '?????' },
  { fifths: '-6', major: 'Gb', minor: 'Eb', accidentals: '??????' },
  { fifths: '-7', major: 'Cb', minor: 'Ab', accidentals: '???????' },
];
const SMUFL = {
  gClef: '\uE050',
  sharp: '\uE262',
  flat: '\uE260',
};
const STAFF_LINE_Y = [14, 20, 26, 32, 38];
const SHARP_STAFF_Y = [14, 26, 11, 20, 32, 17, 29];
const FLAT_STAFF_Y = [29, 17, 32, 20, 35, 23, 38];

export function parseTimeSignatureParts(value: string | undefined) {
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
          <span className="font-mono">鈾?= {safeTempo}</span>
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

export function ScoreInspectorPanel({ onClose }: { onClose: () => void }) {
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


'use client';

import { useTranslations } from 'next-intl';

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, Trash2, X } from 'lucide-react';
import type { Chord, Duration } from '@/types/score-types';

export type ChordEditorResult = {
  type: 'chord';
  pitches: string[];
  duration: Duration;
  dotted: boolean;
  stemDirection?: string;
  fingerings?: string[];
};

export function ChordEditorModal({
  isOpen,
  onClose,
  onSave,
  chord,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSave?: (result: ChordEditorResult) => void;
  chord: Chord;
}) {
  const t = useTranslations('editor');
  const tCommon = useTranslations('common');

  // Form state
  const [pitches, setPitches] = useState<string[]>([]);
  const [fingerings, setFingerings] = useState<string[]>([]);
  const [duration, setDuration] = useState<Duration>(chord.duration || 'durationQuarter');
  const [dotted, setDotted] = useState(false);
  const [stemDirection, setStemDirection] = useState('auto');

  const [prevChord, setPrevChord] = useState(chord);
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);

  if (isOpen !== prevIsOpen || chord !== prevChord) {
    setPrevIsOpen(isOpen);
    setPrevChord(chord);

    if (isOpen) {
      const initPitches = chord.pitches || ['C4'];
      setPitches(initPitches);
      // 鍒濆鍖?fingerings锛屼笌 pitches 鏁伴噺瀵瑰簲
      const initFingerings = chord.fingerings || initPitches.map(() => 'auto');
      // 纭繚闀垮害鍖归厤
      setFingerings(initFingerings.length === initPitches.length
        ? initFingerings
        : initPitches.map((_, i) => initFingerings[i] || 'auto'));
      setDuration(chord.duration || 'durationQuarter');
      setDotted(chord.dotted || false);
      setStemDirection(chord.stemDirection || 'auto');
    }
  }

  const handleAddNote = () => {
    setPitches([...pitches, 'C4']);
    setFingerings([...fingerings, 'auto']);
  };

  const handleRemoveNote = (indexToRemove: number) => {
    if (pitches.length > 1) {
      setPitches(pitches.filter((_, index) => index !== indexToRemove));
      setFingerings(fingerings.filter((_, index) => index !== indexToRemove));
    }
  };

  const handlePitchChange = (index: number, part: 'pitch' | 'octave', value: string) => {
    const newPitches = [...pitches];
    const currentPitch = newPitches[index];
    if (part === 'pitch') {
      const octave = currentPitch.slice(-1);
      newPitches[index] = `${value}${octave}`;
    } else {
      const pitchName = currentPitch.slice(0, -1);
      newPitches[index] = `${pitchName}${value}`;
    }
    setPitches(newPitches);
  };

  const handleFingeringChange = (index: number, value: string) => {
    const newFingerings = [...fingerings];
    newFingerings[index] = value;
    setFingerings(newFingerings);
  };

  const handleSave = () => {
    const result: ChordEditorResult = {
      type: 'chord',
      pitches,
      duration,
      dotted,
      stemDirection,
      fingerings,
    };
    onSave?.(result);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('editChord')}</DialogTitle>
          <DialogClose className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogClose>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 py-4">
          {/* Chord-level settings */}
          <div className="col-span-1 space-y-4">
            <h3 className="text-lg font-semibold text-foreground">{t('chordSettings')}</h3>
            <div className="space-y-2">
              <Label htmlFor="chord-duration">{t('durationLabel')}</Label>
              <Select value={duration} onValueChange={(v) => setDuration(v as Duration)}>
                <SelectTrigger id="chord-duration">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="durationWhole">{t('durationWhole')}</SelectItem>
                  <SelectItem value="durationHalf">{t('durationHalf')}</SelectItem>
                  <SelectItem value="durationQuarter">{t('durationQuarter')}</SelectItem>
                  <SelectItem value="durationEighth">{t('durationEighth')}</SelectItem>
                  <SelectItem value="duration16th">{t('duration16th')}</SelectItem>
                  <SelectItem value="duration32nd">{t('duration32nd')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('isDottedTitle')}</Label>
              <div className="flex items-center space-x-2 h-10">
                <Checkbox
                  id="chord-dotted"
                  checked={dotted}
                  onCheckedChange={(checked) => setDotted(checked === true)}
                />
                <Label htmlFor="chord-dotted" className="font-normal">{t('isDottedLabel')}</Label>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="chord-stem-direction">{t('stemDirectionLabel')}</Label>
              <Select value={stemDirection} onValueChange={setStemDirection}>
                <SelectTrigger id="chord-stem-direction">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{t('stemDirectionAuto')}</SelectItem>
                  <SelectItem value="up">{t('stemDirectionUp')}</SelectItem>
                  <SelectItem value="down">{t('stemDirectionDown')}</SelectItem>
                  <SelectItem value="none">{t('stemDirectionNone')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Note-level settings */}
          <div className="col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">{t('notesInChord')}</h3>
              <Button variant="outline" size="sm" onClick={handleAddNote}>
                <Plus className="h-4 w-4 mr-2" />
                {tCommon('add')}
              </Button>
            </div>
            <ScrollArea className="h-64 border rounded-md">
              <div className="p-4 space-y-3">
                {pitches.map((pitch, index) => (
                  <div key={index} className="flex items-end gap-3 p-3 bg-secondary/50 rounded-lg">
                    <div className="grid grid-cols-3 gap-3 flex-1">
                      <div className="space-y-1">
                        <Label htmlFor={`note-pitch-${index}`} className="text-xs">{t('pitchLabel')}</Label>
                        <Select
                          value={pitch.slice(0, -1)}
                          onValueChange={(value) => handlePitchChange(index, 'pitch', value)}
                        >
                          <SelectTrigger id={`note-pitch-${index}`} className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="C">C</SelectItem>
                            <SelectItem value="C#">C#</SelectItem>
                            <SelectItem value="Db">Db</SelectItem>
                            <SelectItem value="D">D</SelectItem>
                            <SelectItem value="D#">D#</SelectItem>
                            <SelectItem value="Eb">Eb</SelectItem>
                            <SelectItem value="E">E</SelectItem>
                            <SelectItem value="F">F</SelectItem>
                            <SelectItem value="F#">F#</SelectItem>
                            <SelectItem value="Gb">Gb</SelectItem>
                            <SelectItem value="G">G</SelectItem>
                            <SelectItem value="G#">G#</SelectItem>
                            <SelectItem value="Ab">Ab</SelectItem>
                            <SelectItem value="A">A</SelectItem>
                            <SelectItem value="A#">A#</SelectItem>
                            <SelectItem value="Bb">Bb</SelectItem>
                            <SelectItem value="B">B</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`note-octave-${index}`} className="text-xs">{t('octaveLabel')}</Label>
                        <Input
                          id={`note-octave-${index}`}
                          type="number"
                          value={pitch.slice(-1)}
                          className="h-8 text-xs"
                          onChange={(e) => handlePitchChange(index, 'octave', e.target.value)}
                          min={0}
                          max={9}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`note-fingering-${index}`} className="text-xs">{t('fingeringLabel')}</Label>
                        <Select
                          value={fingerings[index] || 'auto'}
                          onValueChange={(value) => handleFingeringChange(index, value)}
                        >
                          <SelectTrigger id={`note-fingering-${index}`} className="h-8 text-xs">
                            <SelectValue placeholder={t('fingeringAuto')} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">{t('fingeringAuto')}</SelectItem>
                            <SelectItem value="1">1</SelectItem>
                            <SelectItem value="2">2</SelectItem>
                            <SelectItem value="3">3</SelectItem>
                            <SelectItem value="4">4</SelectItem>
                            <SelectItem value="5">5</SelectItem>
                            <SelectItem value="none">{t('fingeringNone')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemoveNote(index)}
                      disabled={pitches.length <= 1}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button onClick={handleSave}>{t('saveChanges')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { X, Music, AlignCenter } from 'lucide-react';
import type { Note, Rest, Blank, Duration } from '@/types/score-types';

export type NoteEditorResult = {
    type: 'note' | 'rest' | 'blank';
    pitch?: string;
    duration: Duration;
    dotted: boolean;
    stemDirection?: string;
    fingering?: string;
};

export function NoteEditorModal({
    isOpen,
    onClose,
    onSave,
    note,
}: {
    isOpen: boolean;
    onClose: () => void;
    onSave?: (result: NoteEditorResult) => void;
    note: Note | Rest | Blank;
}) {
    const t = useTranslations('editor');
  const tCommon = useTranslations('common');


    // Form state
    const [activeTab, setActiveTab] = useState<'note' | 'rest' | 'blank'>(note.type);
    const [pitch, setPitch] = useState('C');
    const [octave, setOctave] = useState('4');
    const [duration, setDuration] = useState<Duration>(note.duration || 'durationQuarter');
    const [dotted, setDotted] = useState(false);
    const [stemDirection, setStemDirection] = useState('auto');
    const [fingering, setFingering] = useState('auto');

    const [prevNote, setPrevNote] = useState(note);
    const [prevIsOpen, setPrevIsOpen] = useState(isOpen);

    if (note !== prevNote || isOpen !== prevIsOpen) {
        setPrevNote(note);
        setPrevIsOpen(isOpen);
        
        setActiveTab(note.type);
        setDuration(note.duration || 'durationQuarter');
        setDotted(note.dotted || false);

        if (note.type === 'note' && 'pitch' in note && note.pitch) {
            // Parse pitch like "C4" or "C#5"
            const pitchMatch = note.pitch.match(/^([A-Ga-g][#b]?)(\d)$/);
            if (pitchMatch) {
                setPitch(pitchMatch[1]);
                setOctave(pitchMatch[2]);
            } else {
                setPitch('C');
                setOctave('4');
            }
            // 从 note 对象读取 stemDirection 和 fingering
            setStemDirection(note.stemDirection || 'auto');
            setFingering(note.fingering || 'auto');
        } else {
            setPitch('C');
            setOctave('4');
            setStemDirection('auto');
            setFingering('auto');
        }
    }

    const handleSave = () => {
        const result: NoteEditorResult = {
            type: activeTab,
            duration,
            dotted,
        };

        if (activeTab === 'note') {
            result.pitch = `${pitch}${octave}`;
            result.stemDirection = stemDirection;
            result.fingering = fingering;
        }

        onSave?.(result);
        onClose();
    };

    const isRest = activeTab === 'rest';
    const isBlank = activeTab === 'blank';

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{isBlank ? t('editBlank') : t('editNote')}</DialogTitle>
                    <DialogClose className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
                        <X className="h-4 w-4" />
                        <span className="sr-only">Close</span>
                    </DialogClose>
                </DialogHeader>

                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'note' | 'rest' | 'blank')} className="w-full">
                    {!isBlank && (
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="note"><Music className="h-4 w-4 mr-2" />{t('cardTypeNote')}</TabsTrigger>
                            <TabsTrigger value="rest"><AlignCenter className="h-4 w-4 mr-2" />{t('cardTypeRest')}</TabsTrigger>
                        </TabsList>
                    )}
                    <div className="py-6 space-y-6">
                        {!isRest && !isBlank && (
                            <div className="grid grid-cols-2 gap-x-4 gap-y-6">
                                <div className="space-y-2">
                                    <Label htmlFor="pitch">{t('pitchLabel')}</Label>
                                    <Select value={pitch} onValueChange={setPitch}>
                                        <SelectTrigger id="pitch">
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
                                <div className="space-y-2">
                                    <Label htmlFor="octave">{t('octaveLabel')}</Label>
                                    <Input
                                        id="octave"
                                        type="number"
                                        value={octave}
                                        onChange={(e) => setOctave(e.target.value)}
                                        min={0}
                                        max={9}
                                    />
                                </div>
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="duration">{t('durationLabel')}</Label>
                                <Select value={duration} onValueChange={(v) => setDuration(v as Duration)}>
                                    <SelectTrigger id="duration">
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
                                        id="dotted"
                                        checked={dotted}
                                        onCheckedChange={(checked) => setDotted(checked === true)}
                                    />
                                    <Label htmlFor="dotted" className="font-normal">{t('isDottedLabel')}</Label>
                                </div>
                            </div>
                        </div>

                        {!isRest && !isBlank && (
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="stem-direction">{t('stemDirectionLabel')}</Label>
                                    <Select value={stemDirection} onValueChange={setStemDirection}>
                                        <SelectTrigger id="stem-direction">
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
                                <div className="space-y-2">
                                    <Label htmlFor="fingering">{t('fingeringLabel')}</Label>
                                    <Select value={fingering} onValueChange={setFingering}>
                                        <SelectTrigger id="fingering">
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
                        )}
                    </div>
                </Tabs>

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

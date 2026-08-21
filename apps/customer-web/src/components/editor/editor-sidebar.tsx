
'use client';

import { useTranslations } from 'next-intl';

import {
    Plus,
    Trash2,
    Combine,
    Hand,
} from 'lucide-react';
import React, { useState, useSyncExternalStore } from 'react';
import { InlineLoading } from '@/components/loading';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { type EditorMode, useEditorState } from '@/contexts/editor-provider';
import type { FingeringRequest } from '@/generated/api';
import type { Duration } from '@/types/score-types';
import {
    createRhythmicGridResolution,
    type Rational,
    type RhythmicGridResolution,
} from '@/lib/editor-domain';
import {
    createAddModeInputDurationFromDuration,
    type AddModeInputKind,
} from '@/hooks/editor/entity-editor/add-mode-command';
import { formatPitch } from '@/lib/editor/staff-pitch-resolver';
import { SlurSymbol, TieSymbol } from './music-symbols';
import { VoiceLayer } from './voice-layer';

// Tool button type definition.
type ToolItem = { icon: React.ElementType; label: string; mode?: EditorMode };

const noteTools: ToolItem[] = [
    { icon: Plus, label: 'add', mode: 'add' },
    { icon: Trash2, label: 'delete', mode: 'delete' },
];

const tieTools: ToolItem[] = [
    { icon: TieSymbol, label: 'addTie', mode: 'addTie' },
    { icon: SlurSymbol, label: 'addSlur', mode: 'addSlur' },
];

const fingeringHandSizes: NonNullable<FingeringRequest['hand_size']>[] = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL'];

const addModeDurationTools = [
    { value: 'durationWhole', shortLabel: '1' },
    { value: 'durationHalf', shortLabel: '1/2' },
    { value: 'durationQuarter', shortLabel: '1/4' },
    { value: 'durationEighth', shortLabel: '1/8' },
    { value: 'duration16th', shortLabel: '1/16' },
    { value: 'duration32nd', shortLabel: '1/32' },
] satisfies Array<{ value: Duration; shortLabel: string }>;

const addModeInputKindTools = [
    { value: 'rest', labelKey: 'addModeInputRest' },
    { value: 'pitched', labelKey: 'addModeInputNote' },
] satisfies Array<{ value: AddModeInputKind; labelKey: string }>;

const addModeGridOptions = [
    { value: 'quarter', labelKey: 'gridQuarter', step: { numerator: 1, denominator: 1 } },
    { value: 'eighth', labelKey: 'gridEighth', step: { numerator: 1, denominator: 2 } },
    { value: 'sixteenth', labelKey: 'gridSixteenth', step: { numerator: 1, denominator: 4 } },
] satisfies Array<{ value: string; labelKey: string; step: Rational }>;

const ToolButton = ({ tool, isActive, onToolSelect }: { tool: ToolItem, isActive: boolean, onToolSelect: (mode: EditorMode) => void }) => {
    const isMobile = useIsMobile();
    const isClient = useSyncExternalStore(
        () => () => {},
        () => true,
        () => false
    );
    const t = useTranslations('editor');

    if (!isClient) {
        return <Skeleton className="h-20 w-full" />;
    }

    const translatedLabel = t(tool.label as never);

    const handleClick = () => {
        if (tool.mode) {
            onToolSelect(tool.mode);
        }
    };

    const button = (
        <Button
            variant="outline"
            className={cn(
                "flex flex-col w-full h-20 items-center justify-center hover:bg-accent",
                isActive && "bg-accent text-accent-foreground"
            )}
            onClick={handleClick}
        >
            <div className="h-6 w-6 mb-1 flex items-center justify-center"><tool.icon /></div>
            <span className="text-xs text-center">{translatedLabel}</span>
        </Button>
    );

    return isMobile ? (
        button
    ) : (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    {button}
                </TooltipTrigger>
                <TooltipContent><p>{translatedLabel}</p></TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
};

function AddModeDurationToolbar({
    selectedDuration,
    onSelectDuration,
}: {
    selectedDuration: Duration;
    onSelectDuration: (duration: Duration) => void;
}) {
    const t = useTranslations('editor');

    return (
        <div className="grid grid-cols-3 gap-1.5" role="group" aria-label={t('addModeInputDuration')}>
            {addModeDurationTools.map((duration) => {
                const selected = selectedDuration === duration.value;
                return (
                    <Button
                        key={duration.value}
                        type="button"
                        variant={selected ? 'default' : 'outline'}
                        className="h-10 flex-col gap-0 px-1"
                        aria-pressed={selected}
                        aria-label={t(duration.value as never)}
                        onClick={() => onSelectDuration(duration.value)}
                    >
                        <span className="font-mono text-sm leading-none">{duration.shortLabel}</span>
                        <span className="sr-only">{t(duration.value as never)}</span>
                    </Button>
                );
            })}
        </div>
    );
}

function AddModeInputKindToolbar({
    selectedKind,
    pitchLabel,
    onSelectKind,
}: {
    selectedKind: AddModeInputKind;
    pitchLabel: string;
    onSelectKind: (kind: AddModeInputKind) => void;
}) {
    const t = useTranslations('editor');

    return (
        <div className="grid grid-cols-2 gap-1.5" role="group" aria-label={t('addModeInputKind')}>
            {addModeInputKindTools.map((tool) => {
                const selected = selectedKind === tool.value;
                return (
                    <Button
                        key={tool.value}
                        type="button"
                        variant={selected ? 'default' : 'outline'}
                        className="h-10"
                        aria-pressed={selected}
                        aria-label={t(tool.labelKey as never)}
                        onClick={() => onSelectKind(tool.value)}
                    >
                        {tool.value === 'pitched' ? pitchLabel : t('eventTypeRest')}
                    </Button>
                );
            })}
        </div>
    );
}

export function EditorSidebar({
    editorMode,
    fingeringPending = false,
    onGenerateFingering,
    onToolSelect,
    onNormalizeVoices
}: {
    editorMode: EditorMode,
    fingeringPending?: boolean,
    onGenerateFingering?: (handSize: NonNullable<FingeringRequest['hand_size']>) => void,
    onToolSelect: (mode: EditorMode) => void,
    onNormalizeVoices?: () => void
}) {
    const t = useTranslations('editor');
    const common = useTranslations('common');
    const {
        addModeGridResolution,
        addModeInput,
        addModeInputDuration,
        setAddModeInput,
        setAddModeGridResolution,
        setAddModeInputDuration,
    } = useEditorState();
    const [fingeringDialogOpen, setFingeringDialogOpen] = useState(false);
    const [selectedHandSize, setSelectedHandSize] = useState<NonNullable<FingeringRequest['hand_size']>>('M');
    const selectedAddModeDuration = `duration${capitalizeDurationBase(addModeInputDuration.rhythm.notation.base)}` as Duration;
    const addModePitchLabel = formatPitch(addModeInput.pitch);

    const confirmGenerateFingering = () => {
        onGenerateFingering?.(selectedHandSize);
        setFingeringDialogOpen(false);
    };

    return (
        <div className="space-y-4">
            <VoiceLayer />

            <Separator />

            <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">{t('noteTools')}</h3>
                <div className="grid grid-cols-2 gap-2">
                    {noteTools.map(tool => (
                        <ToolButton
                            key={tool.label}
                            tool={tool}
                            isActive={!!tool.mode && tool.mode === editorMode}
                            onToolSelect={onToolSelect}
                        />
                    ))}
                </div>
                {editorMode === 'add' ? (
                    <div className="mt-3 space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">
                            {t('addModeInputKind')}
                        </label>
                        <AddModeInputKindToolbar
                            selectedKind={addModeInput.kind}
                            pitchLabel={addModePitchLabel}
                            onSelectKind={(kind) => setAddModeInput((current) => ({
                                ...current,
                                kind,
                            }))}
                        />
                        <label className="text-xs font-medium text-muted-foreground">
                            {t('addModeInputDuration')}
                        </label>
                        <AddModeDurationToolbar
                            selectedDuration={selectedAddModeDuration}
                            onSelectDuration={(duration) => setAddModeInputDuration(createAddModeInputDurationFromDuration(duration))}
                        />
                        <label className="text-xs font-medium text-muted-foreground" htmlFor="add-mode-grid-resolution">
                            {t('addModeGridResolution')}
                        </label>
                        <Select
                            value={getAddModeGridValue(addModeGridResolution)}
                            onValueChange={(value) => {
                                const option = addModeGridOptions.find((candidate) => candidate.value === value);
                                if (!option) {
                                    throw new Error(`Unsupported add-mode grid option: ${value}`);
                                }
                                setAddModeGridResolution(createRhythmicGridResolution(option.step));
                            }}
                        >
                            <SelectTrigger id="add-mode-grid-resolution" className="h-9 bg-background">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {addModeGridOptions.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                        {t(option.labelKey as never)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                ) : null}
            </div>

            <Separator />

            <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">{t('tieTools')}</h3>
                <div className="grid grid-cols-2 gap-2">
                    {tieTools.map(tool => (
                        <ToolButton key={tool.label} tool={tool} isActive={!!tool.mode && tool.mode === editorMode} onToolSelect={onToolSelect} />
                    ))}
                </div>
            </div>

            <Separator />

            <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">{t('assistantTools')}</h3>
                <div className="grid grid-cols-2 gap-2">
                    <Button
                        variant="outline"
                        className="flex flex-col w-full h-20 items-center justify-center hover:bg-accent"
                        onClick={onNormalizeVoices}
                    >
                        <div className="h-6 w-6 mb-1 flex items-center justify-center"><Combine /></div>
                        <span className="text-xs text-center">{t('normalizeVoices')}</span>
                    </Button>
                    <Button
                        variant="outline"
                        className="flex flex-col w-full h-20 items-center justify-center hover:bg-accent"
                        disabled={fingeringPending || !onGenerateFingering}
                        onClick={() => setFingeringDialogOpen(true)}
                    >
                        <div className="h-6 w-6 mb-1 flex items-center justify-center">
                            {fingeringPending ? <InlineLoading /> : <Hand className="h-5 w-5" />}
                        </div>
                        <span className="text-xs text-center">{t('generateFingering')}</span>
                    </Button>
                </div>
            </div>
            <Dialog open={fingeringDialogOpen} onOpenChange={setFingeringDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{t('generateFingering')}</DialogTitle>
                        <DialogDescription>{t('fingeringHandSizeDescription')}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="text-sm font-medium text-muted-foreground">{t('fingeringHandSizeLabel')}</div>
                        <div className="grid grid-cols-4 gap-2">
                            {fingeringHandSizes.map((size) => (
                                <Button
                                    key={size}
                                    type="button"
                                    variant={selectedHandSize === size ? 'default' : 'outline'}
                                    className="h-11"
                                    onClick={() => setSelectedHandSize(size)}
                                >
                                    {size}
                                </Button>
                            ))}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setFingeringDialogOpen(false)}>
                            {common('cancel')}
                        </Button>
                        <Button type="button" disabled={fingeringPending || !onGenerateFingering} onClick={confirmGenerateFingering}>
                            {fingeringPending ? <InlineLoading /> : null}
                            {common('confirm')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
};

function capitalizeDurationBase(base: string): string {
    return `${base.charAt(0).toUpperCase()}${base.slice(1)}`;
}

function getAddModeGridValue(grid: RhythmicGridResolution): string {
    const option = addModeGridOptions.find((candidate) => (
        candidate.step.numerator === grid.step.numerator
        && candidate.step.denominator === grid.step.denominator
    ));
    if (!option) {
        throw new Error(`Unsupported add-mode grid resolution: ${grid.step.numerator}/${grid.step.denominator}`);
    }
    return option.value;
}

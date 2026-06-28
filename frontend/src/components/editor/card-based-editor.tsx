'use client';

import React, { useCallback, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Eraser, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { EntityLocation, ScoreEntity } from '@/types/score-types';
import { useEditorState, useEntityEditor, useScoreData, useVoiceEditor, useXmlUpdater } from '@/contexts/editor-provider';
import { useConnectionOperations } from '@/hooks/editor/use-connection-operations';
import { useToast } from '@/hooks/use-toast';
import { DragScrollContainer } from './drag-scroll-container';
import { NoteCard } from './note-card';
import { ChordCard } from './chord-card';
import { AddNoteCard } from './add-note-card';
import { InsertionCaret } from './insertion-caret';

export function CardBasedEditor() {
    const t = useTranslations('editor');
    const tCommon = useTranslations('common');
    const { scoreData, currentXml } = useScoreData();
    const { editorMode, setOnToolChange } = useEditorState();
    const { handleAddEntity, handleEditEntity, handleDeleteEntity } = useEntityEditor();
    const { handleAddVoice, handleClearVoice, handleDeleteVoice } = useVoiceEditor();
    const { updateMusicXML } = useXmlUpdater();
    const { toast } = useToast();

    const {
        handleDeleteTie,
        handleDeleteSlur,
        handleDeleteBeam,
        handleAddTieSelection,
        handleAddSlurSelection,
        handleAddBeamSelection,
        clearTieSelection,
        clearSlurSelection,
        clearBeamSelection,
    } = useConnectionOperations({ scoreData, currentXml, updateMusicXML });

    useEffect(() => {
        setOnToolChange(() => {
            clearTieSelection();
            clearSlurSelection();
            clearBeamSelection();
        });
        return () => setOnToolChange(null);
    }, [setOnToolChange, clearTieSelection, clearSlurSelection, clearBeamSelection]);

    const isInsertMode = editorMode === 'insert';

    const handleCardClick = useCallback((location: EntityLocation, entity: ScoreEntity) => {
        switch (editorMode) {
            case 'insert':
                break;
            case 'select':
                handleEditEntity(entity, location);
                break;
            case 'delete':
                handleDeleteEntity(location);
                toast({ title: tCommon('operationSuccess'), description: t('noteDeleted') });
                break;
            case 'addTie': {
                const result = handleAddTieSelection(location, entity);
                toast({
                    title: result.success ? tCommon('operationSuccess') : tCommon('operationFailed'),
                    description: result.message,
                    variant: result.success ? undefined : 'destructive',
                });
                break;
            }
            case 'deleteTie': {
                const result = handleDeleteTie(entity);
                toast({
                    title: result.success ? tCommon('operationSuccess') : tCommon('operationFailed'),
                    description: result.message,
                    variant: result.success ? undefined : 'destructive',
                });
                break;
            }
            case 'addSlur': {
                const result = handleAddSlurSelection(location, entity);
                toast({
                    title: result.success ? tCommon('operationSuccess') : tCommon('operationFailed'),
                    description: result.message,
                    variant: result.success ? undefined : 'destructive',
                });
                break;
            }
            case 'deleteSlur': {
                const result = handleDeleteSlur(entity);
                toast({
                    title: result.success ? tCommon('operationSuccess') : tCommon('operationFailed'),
                    description: result.message,
                    variant: result.success ? undefined : 'destructive',
                });
                break;
            }
            case 'addBeam': {
                const result = handleAddBeamSelection(location, entity);
                toast({
                    title: result.success ? tCommon('operationSuccess') : tCommon('operationFailed'),
                    description: result.message,
                    variant: result.success ? undefined : 'destructive',
                });
                break;
            }
            case 'deleteBeam': {
                const result = handleDeleteBeam(entity);
                toast({
                    title: result.success ? tCommon('operationSuccess') : tCommon('operationFailed'),
                    description: result.message,
                    variant: result.success ? undefined : 'destructive',
                });
                break;
            }
            default:
                handleEditEntity(entity, location);
        }
    }, [
        editorMode,
        handleAddBeamSelection,
        handleAddSlurSelection,
        handleAddTieSelection,
        handleDeleteBeam,
        handleDeleteEntity,
        handleDeleteSlur,
        handleDeleteTie,
        handleEditEntity,
        t,
        tCommon,
        toast,
    ]);

    if (!scoreData) {
        return (
            <Card className="bg-white rounded-2xl shadow-lg p-8 text-center">
                <p className="text-muted-foreground">{tCommon('loadingScoreData')}</p>
            </Card>
        );
    }

    return (
        <TooltipProvider>
            <div className="space-y-4">
                {scoreData.measures.map((measure, measureIndex) => (
                    <Card key={measure.number} className="bg-white rounded-2xl shadow-lg">
                        <div className="p-4 space-y-4">
                            <CardTitle className="font-semibold text-foreground text-base">{t('measureLabel')} {measure.number}</CardTitle>
                            {measure.staves.map((stave, staveIndex) => (
                                <div key={staveIndex} className="space-y-3">
                                    <div className="flex justify-between items-center mb-2">
                                        <h5 className="font-medium text-sm text-muted-foreground">{t(stave.name as never)}</h5>
                                        <Button variant="outline" onClick={() => handleAddVoice(measureIndex, staveIndex)} className="h-8 px-2 py-1 text-xs hover:bg-accent">
                                            <Plus className="h-3 w-3 mr-1" />
                                            {t('addVoice')}
                                        </Button>
                                    </div>
                                    {stave.voices.map((voice, voiceIndex) => {
                                        const [voiceKey, voiceNum] = voice.name.split(' ');
                                        const translatedVoiceName = `${t(voiceKey as never)} ${voiceNum}`;
                                        const xmlVoice = parseInt(voiceNum, 10) || (voiceIndex + 1 + (staveIndex === 1 ? 4 : 0));

                                        return (
                                            <div key={voiceIndex} className="flex items-center gap-4">
                                                <div className="w-28 shrink-0 flex items-center gap-2">
                                                    <p className="font-semibold text-sm truncate">{translatedVoiceName}</p>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            {voice.notes.length > 0 ? (
                                                                <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => handleClearVoice(measureIndex, staveIndex, xmlVoice)}>
                                                                    <Eraser className="h-4 w-4" />
                                                                </Button>
                                                            ) : (
                                                                <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleDeleteVoice(measureIndex, staveIndex, xmlVoice, voiceIndex)}>
                                                                    <Trash2 className="h-4 w-4" />
                                                                </Button>
                                                            )}
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            <p>{t(voice.notes.length > 0 ? 'clearVoice' : 'deleteVoice')}</p>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </div>
                                                <DragScrollContainer className={isInsertMode ? 'gap-0 px-2' : undefined}>
                                                    {voice.notes.map((entity, entityIndex) => {
                                                        const entityXmlVoice = entity.meta?.xmlVoice ?? xmlVoice;
                                                        const xmlStaveIndex = entity.meta?.staveIndex ?? staveIndex;
                                                        const location = { measureIndex, staveIndex: xmlStaveIndex, xmlVoice: entityXmlVoice, entityIndex };

                                                        return (
                                                            <React.Fragment key={entityIndex}>
                                                                {isInsertMode && (
                                                                    <InsertionCaret onClick={() => handleAddEntity({ ...location, position: 'before' as const })} />
                                                                )}
                                                                <div className="shrink-0">
                                                                    {(entity.type === 'note' || entity.type === 'rest' || entity.type === 'blank') && (
                                                                        <NoteCard note={entity} onClick={() => handleCardClick(location, entity)} />
                                                                    )}
                                                                    {entity.type === 'chord' && (
                                                                        <ChordCard chord={entity} onClick={() => handleCardClick(location, entity)} />
                                                                    )}
                                                                </div>
                                                                {isInsertMode && entityIndex === voice.notes.length - 1 && (
                                                                    <InsertionCaret onClick={() => handleAddEntity({ ...location, position: 'after' as const })} />
                                                                )}
                                                            </React.Fragment>
                                                        );
                                                    })}
                                                    {voice.notes.length === 0 && (
                                                        <AddNoteCard onClick={() => handleAddEntity({ measureIndex, staveIndex, xmlVoice, entityIndex: 0, position: 'before' })} />
                                                    )}
                                                </DragScrollContainer>
                                            </div>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                    </Card>
                ))}
            </div>
        </TooltipProvider>
    );
}
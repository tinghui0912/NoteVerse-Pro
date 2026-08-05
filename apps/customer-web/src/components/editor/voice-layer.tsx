'use client';

import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useEditorTracks } from '@/hooks/editor/use-editor-tracks';
import { useVoiceEditor } from '@/contexts/editor-provider';
import { cn } from '@/lib/utils';

export function VoiceLayer() {
  const t = useTranslations('editor');
  const {
    tracks,
    activeTrackId,
    addTrack,
    removeEmptyTrack,
    visibleTrackIdSet,
    selectTrack,
    toggleTrackVisibility,
  } = useEditorTracks();
  const { handleDeleteTrack } = useVoiceEditor();

  if (tracks.length === 0) {
    return null;
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">{t('voiceLayer')}</h3>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={addTrack}
                aria-label={t('addVoice')}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t('addVoice')}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="space-y-1.5">
        {tracks.map((track) => {
          const isActive = track.id === activeTrackId;
          const isVisible = visibleTrackIdSet.has(track.id);
          const canDeleteTrack = tracks.length > 1;

          return (
            <div
              key={track.id}
              className={cn(
                'flex items-center gap-2 rounded-lg border bg-background/50 p-1.5',
                isActive && 'border-primary bg-primary/5'
              )}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                onClick={() => selectTrack(track.id)}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: track.color }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate">
                  {t('voiceLabel')} {track.xmlVoice}
                </span>
              </button>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => toggleTrackVisibility(track.id)}
                      aria-label={isVisible ? t('hideVoice') : t('showVoice')}
                    >
                      {isVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{isVisible ? t('hideVoice') : t('showVoice')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                      disabled={!canDeleteTrack}
                      onClick={() => {
                        if (track.entityCount === 0) {
                          removeEmptyTrack(track.id);
                        } else {
                          handleDeleteTrack(track.staffIndex, track.xmlVoice);
                        }
                      }}
                      aria-label={t('deleteVoice')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t('deleteVoice')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          );
        })}
      </div>
    </div>
  );
}

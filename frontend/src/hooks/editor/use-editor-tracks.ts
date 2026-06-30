'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { useEditorState } from '@/contexts/editor-state-context';
import { useScoreData } from '@/contexts/score-data-context';
import { deriveEditorTracks, getEditorTrackId, getNextVoiceNumberFromScore } from '@/lib/editor/tracks';

export function useEditorTracks() {
  const { scoreData, setScoreData } = useScoreData();
  const {
    activeTrackId,
    setActiveTrackId,
    visibleTrackIds,
    setVisibleTrackIds,
  } = useEditorState();

  const tracks = useMemo(() => deriveEditorTracks(scoreData), [scoreData]);
  const trackIds = useMemo(() => tracks.map((track) => track.id), [tracks]);
  const visibleTrackIdSet = useMemo(() => new Set(visibleTrackIds), [visibleTrackIds]);

  useEffect(() => {
    if (trackIds.length === 0) {
      setActiveTrackId(null);
      setVisibleTrackIds([]);
      return;
    }

    setActiveTrackId((current) => (current && trackIds.includes(current) ? current : trackIds[0]));
    setVisibleTrackIds((current) => {
      const currentInScore = current.filter((id) => trackIds.includes(id));
      const restoredOrNewTracks = trackIds.filter((id) => !current.includes(id));
      const nextVisible = [...currentInScore, ...restoredOrNewTracks];
      return nextVisible.length > 0 ? nextVisible : trackIds;
    });
  }, [setActiveTrackId, setVisibleTrackIds, trackIds]);

  const selectTrack = useCallback((trackId: string) => {
    setActiveTrackId(trackId);
    setVisibleTrackIds((current) => (current.includes(trackId) ? current : [...current, trackId]));
  }, [setActiveTrackId, setVisibleTrackIds]);

  const toggleTrackVisibility = useCallback((trackId: string) => {
    setVisibleTrackIds((current) => {
      if (!current.includes(trackId)) return [...current, trackId];
      if (current.length <= 1) return current;
      return current.filter((id) => id !== trackId);
    });
  }, [setVisibleTrackIds]);

  const addTrack = useCallback(() => {
    if (!scoreData || tracks.length === 0) return;

    const xmlVoice = getNextVoiceNumberFromScore(scoreData);
    const newTrackId = getEditorTrackId(0, xmlVoice);

    setScoreData((current) => {
      if (!current) return current;

      return {
        ...current,
        measures: current.measures.map((measure) => ({
          ...measure,
          staves: measure.staves.map((stave) => {
            if (stave.voices.some((voice) => voice.name === `voiceLabel ${xmlVoice}`)) return stave;

            return {
              ...stave,
              voices: [...stave.voices, { name: `voiceLabel ${xmlVoice}`, notes: [] }]
                .sort((left, right) => {
                  const leftVoice = Number.parseInt(left.name.match(/\d+/)?.[0] ?? '0', 10);
                  const rightVoice = Number.parseInt(right.name.match(/\d+/)?.[0] ?? '0', 10);
                  return leftVoice - rightVoice;
                }),
            };
          }),
        })),
      };
    });

    setActiveTrackId(newTrackId);
    setVisibleTrackIds((current) => (current.includes(newTrackId) ? current : [...current, newTrackId]));
  }, [scoreData, setActiveTrackId, setScoreData, setVisibleTrackIds, tracks.length]);

  const removeEmptyTrack = useCallback((trackId: string) => {
    const track = tracks.find((candidate) => candidate.id === trackId);
    if (!track || track.entityCount > 0) return;

    setScoreData((current) => {
      if (!current) return current;

      return {
        ...current,
        measures: current.measures.map((measure) => ({
          ...measure,
          staves: measure.staves.map((stave) => {
            return {
              ...stave,
              voices: stave.voices.filter((voice) => voice.name !== `voiceLabel ${track.xmlVoice}`),
            };
          }),
        })),
      };
    });

    setVisibleTrackIds((current) => current.filter((id) => id !== trackId));
    setActiveTrackId((current) => (current === trackId ? null : current));
  }, [setActiveTrackId, setScoreData, setVisibleTrackIds, tracks]);

  return {
    addTrack,
    tracks,
    activeTrackId,
    visibleTrackIds,
    visibleTrackIdSet,
    removeEmptyTrack,
    selectTrack,
    toggleTrackVisibility,
  };
}

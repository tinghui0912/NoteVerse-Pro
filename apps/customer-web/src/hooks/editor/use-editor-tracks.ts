'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useEditorState } from '@/contexts/editor-state-context';
import { useEditorSession } from '@/contexts/editor-session-context';
import { deriveEditorTracks } from '@/lib/editor/tracks';

export function useEditorTracks() {
  const { document, inputVoices, prepareVoice, discardInputVoice } = useEditorSession();
  const { activeTrackId, setActiveTrackId, visibleTrackIds, setVisibleTrackIds } = useEditorState();

  const tracks = useMemo(() => deriveEditorTracks(document, inputVoices), [document, inputVoices]);
  const trackIds = useMemo(() => tracks.map((track) => track.id), [tracks]);
  const visibleTrackIdSet = useMemo(() => new Set(visibleTrackIds), [visibleTrackIds]);

  const previousTrackIds = useRef(new Set<string>());
  useEffect(() => {
    const addedIds = trackIds.filter((id) => !previousTrackIds.current.has(id));
    previousTrackIds.current = new Set(trackIds);
    if (trackIds.length === 0) {
      setActiveTrackId(null);
      setVisibleTrackIds([]);
      return;
    }

    setActiveTrackId((current) => (current && trackIds.includes(current) ? current : trackIds[0]));
    setVisibleTrackIds((current) => {
      const currentInScore = current.filter((id) => trackIds.includes(id));
      const restoredOrNewTracks = addedIds;
      const nextVisible = [...currentInScore, ...restoredOrNewTracks];
      return nextVisible.length > 0 ? nextVisible : trackIds;
    });
  }, [setActiveTrackId, setVisibleTrackIds, trackIds]);

  const selectTrack = useCallback(
    (trackId: string) => {
      setActiveTrackId(trackId);
      setVisibleTrackIds((current) =>
        current.includes(trackId) ? current : [...current, trackId],
      );
    },
    [setActiveTrackId, setVisibleTrackIds],
  );

  const toggleTrackVisibility = useCallback(
    (trackId: string) => {
      setVisibleTrackIds((current) => {
        if (!current.includes(trackId)) return [...current, trackId];
        if (current.length <= 1) return current;
        return current.filter((id) => id !== trackId);
      });
    },
    [setVisibleTrackIds],
  );

  const addTrack = useCallback(() => {
    const active = tracks.find((track) => track.id === activeTrackId);
    const voice = prepareVoice(active ? document?.staves[active.staffIndex]?.id : undefined);
    if (!voice) return;
    setActiveTrackId(voice.id);
    setVisibleTrackIds((current) => [...current, voice.id]);
  }, [prepareVoice, setActiveTrackId, setVisibleTrackIds, tracks, activeTrackId, document]);
  const removeEmptyTrack = useCallback(
    (id: string) => {
      const track = tracks.find((track) => track.id === id);
      if (!track || track.entityCount) return;
      discardInputVoice(track.voiceId);
      setVisibleTrackIds((current) => current.filter((value) => value !== id));
      setActiveTrackId((current) => (current === id ? null : current));
    },
    [tracks, discardInputVoice, setVisibleTrackIds, setActiveTrackId],
  );

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

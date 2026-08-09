'use client';

import { useCallback, useRef, useState } from 'react';
import { practiceApi } from '@/lib/api';
import {
  PCM_CHANNELS,
  PCM_FRAME_FORMAT,
  PCM_SAMPLE_RATE,
} from '@/lib/practice/audio-stream';
import type { PracticeSessionDetailRead, PracticeSessionState } from '@/generated/practice-api';

interface UsePracticeSessionOptions {
  scoreId: string;
  revisionId?: string;
}

export function usePracticeSession({ scoreId, revisionId }: UsePracticeSessionOptions) {
  const [session, setSession] = useState<PracticeSessionDetailRead | null>(null);
  const detailRef = useRef<PracticeSessionDetailRead | null>(null);

  const sync = useCallback((detail: PracticeSessionDetailRead) => {
    detailRef.current = detail;
    setSession(detail);
    return detail;
  }, []);

  const clear = useCallback(() => {
    detailRef.current = null;
    setSession(null);
  }, []);

  const create = useCallback(async () => {
    const response = await practiceApi.createPracticeSession({
      score_id: scoreId,
      revision_id: revisionId,
      sample_rate: PCM_SAMPLE_RATE,
      channels: PCM_CHANNELS,
      frame_format: PCM_FRAME_FORMAT,
    });
    if (!response.data?.session_id || !response.data.ws_url) {
      throw new Error('Practice session creation failed.');
    }
    const detailResponse = await practiceApi.getPracticeSession(response.data.session_id);
    if (!detailResponse.data) {
      throw new Error('Practice session details are unavailable.');
    }
    return { detail: sync(detailResponse.data), wsUrl: response.data.ws_url };
  }, [revisionId, scoreId, sync]);

  const runRestControl = useCallback(
    async (action: 'pause' | 'resume' | 'finish', sessionId = detailRef.current?.session_id) => {
      if (!sessionId) {
        return null;
      }
      const response = await practiceApi[
        action === 'pause'
          ? 'pausePracticeSession'
          : action === 'resume'
            ? 'resumePracticeSession'
            : 'finishPracticeSession'
      ](sessionId);
      return response.data ? sync(response.data) : null;
    },
    [sync]
  );

  const updateState = useCallback((state: PracticeSessionState) => {
    setSession((current) => {
      if (!current) {
        return current;
      }
      const next = { ...current, state };
      detailRef.current = next;
      return next;
    });
  }, []);

  const getDetail = useCallback(() => detailRef.current, []);
  const getSessionId = useCallback(() => detailRef.current?.session_id ?? null, []);

  return { clear, create, getDetail, getSessionId, runRestControl, session, sync, updateState };
}

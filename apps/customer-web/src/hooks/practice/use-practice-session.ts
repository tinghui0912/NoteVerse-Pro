'use client';

import { useCallback, useRef, useState } from 'react';
import { practiceApi } from '@/lib/api';
import {
  PCM_CHANNELS,
  PCM_FRAME_FORMAT,
  PCM_SAMPLE_RATE,
} from '@/lib/practice/audio-stream';
import { practiceSessionIntent, type PracticeSessionMode } from '@/lib/practice/session-policy';
import type {
  PracticeInputSource,
  PracticeSessionCompletionOutcomeRead,
  PracticeSessionDetailRead,
  PracticeSessionScope,
  PracticeSessionState,
} from '@/generated/practice-api';

interface UsePracticeSessionOptions {
  scoreId: string;
  revisionId?: string;
  practiceMode: PracticeSessionMode;
  inputSource: PracticeInputSource;
  practiceScope?: PracticeSessionScope | null;
}

export function usePracticeSession({
  scoreId,
  revisionId,
  practiceMode,
  inputSource,
  practiceScope,
}: UsePracticeSessionOptions) {
  const [session, setSession] = useState<PracticeSessionDetailRead | null>(null);
  const detailRef = useRef<PracticeSessionDetailRead | null>(null);
  const versionRef = useRef(0);

  const sync = useCallback((detail: PracticeSessionDetailRead) => {
    detailRef.current = detail;
    setSession(detail);
    return detail;
  }, []);

  const clear = useCallback(() => {
    versionRef.current += 1;
    detailRef.current = null;
    setSession(null);
  }, []);

  const create = useCallback(async () => {
    const version = versionRef.current;
    const response = await practiceApi.createPracticeSession({
      score_id: scoreId,
      revision_id: revisionId,
      sample_rate: PCM_SAMPLE_RATE,
      channels: PCM_CHANNELS,
      frame_format: PCM_FRAME_FORMAT,
      practice_scope: practiceScope ?? undefined,
      ...practiceSessionIntent(practiceMode, inputSource),
    });
    if (!response.data?.session_id || !response.data.ws_url) {
      throw new Error('Practice session creation failed.');
    }
    const detailResponse = await practiceApi.getPracticeSession(response.data.session_id);
    if (!detailResponse.data) {
      throw new Error('Practice session details are unavailable.');
    }
    if (version !== versionRef.current) {
      return null;
    }
    return { detail: sync(detailResponse.data), wsUrl: response.data.ws_url };
  }, [inputSource, practiceMode, practiceScope, revisionId, scoreId, sync]);

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

  const updateFinished = useCallback(
    (
      state: PracticeSessionState,
      completionOutcome: PracticeSessionCompletionOutcomeRead
    ) => {
      setSession((current) => {
        if (!current) {
          return current;
        }
        const next = {
          ...current,
          state,
          completion_outcome: completionOutcome,
        };
        detailRef.current = next;
        return next;
      });
    },
    []
  );

  const getDetail = useCallback(() => detailRef.current, []);
  const getSessionId = useCallback(() => detailRef.current?.session_id ?? null, []);

  return {
    clear,
    create,
    getDetail,
    getSessionId,
    runRestControl,
    session,
    sync,
    updateFinished,
    updateState,
  };
}

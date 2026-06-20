'use client';

import { useCallback, useRef, useState } from 'react';
import { practiceApi } from '@/lib/api';
import {
  PCM_CHANNELS,
  PCM_FRAME_FORMAT,
  PCM_SAMPLE_RATE,
} from '@/lib/practice/audio-stream';
import type { PracticeSessionDetail, PracticeSessionState } from '@/types/api';

interface UsePracticeSessionOptions {
  taskId: string;
  shareToken?: string;
}

export function usePracticeSession({ taskId, shareToken }: UsePracticeSessionOptions) {
  const [session, setSession] = useState<PracticeSessionDetail | null>(null);
  const detailRef = useRef<PracticeSessionDetail | null>(null);

  const sync = useCallback((detail: PracticeSessionDetail) => {
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
      task_id: taskId,
      source: 'final',
      share_token: shareToken,
      sample_rate: PCM_SAMPLE_RATE,
      channels: PCM_CHANNELS,
      frame_format: PCM_FRAME_FORMAT,
    });
    if (!response.data?.session_id || !response.data.ws_url) {
      throw new Error(response.message || 'Practice session creation failed.');
    }
    const detailResponse = await practiceApi.getPracticeSession(response.data.session_id);
    if (!detailResponse.data) {
      throw new Error(detailResponse.message || 'Practice session details are unavailable.');
    }
    return { detail: sync(detailResponse.data), wsUrl: response.data.ws_url };
  }, [shareToken, sync, taskId]);

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

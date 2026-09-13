'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { API_BASE_URL } from '@/lib/app-protocol';
import { reportUnexpectedClientError } from '@/lib/observability';
import {
  parsePracticeServerMessage,
  PRACTICE_WEBSOCKET_PROTOCOL_VERSION,
  type PracticeServerMessage,
} from '@/lib/practice/protocol';

function buildPracticeWebSocketUrl(path: string) {
  const pageUrl = new URL(window.location.href);
  const normalizedBase = API_BASE_URL.startsWith('http')
    ? API_BASE_URL
    : `${pageUrl.origin}${API_BASE_URL.startsWith('/') ? API_BASE_URL : `/${API_BASE_URL}`}`;
  const wsBase = normalizedBase.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  return new URL(path, `${wsBase.endsWith('/') ? wsBase : `${wsBase}/`}`).toString();
}

interface PracticeSocketOptions {
  onMessage: (message: PracticeServerMessage) => void;
  onClose: (intentional: boolean) => void;
}

export function usePracticeSocket({ onMessage, onClose }: PracticeSocketOptions) {
  const socketRef = useRef<WebSocket | null>(null);
  const intentionalSocketsRef = useRef(new WeakSet<WebSocket>());
  const heartbeatRef = useRef<number | null>(null);
  const onMessageRef = useRef(onMessage);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onMessageRef.current = onMessage;
    onCloseRef.current = onClose;
  }, [onClose, onMessage]);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current !== null) {
      window.clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  const close = useCallback(() => {
    stopHeartbeat();
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket && socket.readyState <= WebSocket.OPEN) {
      intentionalSocketsRef.current.add(socket);
      socket.close();
    }
  }, [stopHeartbeat]);

  const isOpen = useCallback(() => socketRef.current?.readyState === WebSocket.OPEN, []);

  const sendJson = useCallback((message: object) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      return false;
    }
    socketRef.current.send(JSON.stringify(message));
    return true;
  }, []);

  const sendBinary = useCallback((frame: ArrayBuffer) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      return false;
    }
    socketRef.current.send(frame);
    return true;
  }, []);

  const open = useCallback(
    async (path: string) => {
      close();
      const socket = new WebSocket(buildPracticeWebSocketUrl(path));
      socketRef.current = socket;
      socket.onmessage = (event) => {
        try {
          onMessageRef.current(parsePracticeServerMessage(JSON.parse(event.data)));
        } catch (error) {
          reportUnexpectedClientError(error, {
            area: 'practice_realtime',
            action: 'parse_message',
          });
        }
      };
      socket.onclose = () => {
        const isCurrentSocket = socketRef.current === socket;
        const intentional = intentionalSocketsRef.current.has(socket);
        if (isCurrentSocket) {
          socketRef.current = null;
          stopHeartbeat();
          onCloseRef.current(intentional);
        }
      };

      await new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve();
        socket.onerror = () => {
          const error = new Error('practice_realtime_connection_failed');
          reportUnexpectedClientError(error, {
            area: 'practice_realtime',
            action: 'open_socket',
          });
          reject(error);
        };
      });
    },
    [close, stopHeartbeat]
  );

  const startHeartbeat = useCallback(() => {
    stopHeartbeat();
    if (!isOpen()) {
      return;
    }
    heartbeatRef.current = window.setInterval(() => {
      sendJson({
        protocol_version: PRACTICE_WEBSOCKET_PROTOCOL_VERSION,
        type: 'client.heartbeat',
        payload: { t: Date.now() },
      });
    }, 5000);
  }, [isOpen, sendJson, stopHeartbeat]);

  useEffect(() => close, [close]);

  return useMemo(
    () => ({ close, isOpen, open, sendBinary, sendJson, startHeartbeat, stopHeartbeat }),
    [close, isOpen, open, sendBinary, sendJson, startHeartbeat, stopHeartbeat]
  );
}

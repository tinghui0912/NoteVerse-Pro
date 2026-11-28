'use client';

import { useEffect, useRef, useState } from 'react';

export function readFragmentToken(hash: string): string {
  return new URLSearchParams(hash.slice(1)).get('token') ?? '';
}

/** Captures the email credential once per mounted page, then removes it from history. */
export function useFragmentToken(): string | null {
  const captured = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    if (captured.current === null) {
      captured.current = readFragmentToken(window.location.hash);
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
    }
    const value = captured.current;
    let active = true;
    queueMicrotask(() => { if (active) setToken(value); });
    return () => { active = false; };
  }, []);
  return token;
}

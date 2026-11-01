'use client';
import { useCallback, useEffect, useState } from 'react';
import type { PracticeResourceBinding } from '@/lib/practice/device/practice-resource-binding';
import type { PracticeRootHealthPort } from '@/lib/practice/device/device-contract';

const absentHealth: PracticeRootHealthPort = Object.freeze({
  snapshot: () => ({ health: {} }), subscribe: () => () => {},
});

/** Observes a borrowed owner. Never opens or closes physical resources. */
export function usePracticeResourceBinding(binding: PracticeResourceBinding | null) {
  const [observed, setObserved] = useState<{ binding: PracticeResourceBinding; snapshot: ReturnType<PracticeResourceBinding['snapshot']> } | null>(null);
  useEffect(() => {
    if (!binding) return;
    let current = true;
    const changed = () => { if (current) setObserved({ binding, snapshot: binding.snapshot() }); };
    const unsubscribe = binding.subscribe(changed);
    changed();
    return () => { current = false; unsubscribe(); };
  }, [binding]);
  const borrow = useCallback(() => binding?.borrowRoots() ?? null, [binding]);
  return { snapshot: binding ? observed?.binding === binding ? observed.snapshot : binding.snapshot() : null,
    borrow, rootHealth: binding?.rootHealth ?? absentHealth };
}

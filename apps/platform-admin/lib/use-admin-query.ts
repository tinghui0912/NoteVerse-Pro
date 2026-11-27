"use client";
import { useEffect, useState } from "react";
import { requestErrorMessage } from "./control-plane-browser-transport";

export function useAdminQuery<T>(load: () => Promise<T>) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    load: typeof load;
    revision: number;
    data: T | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    let active = true;
    load()
      .then((data) => {
        if (active) setResult({ load, revision, data, error: null });
      })
      .catch((error) => {
        if (active)
          setResult({
            load,
            revision,
            data: null,
            error: requestErrorMessage(error),
          });
      });
    return () => {
      active = false;
    };
  }, [load, revision]);
  const current =
    result?.load === load && result.revision === revision ? result : null;
  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    loading: current === null,
    refresh: () => setRevision((value) => value + 1),
  };
}

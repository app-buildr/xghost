import { useEffect, useRef, useState } from 'react';
import { onStorageChange } from '../storage/kv';

/**
 * Charge une valeur depuis le stockage et la recharge quand une clé
 * correspondant à `match` change (dans n'importe quelle zone).
 */
export function useStorageQuery<T>(
  load: () => Promise<T>,
  match: (key: string) => boolean,
  deps: unknown[],
): { data: T | undefined; loading: boolean } {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let alive = true;
    let pending = false;
    const run = async () => {
      if (pending) return;
      pending = true;
      try {
        const value = await loadRef.current();
        if (alive) setData(value);
      } finally {
        pending = false;
        if (alive) setLoading(false);
      }
    };
    void run();
    const off = onStorageChange(match, () => void run());
    return () => {
      alive = false;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading };
}

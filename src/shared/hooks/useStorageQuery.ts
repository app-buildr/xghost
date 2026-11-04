import { useEffect, useRef, useState } from 'react';
import { onStorageChange } from '../storage/kv';

/**
 * Charge une valeur depuis le stockage et la recharge quand une clé
 * correspondant à `match` change. Un changement survenu pendant un chargement en relance un
 * à la fin (rien n'est perdu, pas de résultats dans le désordre).
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
    // Changement survenu pendant un chargement : on recharge à la fin, rien n'est perdu.
    let dirty = false;
    // Nouvelles dépendances (ex. autre compte) : pas d'anciennes données sous la nouvelle clé.
    setData(undefined);
    setLoading(true);
    const run = async () => {
      if (pending) {
        dirty = true;
        return;
      }
      pending = true;
      try {
        do {
          dirty = false;
          const value = await loadRef.current();
          if (alive) setData(value);
        } while (dirty && alive);
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
    // Dépendances fournies par l'appelant (`load` et `match` changent à chaque rendu).
  }, deps);

  return { data, loading };
}

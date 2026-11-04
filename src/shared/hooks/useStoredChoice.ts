import { useState } from 'react';

/**
 * Choix d'interface mémorisé d'une visite à l'autre (période des statistiques…), dans le
 * stockage de la page : une préférence d'affichage, pas une donnée du compte (hors sauvegarde).
 * Une valeur enregistrée inconnue reprend la valeur par défaut.
 */
export function useStoredChoice<T extends string>(key: string, allowed: readonly T[], fallback: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return allowed.includes(stored as T) ? (stored as T) : fallback;
    } catch {
      return fallback;
    }
  });
  const choose = (next: T) => {
    setValue(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // Stockage de la page indisponible : le choix vaut pour cette visite seulement.
    }
  };
  return [value, choose] as const;
}

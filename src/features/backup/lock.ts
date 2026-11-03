/**
 * Verrou d'import (service worker) : pendant qu'une sauvegarde remplace les données, le moteur
 * ne doit ni lancer ni poursuivre de scan, ni écrire d'analyse (il travaillerait sur des données
 * en cours de remplacement).
 *
 * - `isImporting()` : à tester avant tout travail qui écrit des données de compte.
 * - `importEpoch()` : change à chaque import ; un travail long (analyse de fin de scan) relève
 *   l'époque au départ et abandonne ses écritures si elle a changé entre-temps.
 */

let importing = false;
let epoch = 0;

export const isImporting = (): boolean => importing;
export const importEpoch = (): number => epoch;

/** Exécute `fn` sous le verrou d'import (un seul import à la fois). */
export async function withImportLock<T>(fn: () => Promise<T>): Promise<T> {
  if (importing) throw new Error('import-in-progress');
  importing = true;
  epoch++;
  try {
    return await fn();
  } finally {
    importing = false;
  }
}

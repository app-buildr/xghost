/**
 * Verrou d'import (service worker) : pendant qu'une sauvegarde remplace les données, le moteur
 * ne doit ni lancer ni poursuivre de scan, ni écrire d'analyse (il travaillerait sur des données
 * en cours de remplacement).
 *
 * - `isImporting()` : à tester avant tout travail qui écrit des données de compte.
 * - `importEpoch()` : change à chaque import ; un travail long (analyse de fin de scan) relève
 *   l'époque au départ et abandonne ses écritures si elle a changé entre-temps.
 * - `trackWork()` : travail lancé hors des messages (alarme, cookies, vérification) ; l'import
 *   attend sa fin avec `drainWork()`, pour qu'aucune écriture commencée avant ne passe après lui.
 */

let importing = false;
let epoch = 0;

export const isImporting = (): boolean => importing;
export const importEpoch = (): number => epoch;

const work = new Set<Promise<unknown>>();

/** Suit un travail qui peut écrire des données de compte, jusqu'à sa fin. */
export function trackWork<T>(task: () => Promise<T>): Promise<T> {
  const run = task();
  work.add(run);
  void run.catch(() => undefined).finally(() => work.delete(run));
  return run;
}

/** Attend la fin des travaux en cours. */
export async function drainWork(): Promise<void> {
  await Promise.allSettled([...work]);
}

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

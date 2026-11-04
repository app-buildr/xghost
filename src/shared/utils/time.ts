/** Durées et repères de dates (heure locale), communs à toute l'extension. */

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Minuit (heure locale) du jour de `at`. */
export function startOfDay(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Minuit (heure locale) `n` jours calendaires avant le jour de `at` (sûr aux changements d'heure). */
export function daysBefore(at: number, n: number): number {
  const d = new Date(startOfDay(at));
  d.setDate(d.getDate() - n);
  return d.getTime();
}

/** Même jour calendaire (heure locale). */
export const isSameDay = (a: number, b: number) => startOfDay(a) === startOfDay(b);

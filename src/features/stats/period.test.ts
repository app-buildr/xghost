import { describe, expect, it } from 'vitest';
import { DAY } from '@/shared/utils/time';
import { periodStart } from './period';

// Midi local : les heures autour restent le même jour, quel que soit le fuseau.
const NOW = new Date(2026, 10, 4, 12).getTime(); // mercredi 4 novembre 2026

describe('périodes', () => {
  it('commencent à minuit, aujourd’hui compris, jamais avant la référence', () => {
    expect(periodStart('7d', NOW)).toBe(new Date(2026, 9, 29).getTime());
    expect(periodStart('24h', NOW)).toBe(NOW - DAY);
    expect(periodStart('30d', NOW, NOW - 3 * DAY)).toBe(NOW - 3 * DAY);
    expect(periodStart('all', NOW, NOW - 100 * DAY)).toBe(NOW - 100 * DAY);
  });

  it('reste sur minuit malgré un changement d’heure dans la période', () => {
    const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
    const previous = env.TZ;
    env.TZ = 'Europe/Paris'; // passage à l'heure d'été le 29 mars 2026
    try {
      const now = new Date(2026, 3, 2, 12).getTime();
      const start = periodStart('7d', now);
      expect(new Date(start).getHours()).toBe(0);
      expect(new Date(start).getDate()).toBe(27);
    } finally {
      env.TZ = previous;
    }
  });
});

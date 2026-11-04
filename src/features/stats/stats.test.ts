import { describe, expect, it } from 'vitest';
import type { FollowEvent } from '@/shared/types';
import { DAY, periodStart, startOfDay } from './period';
import { bucketStarts, departuresByDuration, followerSeries, movementBuckets, retention, startOf } from './selectors';

// Midi local : les heures autour restent le même jour, quel que soit le fuseau.
const NOW = new Date(2026, 10, 4, 12).getTime(); // mercredi 4 novembre 2026
const ctx = { ignored: new Set<string>(), mutualsOnly: false };
const ev = (type: FollowEvent['type'], profileId: string, at: number): FollowEvent => ({
  id: `${type}-${profileId}-${at}`,
  type,
  profileId,
  handle: profileId,
  at,
  status: 'active',
  mutual: false,
  seen: true,
});

describe('périodes', () => {
  it('commencent à minuit, aujourd’hui compris, jamais avant la référence', () => {
    // 7 jours, aujourd'hui compris : depuis le jeudi 29 octobre à minuit (jours calendaires).
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
      expect(bucketStarts('day', start, now)).toHaveLength(7);
    } finally {
      env.TZ = previous;
    }
  });

  it('découpe en jours, semaines (lundi) et mois', () => {
    expect(new Date(startOf('week', NOW)).getDay()).toBe(1);
    expect(new Date(startOf('month', NOW)).getDate()).toBe(1);
    expect(bucketStarts('day', NOW - 2 * DAY, NOW)).toHaveLength(3);
  });
});

describe('arrivées et départs par tranche', () => {
  it('applique la règle des bilans dans chaque tranche', () => {
    const events = [ev('departure', 'a', NOW - 2 * 3600_000), ev('arrival', 'a', NOW - 3600_000), ev('arrival', 'b', NOW - 3600_000)];
    const [today] = movementBuckets(events, ctx, 'day', startOfDay(NOW), NOW);
    expect(today).toMatchObject({ arrivals: 1, departures: 0 });
  });
});

describe('courbe des abonnés', () => {
  it('remonte le temps à partir du total actuel', () => {
    const events = [ev('arrival', 'a', NOW - 3600_000), ev('departure', 'b', NOW - DAY), ev('arrival', 'c', NOW - DAY)];
    const series = followerSeries(events, [], 100, NOW - 2 * DAY, NOW);
    expect(series.points.map((p) => p.total)).toEqual([99, 99, 100]);
    expect(series.start).toBe(99); // le premier jour n'a aucun mouvement
  });

  it('un total relevé fait foi', () => {
    const series = followerSeries([], [[NOW - DAY, 90]], 100, NOW - 2 * DAY, NOW);
    expect(series.points.map((p) => p.total)).toEqual([90, 90, 100]);
    // Aujourd'hui, le total actuel l'emporte sur un relevé du jour.
    expect(followerSeries([], [[NOW, 80]], 100, NOW - DAY, NOW).points.at(-1)?.total).toBe(100);
  });

  it('sans total actuel, pas de courbe', () => {
    expect(followerSeries([], [], undefined, NOW - DAY, NOW).points).toEqual([]);
  });
});

describe('départs par durée de suivi', () => {
  it('classe les départs, masque les tranches impossibles', () => {
    const baseline = NOW - 30 * DAY;
    const events = [
      ev('arrival', 'a', NOW - 10 * DAY),
      ev('departure', 'a', NOW - 2 * DAY), // suivi 8 jours
      ev('departure', 'b', NOW - DAY), // déjà là au premier scan
      ev('departure', 'c', NOW - 5 * DAY), // parti puis revenu : ne compte pas
      ev('arrival', 'c', NOW - 3 * DAY),
    ];
    const buckets = departuresByDuration(events, ctx, baseline, NOW, baseline);
    expect(buckets).toEqual([
      { bucket: 'lt1w', count: 0 },
      { bucket: 'w1to3', count: 1 },
      { bucket: 'm1to3', count: 0 },
      { bucket: 'before', count: 1 },
    ]);
  });
});

describe('rétention des arrivées', () => {
  it('part des arrivées encore là après N jours, « — » sans recul suffisant', () => {
    const events = [
      ev('arrival', 'a', NOW - 20 * DAY),
      ev('arrival', 'b', NOW - 20 * DAY),
      ev('departure', 'b', NOW - 10 * DAY), // parti au bout de 10 jours
    ];
    const r = retention(events, ctx, NOW - 60 * DAY, NOW);
    expect(r[7]).toBe(1);
    expect(r[14]).toBe(0.5);
    expect(r[30]).toBeNull();
  });
});

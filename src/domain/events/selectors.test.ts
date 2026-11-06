import { movementBuckets } from '@/features/stats/selectors';
import { describe, expect, it } from 'vitest';
import type { FollowEvent } from '@/shared/types';
import { eventId } from './codec';
import { followDurationLabel } from '@/features/events/labels';
import { currentArrivals, currentDepartures, followDuration, newMovements, missingMovements, statsSince, unseenDepartures, type VisibilityContext, wasRemoved } from './selectors';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 12, 10);

const ev = (type: FollowEvent['type'], profileId: string, at: number, over: Partial<FollowEvent> = {}): FollowEvent => ({
  id: eventId(type, profileId, at),
  type,
  profileId,
  handle: `h${profileId}`,
  at,
  status: 'active',
  mutual: false,
  seen: type === 'arrival',
  ...over,
});

const ctx: VisibilityContext = { ignored: new Set(), mutualsOnly: false };

describe('wasRemoved', () => {
  const e = (type: FollowEvent['type'], at: number): FollowEvent => ({ id: `${type}${at}`, type, profileId: '1', handle: 'a', at, status: 'active', mutual: false, seen: true });
  const fix = (type: FollowEvent['type'], fromAt: number) => ({ profileId: '1', type, from: e(type === 'departure' ? 'arrival' : 'departure', fromAt) });

  it('un départ supprimé n’est pas recréé', () => {
    expect(wasRemoved(fix('departure', 100), [e('departure', 200)])).toBe(true);
  });
  it('un mouvement plus récent lève le blocage', () => {
    expect(wasRemoved(fix('departure', 300), [e('departure', 200)])).toBe(false);
  });
  it('une paire retirée par le nettoyage ne bloque pas un vrai départ', () => {
    expect(wasRemoved(fix('departure', 100), [e('departure', 200), e('arrival', 300)])).toBe(false);
  });
  it('un autre compte n’est pas concerné', () => {
    expect(wasRemoved({ ...fix('departure', 100), profileId: '2' }, [e('departure', 200)])).toBe(false);
  });
});

describe('followDuration (§ 4.5)', () => {
  it('abonné présent à la référence : « depuis le … ou avant »', () => {
    const d = ev('departure', '1', T0 + 20 * DAY);
    const res = followDuration(d, [d], T0);
    expect(res).toEqual({ kind: 'since-or-before', since: T0 });
    expect(followDurationLabel(res, T0 + 21 * DAY)).toBe('suivi depuis le 12 oct. ou avant');
  });
  it('abonné arrivé après la référence : durée observée', () => {
    const a = ev('arrival', '2', T0 + 5 * DAY);
    const d = ev('departure', '2', T0 + 15 * DAY);
    expect(followDurationLabel(followDuration(d, [d, a], T0))).toBe('suivi pendant 10 jours');
  });
  it('ignore une arrivée antérieure à un départ intermédiaire', () => {
    const a = ev('arrival', '3', T0 + 1 * DAY);
    const d1 = ev('departure', '3', T0 + 2 * DAY);
    const d2 = ev('departure', '3', T0 + 9 * DAY);
    expect(followDuration(d2, [d2, d1, a], T0).kind).toBe('since-or-before');
  });
});

describe('unseenDepartures (badge)', () => {
  it('ne compte pas un compte revenu depuis', () => {
    const d = ev('departure', '4', T0 + DAY);
    const back = ev('arrival', '4', T0 + 2 * DAY);
    expect(unseenDepartures([back, d], ctx)).toHaveLength(0);
  });
  it('exclut comptes ignorés, et non mutuels si filtre actif', () => {
    const events = [ev('departure', '6', T0), ev('departure', '7', T0, { mutual: true })];
    expect(unseenDepartures(events, ctx).map((e) => e.profileId)).toEqual(['6', '7']);
    expect(unseenDepartures(events, { ...ctx, ignored: new Set(['6']) }).map((e) => e.profileId)).toEqual(['7']);
    expect(unseenDepartures(events, { ...ctx, mutualsOnly: true }).map((e) => e.profileId)).toEqual(['7']);
  });
});

describe('listes à l’état actuel (part puis revient)', () => {
  const ctx = { ignored: new Set<string>(), mutualsOnly: false };
  const ev = (type: 'departure' | 'arrival', at: number) =>
    ({ id: `${type}-${at}`, type, profileId: 'p', handle: 'p', at, status: 'active', mutual: false, seen: true }) as const;

  it('revenu : retiré des départs, présent dans les nouveaux abonnés', () => {
    const events = [ev('arrival', 2), ev('departure', 1)];
    expect(currentDepartures([...events], ctx)).toHaveLength(0);
    expect(currentArrivals([...events], ctx)).toHaveLength(1);
  });

  it('reparti : retiré des nouveaux abonnés, seul le dernier départ reste', () => {
    const events = [ev('departure', 3), ev('arrival', 2), ev('departure', 1)];
    expect(currentArrivals([...events], ctx)).toHaveLength(0);
    expect(currentDepartures([...events], ctx).map((e) => e.at)).toEqual([3]);
  });
});

describe('missingMovements (réparation de l’historique)', () => {
  const ev = (type: 'departure' | 'arrival', profileId: string, at: number) =>
    ({ id: `${type}-${profileId}-${at}`, type, profileId, handle: profileId, at, status: 'active', mutual: false, seen: true }) as const;

  it('arrivée enregistrée mais absent de la liste : départ manquant', () => {
    const out = missingMovements([ev('arrival', 'p', 10), ev('departure', 'p', 5)], new Set(['q']), 100);
    expect(out.map((m) => [m.profileId, m.type])).toEqual([['p', 'departure']]);
  });

  it('départ enregistré mais présent dans la liste : arrivée manquante', () => {
    const out = missingMovements([ev('departure', 'p', 10)], new Set(['p']), 100);
    expect(out.map((m) => m.type)).toEqual(['arrival']);
  });

  it('cohérent : rien à réparer ; mouvement plus récent que la liste : ignoré', () => {
    expect(missingMovements([ev('arrival', 'p', 10)], new Set(['p']), 100)).toEqual([]);
    expect(missingMovements([ev('arrival', 'p', 200)], new Set(), 100)).toEqual([]);
  });
});

describe('stats7d : bilan par compte', () => {
  const ctx = { ignored: new Set<string>(), mutualsOnly: false };
  // Midi local : les quelques heures autour restent le même jour, quel que soit le fuseau.
  const now = new Date(2026, 10, 3, 12).getTime();
  const ev = (type: 'departure' | 'arrival', profileId: string, hoursAgo: number) =>
    ({ id: `${type}-${profileId}-${hoursAgo}`, type, profileId, handle: profileId, at: now - hoursAgo * 3600_000, status: 'active', mutual: false, seen: true }) as const;

  it('départ, retour, départ : un seul départ, aucune arrivée', () => {
    const s = statsSince([ev('departure', 'p', 1), ev('arrival', 'p', 2), ev('departure', 'p', 3), ev('departure', 'q', 4)], ctx, now - 7 * 24 * 3600_000);
    expect(s).toMatchObject({ departures: 2, arrivals: 0, net: -2 });
  });

  it('arrivé puis reparti dans la période : une arrivée et un départ (comme les listes), solde nul', () => {
    expect(statsSince([ev('departure', 'p', 1), ev('arrival', 'p', 2)], ctx, now - 7 * 24 * 3600_000)).toMatchObject({
      departures: 1,
      arrivals: 1,
      net: 0,
    });
  });

  it('parti puis revenu dans la période : ni départ ni arrivée', () => {
    expect(statsSince([ev('arrival', 'p', 1), ev('departure', 'p', 2)], ctx, now - 7 * 24 * 3600_000)).toMatchObject({
      departures: 0,
      arrivals: 0,
    });
  });

  it('graphe : même règle par journée, le total du jour concorde avec le bilan', () => {
    // Le même jour : p part puis revient (ne compte pas), q part, r arrive.
    const events = [ev('arrival', 'p', 1), ev('departure', 'p', 2), ev('departure', 'q', 3), ev('arrival', 'r', 4)];
    const today = movementBuckets(events, ctx, 'day', now - 30 * 24 * 3600_000, now).at(-1);
    expect(today).toMatchObject({ arrivals: 1, departures: 1 });
    expect(statsSince(events, ctx, now - 7 * 24 * 3600_000)).toMatchObject({ arrivals: 1, departures: 1 });
  });

  it('graphe : un départ un jour et un retour un autre jour restent visibles', () => {
    const buckets = movementBuckets([ev('departure', 'p', 72), ev('arrival', 'p', 1)], ctx, 'day', now - 30 * 24 * 3600_000, now);
    expect(buckets.reduce((n, b) => n + b.departures, 0)).toBe(1);
    expect(buckets.reduce((n, b) => n + b.arrivals, 0)).toBe(1);
  });
});

describe('newMovements : pas de mouvement en double (multi-machines)', () => {
  it('écarte un départ déjà enregistré par un autre ordinateur', () => {
    const events = [ev('departure', 'a', T0), ev('arrival', 'b', T0)];
    expect(newMovements('departure', ['a', 'b', 'c'], events)).toEqual(['b', 'c']);
  });
  it('garde un nouveau départ après un retour (départ, retour, départ)', () => {
    const events = [ev('departure', 'a', T0), ev('arrival', 'a', T0 + DAY)];
    expect(newMovements('departure', ['a'], events)).toEqual(['a']);
    expect(newMovements('arrival', ['a'], events)).toEqual([]);
  });
});

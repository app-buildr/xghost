import { describe, expect, it } from 'vitest';
import type { FollowEvent } from '@/shared/types';
import { eventId } from './codec';
import { followDurationLabel } from './labels';
import { currentArrivals, currentDepartures, followDuration, missingMovements, stats7d, unseenDepartures, type VisibilityContext } from './selectors';

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

const ctx: VisibilityContext = { ignored: new Set(), ignoreSuspended: true, mutualsOnly: false };

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
  it('exclut comptes suspendus, ignorés, et non mutuels si filtre actif', () => {
    const events = [
      ev('departure', '5', T0, { status: 'suspended' }),
      ev('departure', '6', T0),
      ev('departure', '7', T0, { mutual: true }),
    ];
    expect(unseenDepartures(events, ctx).map((e) => e.profileId)).toEqual(['6', '7']);
    expect(unseenDepartures(events, { ...ctx, ignored: new Set(['6']) }).map((e) => e.profileId)).toEqual(['7']);
    expect(unseenDepartures(events, { ...ctx, mutualsOnly: true }).map((e) => e.profileId)).toEqual(['7']);
  });
});

describe('listes à l’état actuel (part puis revient)', () => {
  const ctx = { ignored: new Set<string>(), ignoreSuspended: false, mutualsOnly: false };
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
  const ctx = { ignored: new Set<string>(), ignoreSuspended: false, mutualsOnly: false };
  const now = Date.UTC(2026, 10, 3, 12);
  const ev = (type: 'departure' | 'arrival', profileId: string, hoursAgo: number) =>
    ({ id: `${type}-${profileId}-${hoursAgo}`, type, profileId, handle: profileId, at: now - hoursAgo * 3600_000, status: 'active', mutual: false, seen: true }) as const;

  it('départ, retour, départ : un seul départ, aucune arrivée', () => {
    const s = stats7d([ev('departure', 'p', 1), ev('arrival', 'p', 2), ev('departure', 'p', 3), ev('departure', 'q', 4)], ctx, now);
    expect(s).toMatchObject({ departures: 2, arrivals: 0, net: -2 });
  });

  it('arrivé puis reparti dans la période : rien', () => {
    expect(stats7d([ev('departure', 'p', 1), ev('arrival', 'p', 2)], ctx, now)).toMatchObject({ departures: 0, arrivals: 0 });
  });
});

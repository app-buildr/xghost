import { describe, expect, it } from 'vitest';
import { assembleOrder, assessQuick, assessScan, diffFollowers, earlyStop, isComplete } from './diff';

describe('diffFollowers', () => {
  it('détecte départs et arrivées par id', () => {
    expect(diffFollowers(['1', '2', '3'], ['2', '3', '4'])).toEqual({ departures: ['1'], arrivals: ['4'] });
  });
  it('ne signale rien si les listes sont identiques (ordre indifférent)', () => {
    expect(diffFollowers(['1', '2'], ['2', '1'])).toEqual({ departures: [], arrivals: [] });
  });
});

describe('isComplete (§ 4.7)', () => {
  it('complet à 99 % du total annoncé', () => {
    expect(isComplete({ scanned: 2394, detected: 2418 })).toBe(true);
  });
  it('incomplet en dessous', () => {
    expect(isComplete({ scanned: 1980, detected: 2418 })).toBe(false);
  });
  it('complet si la fin de liste n’apporte plus rien après une reprise', () => {
    expect(isComplete({ scanned: 2300, detected: 2418, reachedEnd: true, seeded: 2300 })).toBe(true);
  });
  it('incomplet si la fin de liste est atteinte au premier passage seulement', () => {
    expect(isComplete({ scanned: 2300, detected: 2418, reachedEnd: true })).toBe(false);
  });
  it('sans total X : complet dès qu’on a des abonnés', () => {
    expect(isComplete({ scanned: 10, detected: 0 })).toBe(true);
  });
});

describe('assessScan', () => {
  it('signale une variation anormale (> 20 % de départs)', () => {
    expect(assessScan({ previousCount: 100, collected: 95, expected: 100, departures: 25 })).toBe('suspicious');
  });
  it('accepte une variation normale', () => {
    expect(assessScan({ previousCount: 2418, collected: 2413, expected: 2420, departures: 5 })).toBe('ok');
  });
  it('ne bloque pas un petit compte pour quelques départs', () => {
    expect(assessScan({ previousCount: 10, collected: 7, expected: 7, departures: 3 })).toBe('ok');
  });
});

describe('assessQuick', () => {
  const knownIds = new Set(['a', 'b', 'c', 'd']);

  it('aucun changement', () => {
    expect(assessQuick({ previousTotal: 4, currentTotal: 4, knownIds, pageIds: ['a', 'b'] })).toEqual({
      arrivals: [],
      departed: [],
      overflow: false,
      missing: 0,
      maybeStale: false,
    });
  });

  it('nouveaux abonnés en tête, sans départ', () => {
    const r = assessQuick({ previousTotal: 4, currentTotal: 6, knownIds, pageIds: ['y', 'z', 'a', 'b'] });
    expect(r).toEqual({ arrivals: ['y', 'z'], departed: [], overflow: false, missing: 0, maybeStale: false });
  });

  it('une arrivée et deux départs', () => {
    const r = assessQuick({ previousTotal: 4, currentTotal: 3, knownIds, pageIds: ['z', 'a'] });
    expect(r.arrivals).toEqual(['z']);
    expect(r.missing).toBe(2);
  });

  it('nouvel abonné visible mais total X pas encore à jour : à revérifier, pas un départ', () => {
    const r = assessQuick({ previousTotal: 4, currentTotal: 4, knownIds, pageIds: ['z', 'a'] });
    expect(r.missing).toBe(1);
    expect(r.maybeStale).toBe(true);
  });

  it('total en baisse malgré une arrivée : vrai départ', () => {
    expect(assessQuick({ previousTotal: 4, currentTotal: 3, knownIds, pageIds: ['z', 'a'] }).maybeStale).toBe(false);
  });

  it('un abonné récent part : identifié sans scan complet', () => {
    // Avant : a b c d (a le plus récent). b se désabonne ; X affiche a c d.
    const r = assessQuick({ previousTotal: 4, currentTotal: 3, knownIds, pageIds: ['a', 'c', 'd'], previousTop: ['a', 'b', 'c', 'd'] });
    expect(r.departed).toEqual(['b']);
    expect(r.missing).toBe(0);
  });

  it('une arrivée pousse le dernier hors de la page : ce n’est pas un départ', () => {
    // Page de 4 : z arrive, d sort de la première page sans être parti.
    const r = assessQuick({ previousTotal: 4, currentTotal: 5, knownIds, pageIds: ['z', 'a', 'b', 'c'], previousTop: ['a', 'b', 'c', 'd'] });
    expect(r.departed).toEqual([]);
    expect(r.missing).toBe(0);
  });

  it('départ ancien hors de la première page : scan complet nécessaire', () => {
    const r = assessQuick({ previousTotal: 10, currentTotal: 9, knownIds, pageIds: ['a', 'b'], previousTop: ['a', 'b'] });
    expect(r.departed).toEqual([]);
    expect(r.missing).toBe(1);
  });

  it('première page entièrement nouvelle : pas fiable', () => {
    expect(assessQuick({ previousTotal: 4, currentTotal: 6, knownIds, pageIds: ['y', 'z'] }).overflow).toBe(true);
  });

  it('total en hausse inexpliquée : aucun départ', () => {
    expect(assessQuick({ previousTotal: 4, currentTotal: 9, knownIds, pageIds: ['a'] }).missing).toBe(0);
  });
});

describe('earlyStop', () => {
  const previous = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

  it('s’arrête dès que les départs annoncés sont trouvés', () => {
    // c est parti ; on a relu z (arrivée), a, b, d : c est forcément parti.
    expect(earlyStop(previous, new Set(['z', 'a', 'b', 'd']), 1)).toEqual({ matchedIndex: 3 });
  });

  it('continue tant qu’il manque des départs', () => {
    expect(earlyStop(previous, new Set(['z', 'a', 'b', 'd']), 2)).toBeUndefined();
  });

  it('ne compte pas comme parti ce qui n’a pas encore été atteint', () => {
    expect(earlyStop(previous, new Set(['a', 'b']), 1)).toBeUndefined();
  });

  it('reconstitue la liste complète avec la suite inchangée', () => {
    expect(assembleOrder(previous, ['z', 'a', 'b', 'd'], 3)).toEqual(['z', 'a', 'b', 'd', 'e', 'f', 'g', 'h']);
  });
});

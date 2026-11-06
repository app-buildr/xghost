import { describe, expect, it } from 'vitest';
import { QUICK_TOP_SIZE, SNAPSHOT_TOP_SIZE } from '@/features/followers-sync/model';
import { assembleOrder, assessQuick, assessScan, belowResumedFloor, diffFollowers, earlyStop as stop, fillUnreadTail, isComplete, orderIndex } from './diff';

const earlyStop = (previous: string[], read: string[], target: number) =>
  stop(previous, orderIndex(previous), read, new Set(read), target);


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
  it('complet si une reprise relit toute la liste sans rien ajouter', () => {
    expect(isComplete({ scanned: 2300, detected: 2418, reachedEnd: true, seeded: 2300, reread: 2300 })).toBe(true);
  });
  it('reprise sur une réponse vide : incomplet', () => {
    expect(isComplete({ scanned: 2300, detected: 2418, reachedEnd: true, seeded: 2300, reread: 0 })).toBe(false);
  });
  it('liste coupée par X, relue à l’identique : incomplet', () => {
    expect(isComplete({ scanned: 20, detected: 20000, reachedEnd: true, seeded: 20, reread: 20 })).toBe(false);
  });
  it('incomplet si la fin de liste est atteinte au premier passage seulement', () => {
    expect(isComplete({ scanned: 2300, detected: 2418, reachedEnd: true })).toBe(false);
  });
  it('sans total X : complet seulement si la liste a été lue jusqu’au bout', () => {
    expect(isComplete({ scanned: 10, detected: 0, reachedEnd: true })).toBe(true);
    expect(isComplete({ scanned: 3000, detected: 0 })).toBe(false);
  });
  it('compte sans abonné : complet une fois la liste vide lue jusqu’au bout', () => {
    expect(isComplete({ scanned: 0, detected: 0, reachedEnd: true, totalKnown: true })).toBe(true);
    expect(isComplete({ scanned: 0, detected: 0, totalKnown: true })).toBe(false);
    // Total jamais lu et première page illisible : surtout pas une référence vide.
    expect(isComplete({ scanned: 0, detected: 0, reachedEnd: true })).toBe(false);
  });
});

describe('fillUnreadTail : scan arrêté avant la fin', () => {
  it('la partie non relue est reprise telle quelle, pas déclarée partie', () => {
    // Ancienne liste a..f ; relu a, c, d (b parti), chargement bloqué ensuite.
    expect(fillUnreadTail(['a', 'b', 'c', 'd', 'e', 'f'], ['n', 'a', 'c', 'd'])).toEqual(['n', 'a', 'c', 'd', 'e', 'f']);
  });
  it('rien de relu en commun : seule la partie relue', () => {
    expect(fillUnreadTail(['a', 'b'], ['x'])).toEqual(['x']);
  });
});

describe('assessScan', () => {
  it('signale une variation anormale (> 20 % de départs)', () => {
    expect(assessScan({ previousCount: 100, departures: 25 })).toBe('suspicious');
  });
  it('accepte une variation normale', () => {
    expect(assessScan({ previousCount: 2418, departures: 5 })).toBe('ok');
  });
  it('ne bloque pas un petit compte pour quelques départs', () => {
    expect(assessScan({ previousCount: 10, departures: 3 })).toBe('ok');
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
    expect(earlyStop(previous, ['z', 'a', 'b', 'd'], 1)).toEqual({ matchedIndex: 3 });
  });

  it('continue tant qu’il manque des départs', () => {
    expect(earlyStop(previous, ['z', 'a', 'b', 'd'], 2)).toBeUndefined();
  });

  it('ne compte pas comme parti ce qui n’a pas encore été atteint', () => {
    expect(earlyStop(previous, ['a', 'b'], 1)).toBeUndefined();
  });

  it('reconstitue la liste complète avec la suite inchangée', () => {
    expect(assembleOrder(previous, ['z', 'a', 'b', 'd'], 3)).toEqual(['z', 'a', 'b', 'd', 'e', 'f', 'g', 'h']);
  });
});

describe('abonné revenu en tête de liste', () => {
  const previous = Array.from({ length: 2000 }, (_, i) => String(i + 1));

  it('earlyStop : un abonné revenu ne fait pas partir ceux qui restent à relire', () => {
    const read = ['1500', ...previous.slice(0, 5), ...previous.slice(6, 60)];
    expect(earlyStop(previous, read, 1)).toEqual({ matchedIndex: 59 });
  });

  it('earlyStop : beaucoup plus de départs que l’écart : on continue de lire', () => {
    expect(earlyStop(previous, previous.slice(1000, 1050), 1)).toBeUndefined();
  });

  it('fillUnreadTail : un abonné revenu ne coupe pas la suite', () => {
    const ids = fillUnreadTail(previous, ['1900', ...previous.slice(0, 1800).filter((id) => id !== '1900')]);
    expect(ids).toHaveLength(2000);
  });

  it('assessQuick : aucun départ quand seul un abonné est revenu', () => {
    const quick = assessQuick({
      previousTotal: 2000,
      currentTotal: 2000,
      knownIds: new Set(previous),
      pageIds: ['1500', ...previous.slice(0, 49)],
      previousTop: previous.slice(0, 200),
    });
    expect(quick.departed).toEqual([]);
  });

  it('assessQuick : plus de départs que la baisse du total : rien n’est conclu', () => {
    const quick = assessQuick({
      previousTotal: 2000,
      currentTotal: 2000,
      knownIds: new Set(previous),
      pageIds: previous.slice(5, 55),
      previousTop: previous.slice(0, 200),
    });
    expect(quick.departed).toEqual([]);
  });
});

it('le haut de liste enregistré couvre la page d’un contrôle léger', () => {
  expect(SNAPSHOT_TOP_SIZE).toBeGreaterThanOrEqual(QUICK_TOP_SIZE);
});

it('petit compte avec des abonnés cachés : une reprise relue en entier est complète', () => {
  expect(isComplete({ scanned: 13, detected: 15, reachedEnd: true, seeded: 13, reread: 13 })).toBe(true);
  expect(belowResumedFloor(13, 15)).toBe(false);
});

it('une liste à 95 % peut être une vraie fin de liste, pas une liste à 50 %', () => {
  expect(belowResumedFloor(950, 1000)).toBe(false);
  expect(belowResumedFloor(500, 1000)).toBe(true);
  expect(belowResumedFloor(10, 0)).toBe(false);
});

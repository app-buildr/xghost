import { describe, expect, it } from 'vitest';
import { ENTRY_FOLLOWER_LIMIT, TRACKED_FOLLOWER_LIMIT, exceedsFollowerLimit, followerLimitOf } from './limit';

describe('limite d’abonnés', () => {
  const fresh = {}; // jamais synchronisé
  const tracked = { baselineAt: 1 }; // référence enregistrée

  it('applique 15 000 avant la référence, 20 000 ensuite', () => {
    expect(followerLimitOf(fresh)).toBe(ENTRY_FOLLOWER_LIMIT);
    expect(followerLimitOf(tracked)).toBe(TRACKED_FOLLOWER_LIMIT);
  });

  it('bloque un nouveau compte au-delà de 15 000, pas à 15 000 pile', () => {
    expect(exceedsFollowerLimit(fresh, 15_000)).toBe(false);
    expect(exceedsFollowerLimit(fresh, 15_001)).toBe(true);
  });

  it('laisse un compte suivi grandir jusqu’à 20 000', () => {
    expect(exceedsFollowerLimit(tracked, 18_000)).toBe(false);
    expect(exceedsFollowerLimit(tracked, 20_000)).toBe(false);
    expect(exceedsFollowerLimit(tracked, 20_001)).toBe(true);
  });

  it('ne bloque jamais sur un total inconnu', () => {
    expect(exceedsFollowerLimit(fresh, undefined)).toBe(false);
    expect(exceedsFollowerLimit(tracked, undefined)).toBe(false);
  });
});
